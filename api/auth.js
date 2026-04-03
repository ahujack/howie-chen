/**
 * 校验 Clerk JWT，返回 user sub；未配置或失败返回 null
 */
const { verifyToken } = require('@clerk/backend')

async function verifyClerkBearer(authHeader) {
  const secret = process.env.CLERK_SECRET_KEY
  if (!secret || !authHeader || !authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  if (!token) return null
  try {
    const payload = await verifyToken(token, { secretKey: secret })
    return payload?.sub ?? null
  } catch (e) {
    console.warn('[auth] verifyToken failed', e && e.message)
    return null
  }
}

module.exports = { verifyClerkBearer }
