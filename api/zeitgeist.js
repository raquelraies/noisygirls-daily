const https = require('https');
const http = require('http');
const { parseStringPromise } = require('xml2js');

function fetchUrl(url, redirects, customHeaders) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, application/json, text/html, */*',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
        ...(customHeaders || {}),
      },
      timeout: 10000,
    }, (res) => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        return fetchUrl(res.headers.location, redirects + 1, customHeaders).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
}

// Filter out sponsored/sales/product content
function isJunk(title) {
  if (!title) return true;
  const t = title.toLowerCase();
  const junk = [
    'sale','% off','deal','discount','coupon','promo','shop now','buy now',
    'best buy','amazon find','product review','sponsored','ad:','paid',
    'insider sale','ends this weekend','limited time','flash sale',
    'daily questions thread','mod applications','weekly thread','megahub',
    'open forum','read the rules','rule 10','welcome to','how to:',
  ];
  return junk.some(j => t.includes(j));
}

// Reddit - genuinely interesting subreddits, not gender-specific
const SUBREDDITS = [
  { name: 'worldnews',           cat: 'news' },
  { name: 'UKpolitics',          cat: 'news' },
  { name: 'politics',            cat: 'news' },
  { name: 'nottheonion',         cat: 'weird' },
  { name: 'todayilearned',       cat: 'weird' },
  { name: 'interestingasfuck',   cat: 'weird' },
  { name: 'Damnthatsinteresting',cat: 'weird' },
  { name: 'AmItheAsshole',       cat: 'culture' },
  { name: 'unpopularopinion',    cat: 'culture' },
  { name: 'changemyview',        cat: 'culture' },
  { name: 'TrueOffMyChest',      cat: 'culture' },
  { name: 'relationship_advice', cat: 'relationships' },
  { name: 'antiwork',            cat: 'work' },
  { name: 'LateStageCapitalism', cat: 'work' },
  { name: 'popculturechat',      cat: 'culture' },
  { name: 'TwoXChromosomes',     cat: 'culture' },
  { name: 'AskReddit',           cat: 'culture' },
  { name: 'socialskills',        cat: 'culture' },
  { name: 'LifeAdvice',          cat: 'culture' },
  { name: 'science',             cat: 'weird' },
];

async function fetchReddit(sub) {
  try {
    const xml = await fetchUrl(`https://www.reddit.com/r/${sub.name}/hot/.rss?limit=10`);
    const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false, explicitCharkey: true });
    const entries = parsed.feed?.entry || [];
    const items = Array.isArray(entries) ? entries : [entries];
    return items.slice(0, 6).map(e => {
      const title = typeof e.title === 'object' ? e.title._ : e.title || '';
      const link = Array.isArray(e.link) ? e.link[0]?.$.href : e.link?.$.href || '';
      const updated = e.updated || '';
      const content = typeof e.content === 'object' ? e.content._ : e.content || '';
      const scoreMatch = content.match(/(\d+) point/);
      const commentMatch = content.match(/(\d+) comment/);
      const score = scoreMatch ? parseInt(scoreMatch[1]) : 50;
      const comments = commentMatch ? parseInt(commentMatch[1]) : 0;
      return {
        title: title.trim(),
        score, comments,
        url: link || `https://reddit.com/r/${sub.name}`,
        cat: sub.cat,
        source: `r/${sub.name}`,
        created: updated,
        type: 'reddit',
        heat: score + (comments * 3),
      };
    }).filter(p => p.title && p.heat > 10 && !isJunk(p.title));
  } catch(e) {
    return [];
  }
}

// Trending news - UK + US sources
async function fetchTrending() {
  const sources = [
    // UK
    { url: 'https://feeds.bbci.co.uk/news/rss.xml',              name: 'BBC News',         region: 'UK' },
    { url: 'https://www.theguardian.com/uk/rss',                  name: 'The Guardian',     region: 'UK' },
    { url: 'https://www.independent.co.uk/rss',                   name: 'The Independent',  region: 'UK' },
    { url: 'https://www.dailymail.co.uk/articles.rss',            name: 'Daily Mail',       region: 'UK' },
    { url: 'https://pagesix.com/feed/',                           name: 'Page Six',         region: 'US' },
    // US
    { url: 'https://feeds.feedburner.com/TheAtlantic',            name: 'The Atlantic',     region: 'US' },
    { url: 'https://slate.com/feeds/all.rss',                     name: 'Slate',            region: 'US' },
    { url: 'https://www.vox.com/rss/index.xml',                   name: 'Vox',              region: 'US' },
    { url: 'https://nymag.com/feed/all',                          name: 'New York Mag',     region: 'US' },
    { url: 'https://www.newyorker.com/feed/everything',           name: 'The New Yorker',   region: 'US' },
    { url: 'https://www.vanityfair.com/feed/rss',                 name: 'Vanity Fair',      region: 'US' },
    { url: 'https://lithub.com/feed/',                            name: 'Literary Hub',     region: 'US' },
    { url: 'https://www.wired.com/feed/rss',                      name: 'Wired',            region: 'US' },
    { url: 'https://psyche.co/feed',                              name: 'Psyche',           region: 'US' },
    { url: 'https://nautil.us/feed/',                             name: 'Nautilus',         region: 'US' },
  ];

  const items = [];
  for (const source of sources) {
    try {
      const xml = await fetchUrl(source.url);
      const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false, explicitCharkey: true });
      const ch = parsed.rss?.channel || parsed.feed;
      if (!ch) continue;
      const raw = ch.item || ch.entry;
      const posts = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      posts.slice(0, 5).forEach(item => {
        const title = stripHtml(typeof item.title === 'object' ? item.title._ || '' : item.title || '');
        let link = typeof item.link === 'string' ? item.link : (item.link?._ || item.link?.$.href || '');
        const pubDate = typeof item.pubDate === 'object' ? item.pubDate._ : (item.pubDate || item.updated || '');
        if (title && link && !isJunk(title)) {
          items.push({ title, url: link.trim(), source: source.name, region: source.region, type: 'trend', cat: 'trending', created: pubDate });
        }
      });
    } catch(e) {}
  }
  return items;
}

// Podcasts - Society & Culture + News (UK + US)
async function fetchPodcasts() {
  const urls = [
    'https://itunes.apple.com/gb/rss/toppodcasts/limit=15/genre=1324/json',
    'https://itunes.apple.com/gb/rss/toppodcasts/limit=10/genre=1311/json',
    'https://itunes.apple.com/us/rss/toppodcasts/limit=15/genre=1324/json',
    'https://itunes.apple.com/us/rss/toppodcasts/limit=10/genre=1311/json',
  ];
  const all = [];
  const seen = new Set();
  for (const url of urls) {
    try {
      const raw = await fetchUrl(url);
      const data = JSON.parse(raw);
      const entries = data.feed?.entry || [];
      const region = url.includes('/gb/') ? 'UK' : 'US';
      const genre = url.includes('1311') ? 'News' : 'Society & Culture';
      entries.forEach((e, i) => {
        const title = e['im:name']?.label;
        const artist = e['im:artist']?.label || '';
        const link = e.link?.attributes?.href || '';
        if (title && !seen.has(title)) {
          seen.add(title);
          all.push({ title, artist, rank: i + 1, url: link, cat: 'podcast', source: `Apple ${genre} ${region}`, type: 'podcast', region, genre });
        }
      });
    } catch(e) {}
  }
  return all;
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [redditResults, podcasts, trends] = await Promise.all([
      Promise.all(SUBREDDITS.map(fetchReddit)),
      fetchPodcasts(),
      fetchTrending(),
    ]);

    let reddit = redditResults.flat();
    reddit.sort((a, b) => b.heat - a.heat);
    const seen = new Set();
    reddit = reddit.filter(p => {
      const key = p.title.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort trends by date newest first
    trends.sort((a, b) => {
      const da = new Date(a.created), db = new Date(b.created);
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    res.status(200).json({
      reddit: reddit.slice(0, 60),
      podcasts: podcasts.slice(0, 30),
      trends: trends.slice(0, 40),
      fetched: new Date().toISOString(),
      debug: { reddit_count: reddit.length, podcast_count: podcasts.length, trend_count: trends.length }
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
