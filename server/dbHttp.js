// The database in the Cloudflare Worker (Stage C2): Neon's serverless driver, one HTTP request per query, so no
// connection is kept open between requests. Same interface as server/db.js: db.query(sql, params) -> { rows }.
// The schema is applied by the Node server at start (and, after the move, by the deploy steps), not here.
//
// fetchEndpoint: only for local testing. tools/neon-local.mjs answers Neon's HTTP protocol from a local PGlite, so
// `wrangler dev` runs without a Neon database (NEON_FETCH_ENDPOINT in .dev.vars).

import { neon, neonConfig, types } from '@neondatabase/serverless';

const BIGINT = 20;   // ids: strings by default, but they fit comfortably in a JS number
const parsers = { getTypeParser: (id, format) => (id === BIGINT ? (v) => (v === null ? null : Number(v)) : types.getTypeParser(id, format)) };

export function neonHttpDb(url, { fetchEndpoint } = {}) {
  if (fetchEndpoint) neonConfig.fetchEndpoint = fetchEndpoint;
  const sql = neon(url);
  return { kind: 'postgres', query: (text, params = []) => sql.query(text, params, { fullResults: true, types: parsers }) };
}
