const https = require('https');

function redisRequest(method, body) {
  const url = new URL(process.env.KV_REST_API_URL);
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname || '/',
      method: method,
      headers: {
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve({ result: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function redisCmd(...args) {
  const result = await redisRequest('POST', args);
  return result.result;
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { session } = req.query;
  if (!session) return res.status(400).json({ error: 'session required' });

  const key = `ng:saves:${session.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  // GET — fetch all saves for session
  if (req.method === 'GET') {
    try {
      const raw = await redisCmd('GET', key);
      const saves = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ saves });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — add a save
  if (req.method === 'POST') {
    try {
      let body = '';
      await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
      const article = JSON.parse(body);
      if (!article.link || !article.title) return res.status(400).json({ error: 'link and title required' });

      const raw = await redisCmd('GET', key);
      const saves = raw ? JSON.parse(raw) : [];

      // Don't duplicate
      if (!saves.find(s => s.link === article.link && s.who === article.who)) {
        saves.unshift({
          title: article.title,
          link: article.link,
          source: article.source || '',
          cat: article.cat || '',
          desc: article.desc || '',
          who: article.who || 'Raquel',
          savedAt: new Date().toISOString(),
        });
        // Keep max 50 saves per session
        if (saves.length > 50) saves.splice(50);
        await redisCmd('SET', key, JSON.stringify(saves), 'EX', 604800); // 7 day TTL
      }

      return res.status(200).json({ saves });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE — remove a save by link
  if (req.method === 'DELETE') {
    try {
      let body = '';
      await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
      const { link, who } = JSON.parse(body);

      const raw = await redisCmd('GET', key);
      const saves = raw ? JSON.parse(raw) : [];
      const updated = saves.filter(s => !(s.link === link && s.who === who));
      await redisCmd('SET', key, JSON.stringify(updated), 'EX', 604800);

      return res.status(200).json({ saves: updated });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
};
