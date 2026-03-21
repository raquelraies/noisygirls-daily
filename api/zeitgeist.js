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
        'Accept': 'application/rss+xml, application/xml, text/html, */*',
        'Accept-Language': 'en-GB,en;q=0.9',
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
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
}

const SUBREDDITS = [
  { name: 'TwoXChromosomes', cat: 'women' },
  { name: 'AskWomen', cat: 'women' },
  { name: 'women', cat: 'women' },
  { name: 'GirlTalk', cat: 'women' },
  { name: 'femalefashionadvice', cat: 'fashion' },
  { name: 'AmItheAsshole', cat: 'culture' },
  { name: 'TrueOffMyChest', cat: 'culture' },
  { name: 'unpopularopinion', cat: 'culture' },
  { name: 'popculturechat', cat: 'culture' },
  { name: 'relationship_advice', cat: 'relationships' },
  { name: 'dating_advice', cat: 'relationships' },
  { name: 'antiwork', cat: 'work' },
  { name: 'careerguidance', cat: 'work' },
  { name: 'beauty', cat: 'fashion' },
  { name: 'SkincareAddiction', cat: 'fashion' },
];

async function fetchReddit(sub) {
  try {
    const xml = await fetchUrl(`https://www.reddit.com/r/${sub.name}/hot/.rss?limit=8`);
    const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false, explicitCharkey: true });
    const entries = parsed.feed?.entry || [];
    const items = Array.isArray(entries) ? entries : [entries];
    return items.slice(0, 5).map(e => {
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
        score,
        comments,
        url: link || `https://reddit.com/r/${sub.name}`,
        cat: sub.cat,
        source: `r/${sub.name}`,
        created: updated,
        type: 'reddit',
        heat: score + (comments * 3),
      };
    }).filter(p => p.title && p.heat > 10);
  } catch(e) {
    return [];
  }
}

async function fetchPodcasts() {
  const urls = [
    'https://itunes.apple.com/gb/rss/toppodcasts/limit=15/genre=1324/json',
    'https://itunes.apple.com/gb/rss/toppodcasts/limit=10/genre=1311/json',
    'https://itunes.apple.com/us/rss/toppodcasts/limit=10/genre=1324/json',
  ];
  const all = [];
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
        if (title) all.push({ title, artist, rank: i + 1, url: link, cat: 'podcast', source: `Apple ${genre} ${region}`, type: 'podcast', region, genre });
      });
    } catch(e) {}
  }
  return all;
}

async function fetchTrending() {
  const sources = [
    { url: 'https://feeds.bbci.co.uk/news/rss.xml', name: 'BBC News' },
    { url: 'https://www.theguardian.com/uk/rss', name: 'The Guardian' },
    { url: 'https://www.independent.co.uk/rss', name: 'The Independent' },
    { url: 'https://pagesix.com/feed/', name: 'Page Six' },
    { url: 'https://www.dailymail.co.uk/articles.rss', name: 'Daily Mail' },
  ];
  const items = [];
  for (const source of sources) {
    try {
      const xml = await fetchUrl(source.url);
      const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false, explicitCharkey: true });
      const ch = parsed.rss?.channel;
      if (!ch) continue;
      const raw = ch.item;
      const posts = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      posts.slice(0, 4).forEach(item => {
        const title = stripHtml(typeof item.title === 'object' ? item.title._ || '' : item.title || '');
        const link = typeof item.link === 'string' ? item.link : (item.link?._ || '');
        const pubDate = typeof item.pubDate === 'object' ? item.pubDate._ : item.pubDate || '';
        if (title && link) items.push({ title, url: link, source: source.name, type: 'trend', cat: 'trending', created: pubDate });
      });
    } catch(e) {}
  }
  return items;
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

    res.status(200).json({
      reddit: reddit.slice(0, 50),
      podcasts: podcasts.slice(0, 20),
      trends: trends.slice(0, 20),
      fetched: new Date().toISOString(),
      debug: { reddit_count: reddit.length, podcast_count: podcasts.length, trend_count: trends.length }
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
