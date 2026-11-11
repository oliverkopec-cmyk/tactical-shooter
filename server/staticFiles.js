// Serving the built game (dist): compressed, and cached by the browser.
//
// - tools/precompress.mjs writes .br and .gz copies at build time; the smallest copy the browser accepts is sent.
// - Files in /assets have a hash in their name that changes whenever they do, so browsers keep them for a year
//   without asking again. index.html is checked every time (a quick "not modified" when nothing changed), so a new
//   version is picked up straight away.

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const ENCODINGS = [['br', '.br'], ['gzip', '.gz']];

export function staticFiles(dist) {
  const plain = express.static(dist, { setHeaders: (res, file) => res.setHeader('Cache-Control', cacheFor(dist, file)) });
  const exists = new Map();   // file -> whether it is there (the build doesn't change while the server runs)
  const has = (file) => {
    if (!exists.has(file)) exists.set(file, fs.existsSync(file) && fs.statSync(file).isFile());
    return exists.get(file);
  };
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(dist, rel);
    if (!file.startsWith(dist + path.sep) || !has(file)) return plain(req, res, next);
    const accept = String(req.headers['accept-encoding'] || '');
    res.setHeader('Vary', 'Accept-Encoding');
    for (const [name, ext] of ENCODINGS) {
      if (!new RegExp(`\\b${name}\\b`).test(accept) || !has(file + ext)) continue;
      res.setHeader('Content-Encoding', name);
      res.type(path.extname(file));
      res.setHeader('Cache-Control', cacheFor(dist, file));
      return res.sendFile(file + ext, (err) => { if (err) next(err); });
    }
    return plain(req, res, next);
  };
}

function cacheFor(dist, file) {
  return path.relative(dist, file).startsWith(`assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
}
