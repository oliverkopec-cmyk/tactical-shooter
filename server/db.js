// Database connection. Uses Postgres from DATABASE_URL (Neon / Supabase) when
// it is set. Without it, falls back to PGlite (Postgres compiled to WebAssembly)
// stored in .data/, so the game still runs locally with no setup. Both speak
// the same SQL, so everything else only ever calls db.query(sql, params).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id               BIGSERIAL PRIMARY KEY,
    username         TEXT NOT NULL,
    username_lower   TEXT NOT NULL UNIQUE,
    password_hash    TEXT NOT NULL,
    level            INTEGER NOT NULL DEFAULT 1,
    xp               INTEGER NOT NULL DEFAULT 0,
    money            INTEGER NOT NULL DEFAULT 0,
    polish_money     INTEGER NOT NULL DEFAULT 0,
    rank_points      INTEGER NOT NULL DEFAULT 0,
    owned_operators  JSONB NOT NULL DEFAULT '[]',
    owned_skins      JSONB NOT NULL DEFAULT '[]',
    equipped_skins   JSONB NOT NULL DEFAULT '{}',
    settings         JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen        TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id);
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS quests JSONB NOT NULL DEFAULT '{}';
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stats JSONB NOT NULL DEFAULT '{}';
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS equipped_operators JSONB NOT NULL DEFAULT '{}';
`;

/** Create or update the tables (safe to run every start). */
export async function applySchema(query) {
  for (const statement of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await query(statement);
}

/**
 * Common skins used to be free for everyone; they now come from crates. So nobody loses the
 * look of a gun they had equipped, every Common skin an account has equipped is added to what
 * it owns for that gun. Safe to run every start.
 */
export async function migrateEquippedCommons(query, commonIds) {
  const { rows } = await query("SELECT id, owned_skins, equipped_skins FROM accounts WHERE equipped_skins <> '{}'::jsonb");
  for (const row of rows) {
    const owned = Array.isArray(row.owned_skins) ? row.owned_skins : [];
    const add = [];
    for (const [gun, skin] of Object.entries(row.equipped_skins || {})) {
      if (commonIds.includes(skin) && !owned.includes(skin) && !owned.includes(`${gun}:${skin}`)) add.push(`${gun}:${skin}`);
    }
    if (add.length) await query('UPDATE accounts SET owned_skins = $2 WHERE id = $1', [row.id, JSON.stringify([...owned, ...add])]);
  }
}

/** Returns { query(sql, params) -> { rows }, kind: 'postgres' | 'local' }. */
export async function openDatabase() {
  let db;
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    // BIGINT ids come back as strings by default; they fit comfortably in a JS number.
    pg.types.setTypeParser(20, (v) => Number(v));
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 30000 });
    pool.on('error', (err) => console.error('Database connection error:', err.message));
    db = { kind: 'postgres', query: (sql, params) => pool.query(sql, params) };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = path.resolve(__dirname, '../.data/pglite');
    fs.mkdirSync(dir, { recursive: true });
    const lite = await PGlite.create(dir);
    db = { kind: 'local', query: (sql, params) => lite.query(sql, params) };
    console.warn('DATABASE_URL is not set: saving accounts to a local file database in .data/. '
      + 'On Render this is wiped on every deploy, so set DATABASE_URL there.');
  }

  await applySchema((sql) => db.query(sql));
  const { SKIN_IDS, SKINS } = await import('../shared/skins.js');
  await migrateEquippedCommons((sql, params) => db.query(sql, params), SKIN_IDS.filter((id) => SKINS[id].rarity === 'common'));
  return db;
}
