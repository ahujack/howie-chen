const {
  findAccountByApiKey,
  TOKENS_PER_POINT,
  DEFAULT_GRANT_POINTS,
} = require('../lib/billingCore.js')

function corsJson(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
}

function parseApiKey(req) {
  const x = req.headers['x-api-key']
  if (typeof x === 'string' && x.startsWith('sk_')) return x.trim()
  const auth = req.headers.authorization || ''
  const m = auth.match(/^Bearer\s+(sk_[a-f0-9]+)$/i)
  return m ? m[1].trim() : null
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

    const key = parseApiKey(req)
    if (!key) {
      corsJson(res)
      res.status(401).json({ error: '需要 X-API-Key 或 Bearer sk_…' })
      return
    }

    const acc = await findAccountByApiKey(key)
    if (!acc) {
      corsJson(res)
      res.status(401).json({ error: '无效的 API Key' })
      return
    }

    const estimateCnyPerM = parseFloat(process.env.ESTIMATE_CNY_PER_MILLION_TOKENS || '2', 10)
    const approxTokensPer10Yuan = Math.round((10 / estimateCnyPerM) * 1_000_000)

    corsJson(res)
    res.status(200).json({
      username: acc.username,
      pointsBalance: acc.points_balance,
      apiKeyPrefix: acc.api_key_prefix,
      tokensPerPoint: TOKENS_PER_POINT,
      defaultPackagePoints: DEFAULT_GRANT_POINTS,
      /** 粗算：按每百万 tokens 约多少元人民币，用于展示「¥10 约能买多少量级」 */
      estimateCnyPerMillionTokens: estimateCnyPerM,
      /** 文案用：¥10 按当前估算约等于多少 tokens 的厂商成本量级 */
      approximateTokensFor10YuanCost: approxTokensPer10Yuan,
    })
  } catch (e) {
    console.error('billing-me', e)
    corsJson(res)
    res.status(500).json({ error: e instanceof Error ? e.message : '服务器错误' })
  }
}
