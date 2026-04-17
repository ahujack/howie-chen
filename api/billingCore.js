/**
 * 积分与 API Key（Postgres）
 *
 * 计价说明（仅作运营参考，可改环境变量）：
 * - DeepSeek Chat 类 API 国内常见量级约 ¥1～3 / 百万 tokens（随活动与缓存浮动）。
 * - 设 ESTIMATE_CNY_PER_MILLION_TOKENS=2：则 ¥10 量级厂商成本 ≈ 500 万 tokens。
 * - 积分：TOKENS_PER_POINT=100 → 消耗 ceil(total_tokens/100) 积分。
 * - 默认新户 DEFAULT_GRANT_POINTS=10000 → 约对应 100 万 tokens 的「折算量」，便于与 ¥99 套餐对齐；毛利需自行按实耗与定价核算。
 */

const crypto = require('crypto')
const { getPool } = require('./db.js')

const TOKENS_PER_POINT = parseInt(process.env.TOKENS_PER_POINT || '100', 10)
const DEFAULT_GRANT_POINTS = parseInt(process.env.DEFAULT_GRANT_POINTS || '10000', 10)

let ensuredBilling
async function ensureBillingTables() {
  if (ensuredBilling) return
  const pool = getPool()
  if (!pool) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      api_key_hash TEXT NOT NULL,
      api_key_prefix TEXT NOT NULL,
      points_balance INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_billing_accounts_api_key_hash ON billing_accounts (api_key_hash);
    CREATE TABLE IF NOT EXISTS points_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      kind TEXT NOT NULL,
      reference TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_points_ledger_account ON points_ledger (account_id, created_at DESC);
  `)
  ensuredBilling = true
}

function sha256hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
}

function generateApiKey() {
  return `sk_${crypto.randomBytes(24).toString('hex')}`
}

function hashApiKey(apiKey) {
  return sha256hex(apiKey.trim())
}

/**
 * @returns {Promise<{ id: string, username: string, points_balance: number, api_key_prefix: string } | null>}
 */
async function findAccountByApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk_')) return null
  try {
    await ensureBillingTables()
    const pool = getPool()
    if (!pool) return null
    const hash = hashApiKey(apiKey)
    const r = await pool.query(
      `SELECT id, username, points_balance, api_key_prefix FROM billing_accounts WHERE api_key_hash = $1`,
      [hash],
    )
    return r.rows[0] || null
  } catch (e) {
    console.warn('[billing] findAccountByApiKey', e && e.message)
    return null
  }
}

function tokensToPoints(promptTokens, completionTokens) {
  const p = Number(promptTokens) || 0
  const c = Number(completionTokens) || 0
  const total = p + c
  if (total <= 0) return 1
  return Math.max(1, Math.ceil(total / TOKENS_PER_POINT))
}

/**
 * 无 usage 时用消息字符粗略估算（约 1 汉字≈1～2 token，取保守）
 */
function estimateTokensFromTurns(turns) {
  let chars = 0
  for (const m of turns) {
    chars += (m.content || '').length
  }
  return Math.max(100, Math.ceil(chars * 0.6))
}

/**
 * @returns {Promise<{ balanceAfter: number, deducted: number }>}
 */
async function deductPointsForChat(accountId, promptTokens, completionTokens, meta) {
  await ensureBillingTables()
  const pool = getPool()
  if (!pool) throw new Error('数据库未配置')
  let points = tokensToPoints(promptTokens, completionTokens)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query(`SELECT points_balance FROM billing_accounts WHERE id = $1 FOR UPDATE`, [
      accountId,
    ])
    if (cur.rowCount === 0) throw new Error('账户不存在')
    const before = cur.rows[0].points_balance
    const deducted = Math.min(points, Math.max(0, before))
    const after = before - deducted
    await client.query(`UPDATE billing_accounts SET points_balance = $2, updated_at = now() WHERE id = $1`, [
      accountId,
      after,
    ])
    await client.query(
      `INSERT INTO points_ledger (account_id, delta, balance_after, kind, reference, meta)
       VALUES ($1, $2, $3, 'deduct', 'chat', $4::jsonb)`,
      [
        accountId,
        -deducted,
        after,
        { ...meta, requested_points: points, tokens: { promptTokens, completionTokens } },
      ],
    )
    await client.query('COMMIT')
    return { balanceAfter: after, deducted }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/**
 * @returns {Promise<{ username: string, apiKey: string, points: number, id: string }>}
 */
async function createAccount(username, initialPoints, note) {
  await ensureBillingTables()
  const pool = getPool()
  if (!pool) throw new Error('数据库未配置')
  const u = String(username || '')
    .trim()
    .slice(0, 64)
  if (!u) throw new Error('用户名不能为空')
  const apiKey = generateApiKey()
  const prefix = apiKey.slice(0, 10)
  const hash = hashApiKey(apiKey)
  const pts = Number.isFinite(initialPoints) ? Math.max(0, Math.floor(initialPoints)) : DEFAULT_GRANT_POINTS

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query(
      `INSERT INTO billing_accounts (username, api_key_hash, api_key_prefix, points_balance, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, points_balance`,
      [u, hash, prefix, pts, note ? String(note).slice(0, 500) : null],
    )
    const id = r.rows[0].id
    await client.query(
      `INSERT INTO points_ledger (account_id, delta, balance_after, kind, reference, meta)
       VALUES ($1, $2, $3, 'grant', 'signup', $4::jsonb)`,
      [id, pts, pts, { initial: true }],
    )
    await client.query('COMMIT')
    return { id, username: u, apiKey, points: r.rows[0].points_balance }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

async function grantTopUp(accountId, delta, reference, meta) {
  await ensureBillingTables()
  const pool = getPool()
  if (!pool) throw new Error('数据库未配置')
  const d = Math.floor(Number(delta))
  if (!Number.isFinite(d) || d <= 0) throw new Error('充值积分须为正整数')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const u = await client.query(
      `UPDATE billing_accounts SET points_balance = points_balance + $2, updated_at = now()
       WHERE id = $1 RETURNING points_balance, username`,
      [accountId, d],
    )
    if (u.rowCount === 0) throw new Error('账户不存在')
    const bal = u.rows[0].points_balance
    await client.query(
      `INSERT INTO points_ledger (account_id, delta, balance_after, kind, reference, meta)
       VALUES ($1, $2, $3, 'grant', $4, $5::jsonb)`,
      [accountId, d, bal, reference || 'topup', meta && typeof meta === 'object' ? meta : {}],
    )
    await client.query('COMMIT')
    return { balanceAfter: bal, username: u.rows[0].username }
  } catch (e) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw e
  } finally {
    client.release()
  }
}

async function listAccounts() {
  await ensureBillingTables()
  const pool = getPool()
  if (!pool) throw new Error('数据库未配置')
  const r = await pool.query(
    `SELECT id, username, api_key_prefix, points_balance, created_at, note FROM billing_accounts ORDER BY created_at DESC`,
  )
  return r.rows
}

module.exports = {
  ensureBillingTables,
  findAccountByApiKey,
  hashApiKey,
  TOKENS_PER_POINT,
  DEFAULT_GRANT_POINTS,
  tokensToPoints,
  estimateTokensFromTurns,
  deductPointsForChat,
  createAccount,
  grantTopUp,
  listAccounts,
}
