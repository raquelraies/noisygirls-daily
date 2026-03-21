const https = require('https');

function fetchUrl(url, options) {
  return new Promise((resolve, reject) => {
    const opts = {
      ...options,
      headers: {
        'User-Agent': 'NoisyGirls/1.0 (podcast research tool)',
        'Accept': 'application/json',
        ...(options && options.headers || {}),
      },
      timeout: 8000,
    };
    const req = https.get(url, opts, (res) => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        return fetchUrl(res.headers.location, options).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Reddit subreddits relevant to Noisy Girls audience
const SUBREDDITS = [
  { name: 'women',                  cat: 'women' },
  { name: 'TwoXChromosomes',        cat: 'women' },
  { name: 'femalefashionadvice',    cat: 'fashion' },
  { name: 'AmItheAsshole',          cat: 'culture' },
  { name: 'TrueOffMyChest',         cat: 'culture' },
  { name: 'relationship_advice',    cat: 'relationships' },
  { name: 'workingwomen',           cat: 'work' },
  { name: 'antiwork',               cat: 'work' },
  { name: 'unpopularopinion',       cat: 'culture' },
  { name: 'changemyview',           cat: 'culture' },
  { name: 'AskWomen',              cat: 'women' },
  { name: 'GirlTalk',              cat: 'women' },
  { name: 'beauty',                 cat: 'fashion' },
  { name: 'popculturechat',         cat: 'culture' },
  { name: 'celebrity',              cat: 'culture' },
];

async function fetchReddit(subreddit) {
  try {
    const raw = await fetchUrl(`https://www.reddit.com/r/${subreddit.name}/hot.json?limit=5`);
    const data = JSON.parse(raw);
    const posts = data.data.children || [];
    return posts
      .filter(p => !p.data.stickied && p.data.score > 50)
      .map(p => ({
        title: p.data.title,
        score: p.data.score,
        comments: p.data.num_comments,
        url: `https://reddit.com${p.data.permalink}`,
        subreddit: p.data.subreddit,
        cat: subreddit.cat,
        source: `r/${subreddit.name}`,
        created: new Date(p.data.created_utc * 1000).toISOString(),
        type: 'reddit',
        heat: p.data.score + (p.data.num_comments * 3),
      }));
  } catch(e) {
    return [];
  }
}

// Apple Podcasts top charts (UK + US)
async function fetchPodcastCharts() {
  const urls = [
    { url: 'https://rss.applespotify.com/api/v1/gb/podcasts/top/genre/1310/limit/20/json', region: 'UK' },
    { url: 'https://rss.applespotify.com/api/v1/us/podcasts/top/genre/1310/limit/20/json', region: 'US' },
    { url: 'https://itunes.apple.com/gb/rss/toppodcasts/limit=20/genre=1310/json', region: 'UK' },
    { url: 'https://itunes.apple.com/us/rss/toppodcasts/limit=20/genre=1310/json', region: 'US' },
  ];

  for (const { url, region } of urls) {
    try {
      const raw = await fetchUrl(url);
      const data = JSON.parse(raw);
      const feed = data.feed;
      if (!feed || !feed.entry) continue;
      return feed.entry.slice(0, 10).map((e, i) => ({
        title: e['im:name'] ? e['im:name'].label : e.title?.label,
        artist: e['im:artist'] ? e['im:artist'].label : '',
        rank: i + 1,
        url: e.link?.attributes?.href || '',
        cat: 'podcast',
        source: `Apple Podcasts ${region}`,
        type: 'podcast',
        region,
      })).filter(p => p.title);
    } catch(e) {
      continue;
    }
  }
  return [];
}

// Google Trends RSS (daily trending)
async function fetchGoogleTrends() {
  try {
    const raw = await fetchUrl('https://trends.google.com/trends/trendingsearches/daily/rss?geo=GB');
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(raw)) !== null) {
      const block = match[1];
      const title = (block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
      const traffic = (block.match(/approx_traffic">(.*?)</) || block.match(/ht:approx_traffic>(.*?)</) || [])[1] || '';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
      if (title) {
        items.push({
          title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
          traffic: traffic.replace(/[^0-9KM+]/g, ''),
          url: link || `https://www.google.com/search?q=${encodeURIComponent(title)}`,
          cat: 'trending',
          source: 'Google Trends UK',
          type: 'trend',
          created: new Date().toISOString(),
        });
      }
    }
    return items.slice(0, 15);
  } catch(e) {
    return [];
  }
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [redditResults, podcasts, trends] = await Promise.all([
      Promise.all(SUBREDDITS.map(fetchReddit)),
      fetchPodcastCharts(),
      fetchGoogleTrends(),
    ]);

    // Flatten and sort Reddit by heat score
    let redditPosts = redditResults.flat();
    redditPosts.sort((a, b) => b.heat - a.heat);

    // Deduplicate Reddit by title similarity
    const seen = new Set();
    redditPosts = redditPosts.filter(p => {
      const key = p.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.status(200).json({
      reddit: redditPosts.slice(0, 40),
      podcasts: podcasts.slice(0, 10),
      trends: trends.slice(0, 15),
      fetched: new Date().toISOString(),
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
