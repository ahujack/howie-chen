/**
 * Postgres（Neon / Vercel Postgres 等）
 * 优先 DATABASE_URL；Vercel Postgres 集成常注入 POSTGRES_URL，二者取其一即可
 */
const { Pool } = require('pg')

let pool

function shouldUseSsl(url) {
  if (!url || process.env.DATABASE_SSL === 'false') return false
  return /neon\.tech|supabase\.co|render\.com|amazonaws\.com/i.test(url)
}

function getPool() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) return null
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 2,
      ssl: shouldUseSsl(url) ? { rejectUnauthorized: false } : undefined,
    })
  }
  return pool
}

let ensured
async function ensurePersonaTable() {
  if (ensured) return
  const p = getPool()
  if (!p) return
  await p.query(`
    CREATE TABLE IF NOT EXISTS creator_personas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '默认人设',
      five_dims JSONB NOT NULL DEFAULT '{}'::jsonb,
      voice_notes TEXT,
      taboos TEXT,
      cases_summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_creator_personas_user_sub ON creator_personas (user_sub);
  `)
  ensured = true
}

module.exports = { getPool, ensurePersonaTable }
