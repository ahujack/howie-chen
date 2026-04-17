const { verifyAdminBearer } = require('./adminAuth.js')
const {
  createAccount,
  listAccounts,
  grantTopUp,
  DEFAULT_GRANT_POINTS,
  TOKENS_PER_POINT,
} = require('./billingCore.js')

function corsJson(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
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

    let body = req.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        corsJson(res)
        res.status(400).json({ error: '请求体须为 JSON' })
        return
      }
    }

    if (req.method === 'POST') {
      const username = body.username
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
    res.status(500).json({ error: msg || '服务器错误' })
  }
}
