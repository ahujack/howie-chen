/**
 * 云端人设身份：Clerk JWT（优先）或计费 X-API-Key（对应 billing_accounts）
 * user_sub 存库格式：Clerk 为 sub 字符串；Key 用户为 billing:<account_uuid>
 */
const { verifyClerkBearer } = require('./auth.cjs')
const { findAccountByApiKey } = require('./billingCore.cjs')

function parseApiKeyFromReq(req) {
  const x = req.headers['x-api-key']
  if (typeof x === 'string' && x.startsWith('sk_')) return x.trim()
  const auth = req.headers.authorization || ''
  const m = auth.match(/^Bearer\s+(sk_[a-fA-F0-9]+)$/i)
  return m ? m[1].trim() : null
}

function billingUserSub(accountId) {
  return `billing:${accountId}`
}

/**
 * @returns {Promise<{ userSub: string, source: 'clerk' | 'billing' } | null>}
 */
async function resolvePersonaUserSub(req) {
  const clerkSub = await verifyClerkBearer(req.headers?.authorization)
  if (clerkSub) return { userSub: clerkSub, source: 'clerk' }
  const apiKey = parseApiKeyFromReq(req)
  if (!apiKey) return null
  const acc = await findAccountByApiKey(apiKey)
  if (!acc) return null
  return { userSub: billingUserSub(acc.id), source: 'billing' }
}

module.exports = {
  parseApiKeyFromReq,
  billingUserSub,
  resolvePersonaUserSub,
}
