const { signAdminToken, verifyAdminPassword, getAdminSecret } = require('../lib/adminAuth.cjs')
const { readJsonBody } = require('../lib/readJsonBody.cjs')

function corsJson(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
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
    if (req.method !== 'POST') {
      corsJson(res)
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    if (!getAdminSecret() || getAdminSecret().length < 16) {
      corsJson(res)
      res.status(503).json({ error: '未配置 ADMIN_SECRET（至少 16 字符）' })
      return
    }

    const body = await readJsonBody(req)
    if (body === null) {
      corsJson(res)
      res.status(400).json({ error: '请求体须为 JSON' })
      return
    }
    const password = body && typeof body.password === 'string' ? body.password : ''
    if (!verifyAdminPassword(password)) {
      corsJson(res)
      res.status(401).json({ error: '密码错误' })
      return
    }

    const token = signAdminToken()
    if (!token) {
      corsJson(res)
      res.status(503).json({ error: '无法签发 token' })
      return
    }

    corsJson(res)
    res.status(200).json({
      token,
      expiresInHours: 24,
      estimateNote:
        '¥10 量级 API 成本粗算约可覆盖数百万 tokens（视 DeepSeek 单价与 ESTIMATE 变量）；默认 1 万积分按 1 积分/100 tokens 折算。',
    })
  } catch (e) {
    console.error('admin-login', e)
    corsJson(res)
    res.status(500).json({ error: e instanceof Error ? e.message : '服务器错误' })
  }
}
