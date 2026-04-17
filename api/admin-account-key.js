const { verifyAdminBearer } = require('../lib/adminAuth.cjs')
const { getFullApiKeyForAdmin } = require('../lib/billingCore.cjs')

function corsJson(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'private, no-store, must-revalidate')
}

const reasonMsg = {
  not_found: '账户不存在',
  no_backup: '该账户无完整 Key 备份（早期仅存哈希）；请重新发卡或新建账户',
  decrypt_failed: '无法解密（请确认 ADMIN_SECRET 与创建时一致）',
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      corsJson(res)
      res.status(204).end()
      return
    }
    if (req.method !== 'GET') {
      corsJson(res)
      res.status(405).json({ error: 'Method not allowed' })
      return
    }
    if (!verifyAdminBearer(req.headers?.authorization)) {
      corsJson(res)
      res.status(401).json({ error: '需要管理端登录（Authorization: Bearer）' })
      return
    }
    const accountId = req.query && (req.query.accountId || req.query.id)
    if (!accountId || typeof accountId !== 'string') {
      corsJson(res)
      res.status(400).json({ error: '需要 query: accountId' })
      return
    }
    const out = await getFullApiKeyForAdmin(accountId.trim())
    if (!out.ok) {
      corsJson(res)
      res.status(404).json({ error: reasonMsg[out.reason] || '无法获取 Key', reason: out.reason })
      return
    }
    corsJson(res)
    res.status(200).json({ apiKey: out.apiKey })
  } catch (e) {
    console.error('admin-account-key', e)
    corsJson(res)
    res.status(500).json({ error: e instanceof Error ? e.message : '服务器错误' })
  }
}
