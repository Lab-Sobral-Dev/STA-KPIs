'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function createCache({ dbPath, ttlMs = 5 * 60 * 1000 }) {
  const resolvedPath = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS query_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  const getStmt = db.prepare('SELECT payload, created_at FROM query_cache WHERE cache_key = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO query_cache (cache_key, payload, created_at) VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at
  `);

  function keyFor(parts) {
    return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  }

  function get(parts) {
    const row = getStmt.get(keyFor(parts));
    if (!row) return null;
    if (Date.now() - Number(row.created_at) > ttlMs) return null;
    return JSON.parse(row.payload);
  }

  function set(parts, payload) {
    upsertStmt.run(keyFor(parts), JSON.stringify(payload), Date.now());
  }

  async function wrap(parts, fn) {
    const cached = get(parts);
    if (cached) return cached;
    const fresh = await fn();
    set(parts, fresh);
    return fresh;
  }

  return { get, set, wrap };
}

module.exports = { createCache };
