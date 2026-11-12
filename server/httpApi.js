// Mounts the web-standard API (server/api.js) into Express on the Node server: turns Node's request into a
// Request, and the Response back into Node's reply. The Cloudflare Worker calls the same API directly.

const MAX_BODY_BYTES = 8 * 1024;
// Headers that describe one hop of the connection, not the request itself
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer']);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function httpApi(api) {
  return async (req, res) => {
    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (HOP.has(k) || v === undefined) continue;
        for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
      }
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const body = hasBody ? await readBody(req) : undefined;
      const url = `${req.protocol}://${req.get('host') || 'localhost'}${req.originalUrl}`;
      const response = await api.handle(new Request(url, { method: req.method, headers, body }), { ip: req.ip, secure: req.secure });
      res.status(response.status);
      for (const [k, v] of response.headers) if (k !== 'set-cookie') res.setHeader(k, v);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader('set-cookie', cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      if (err.status === 413) return res.status(413).json({ error: 'Request too large.' });
      console.error('Account API error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
    }
  };
}
