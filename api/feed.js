const https = require('https');
const http = require('http');
const { parseStringPromise } = require('xml2js');

const SOURCES = [
  { name: 'The Guardian',      url: 'https://www.theguardian.com/uk/rss',                 cat: 'news' },
  { name: 'BBC News',          url: 'https://feeds.bbci.co.uk/news/rss.xml',              cat: 'news' },
  { name: 'Daily Mail',        url: 'https://www.dailymail.co.uk/articles.rss',           cat: 'news' },
  { name: 'Page Six',          url: 'https://pagesix.com/feed/',                          cat: 'culture' },
  { name: 'Vogue',             url: 'https://www.vogue.com/feed/rss',                     cat: 'fashion' },
  { name: 'The Cut',           url: 'https://www.thecut.com/rss/index.xml',               cat: 'lifestyle' },
  { name: 'Vanity Fair',       url: 'https://www.vanityfair.com/feed/rss',                cat: 'culture' },
  { name: 'New York Mag',      url: 'https://nymag.com/feed/all',                         cat: 'culture' },
  { name: 'The Atlantic',      url: 'https://feeds.feedburner.com/TheAtlantic',           cat: 'culture' },
  { name: '1843 Magazine',     url: 'https://www.economist.com/1843/rss.xml',             cat: 'culture' },
  { name: 'Aeon',              url: 'https://aeon.co/feed.rss',                           cat: 'weird' },
  { name: 'Today I Found Out', url: 'https://www.todayifoundout.com/index.php/feed/',     cat: 'weird' },
  { name: 'Tortoise Media',    url: 'https://www.tortoisemedia.com/feed/',                cat: 'news' },
  { name: 'Longreads',         url: 'https://longreads.com/feed/',                        cat: 'culture' },
  { name: 'Refinery29',        url: 'https://www.refinery29.com/en-gb/rss.xml',           cat: 'lifestyle' },
  { name: 'Prospect Magazine', url: 'https://www.prospectmagazine.co.uk/feed',            cat: 'culture' },
  { name: 'Our World in Data', url: 'https://ourworldindata.org/atom.xml',                cat: 'weird' },
  { name: 'The Conversation',  url: 'https://theconversation.com/uk/articles.atom',       cat: 'weird' },
];

function fetchUrl(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    var client = url.startsWith('https') ? https : http;
    var req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NoisyGirls/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 8000,
    }, function(res) {
      if ([301,302,307,308].indexOf(res.statusCode) !== -1 && res.headers.location) {
        return fetchUrl(res.headers.location, redirects + 1).then(resolve).catch(reject);
      }
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve(data); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
  });
}

function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ').trim();
}

function getText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object') return field._ || field.__cdata || field.__text || '';
  return String(field);
}

async function parseFeed(source) {
  try {
    var xml = await fetchUrl(source.url);
    var parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false, explicitCharkey: true });
    var items = [];

    if (parsed.rss && parsed.rss.channel) {
      var ch = parsed.rss.channel;
      var raw = ch.item;
      items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      items = items.map(function(item) {
        return {
          title: stripHtml(getText(item.title)),
          desc: stripHtml(getText(item.description) || getText(item['content:encoded']) || '').slice(0,220),
          link: getText(item.link) || getText(item.guid) || '',
          pubDate: getText(item.pubDate) || '',
          source: source.name,
          cat: source.cat,
        };
      });
    } else if (parsed.feed && parsed.feed.entry) {
      var entries = parsed.feed.entry;
      items = Array.isArray(entries) ? entries : [entries];
      items = items.map(function(e) {
        var link = '';
        if (Array.isArray(e.link)) {
          var alt = e.link.find(function(l) { return l.$ && l.$.rel === 'alternate'; });
          link = ((alt || e.link[0]).$ || {}).href || '';
        } else if (e.link && e.link.$) {
          link = e.link.$.href || '';
        }
        return {
          title: stripHtml(getText(e.title)),
          desc: stripHtml(getText(e.summary) || getText(e.content) || '').slice(0,220),
          link: link,
          pubDate: getText(e.published) || getText(e.updated) || '',
          source: source.name,
          cat: source.cat,
        };
      });
    }

    return items.filter(function(a) { return a.title && a.link; }).slice(0, 10);
  } catch(e) {
    return [];
  }
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    var results = await Promise.all(SOURCES.map(parseFeed));
    var articles = results.reduce(function(a,b){ return a.concat(b); }, []);

    articles.sort(function(a,b) {
      var da = new Date(a.pubDate), db = new Date(b.pubDate);
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    var seen = new Set();
    articles = articles.filter(function(a) {
      if (!a.link || seen.has(a.link)) return false;
      seen.add(a.link); return true;
    });

    res.status(200).json({ articles: articles, count: articles.length, fetched: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
