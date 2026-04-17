const { verifyAdminBearer } = require('../lib/adminAuth.cjs')
const { readJsonBody } = require('../lib/readJsonBody.cjs')
const {
  createAccount,
  listAccounts,
  grantTopUp,
  DEFAULT_GRANT_POINTS,
  TOKENS_PER_POINT,
} = require('../lib/billingCore.cjs')

function corsJson(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'private, no-store, must-revalidate')
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      corsJson(res)
      res.status(204).end()
      return
    }

    if (!verifyAdminBearer(req.headers?.authorization)) {
      corsJson(res)
      res.status(401).json({ error: '需要管理端登录（Authorization: Bearer）' })
      return
    }

    if (req.method === 'GET') {
      const rows = await listAccounts()
      corsJson(res)
      res.status(200).json({
        accounts: rows,
        defaultGrantPoints: DEFAULT_GRANT_POINTS,
        tokensPerPoint: TOKENS_PER_POINT,
      })
      return
    }

    let body = {}
    if (req.method === 'POST' || req.method === 'PATCH') {
      body = await readJsonBody(req)
      if (body === null) {
        corsJson(res)
        res.status(400).json({ error: '请求体须为 JSON' })
        return
      }
    }

    if (req.method === 'POST') {
      const username = body.username
      if (typeof username !== 'string' || !username.trim()) {
        corsJson(res)
        res.status(400).json({ error: '请求体须包含非空 username（字符串）' })
        return
      }
      const initialPoints =
        body.initialPoints !== undefined ? Number(body.initialPoints) : DEFAULT_GRANT_POINTS
      const note = body.note
      const created = await createAccount(username, initialPoints, note)
      corsJson(res)
      res.status(201).json({
        ...created,
        warning: 'apiKey 仅本次返回，请保存；数据库只存哈希。',
      })
      return
    }

    if (req.method === 'PATCH') {
      const accountId = body.accountId
      const grantPoints = body.grantPoints
      if (!accountId || typeof accountId !== 'string') {
        corsJson(res)
        res.status(400).json({ error: '需要 accountId' })
        return
      }
      const out = await grantTopUp(accountId, grantPoints, 'admin_topup', { by: 'admin' })
      corsJson(res)
      res.status(200).json(out)
      return
    }

    corsJson(res)
    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('admin-accounts', e)
    corsJson(res)
    const msg = e && e.message
    if (msg && msg.includes('unique')) {
      res.status(409).json({ error: '用户名已存在' })
      return
    }
    if (
      msg &&
      (msg.includes('数据库') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('ENOTFOUND') ||
        /authentication failed|SSL|TLS|certificate/i.test(msg))
    ) {
      res.status(503).json({
        error: String(msg),
        hint: '请检查 Vercel 环境变量 DATABASE_URL / POSTGRES_URL，以及 Neon 等是否允许当前部署区连接',
      })
      return
    }
    res.status(500).json({ error: msg || '服务器错误' })
  }
}
