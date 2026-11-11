// A local stand-in for Neon's HTTP query endpoint, backed by PGlite, so the Cloudflare Worker can be run with
// `wrangler dev` without a Neon database. For local testing only.
//
//   node tools/neon-local.mjs [--port 4444] [--old-account name:password]
//
// Then, in .dev.vars:
//   DATABASE_URL=postgres://local:local@localhost/breachline
//   NEON_FETCH_ENDPOINT=http://localhost:4444/sql
//
// --old-account makes an account with an old bcrypt password hash (cost 11, like accounts made before Stage C2),
// to try the upgrade to PBKDF2 on its first log-in. Data is kept in .data/neon-local (separate from npm run dev's).
//
// What it answers: POST /sql with { query, params } -> { fields: [{ name, dataTypeID }], rows: [[text...]],
// command, rowCount }, every value as Postgres text, which is what Neon sends (the driver parses it).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';
import { applySchema } from '../server/db.js';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('port', 4444));
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.data/neon-local');
fs.mkdirSync(dir, { recursive: true });
const lite = await PGlite.create(dir);
await applySchema((sql) => lite.query(sql));

const old = arg('old-account', null);
if (old) {
  const [name, password] = old.split(':');
  await lite.query(
    `INSERT INTO accounts (username, username_lower, password_hash, money) VALUES ($1, $2, $3, 5000)
     ON CONFLICT (username_lower) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [name, name.toLowerCase(), await bcrypt.hash(password, 11)],
  );
  console.log(`Account "${name}" now has an old bcrypt password hash (and at least 5000 Money).`);
}

// Every value comes back as Postgres text: a parser that returns the text unchanged, for every type used
const raw = (v) => v;
const TEXT_TYPES = [16, 17, 18, 19, 20, 21, 23, 25, 26, 114, 700, 701, 1007, 1009, 1016, 1042, 1043, 1082, 1083, 1114, 1184, 1186, 1700, 2950, 3802];
const parsers = Object.fromEntries(TEXT_TYPES.map((t) => [t, raw]));

// One query at a time, like a single connection
let queue = Promise.resolve();
const run = (q, params) => (queue = queue.then(() => lite.query(q, params, { rowMode: 'array', parsers })));

http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(404).end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const { query, params = [] } = JSON.parse(body);
      const r = await run(query, params);
      const command = (query.trim().match(/^\w+/)?.[0] || '').toUpperCase();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        rows: r.rows.map((row) => row.map((v) => (v === null ? null : typeof v === 'string' ? v : String(v)))),
        command, rowCount: r.affectedRows ?? r.rows.length,
      }));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ message: err.message, code: err.code }));
    }
  });
}).listen(PORT, () => console.log(`Local Neon stand-in on http://localhost:${PORT}/sql (data in .data/neon-local)`));
