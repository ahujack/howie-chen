const crypto = require('crypto')

function getAdminSecret() {
  return process.env.ADMIN_SECRET || ''
}

/**
 * 登录成功后签发 24h token（HMAC），助理在管理后台请求头携带 Authorization: Bearer
 */
function signAdminToken() {
  const secret = getAdminSecret()
  if (!secret || secret.length < 16) return null
  const exp = Date.now() + 86400000
  const sig = crypto.createHmac('sha256', secret).update(String(exp)).digest('hex')
  const payload = JSON.stringify({ exp, sig })
  return Buffer.from(payload, 'utf8').toString('base64url')
}

function verifyAdminBearer(authHeader) {
  const secret = getAdminSecret()
  if (!secret || secret.length < 16) return false
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return false
  const raw = authHeader.slice(7).trim()
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!json.exp || !json.sig) return false
    if (Number(json.exp) < Date.now()) return false
    const expected = crypto.createHmac('sha256', secret).update(String(json.exp)).digest('hex')
    const a = Buffer.from(json.sig, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function verifyAdminPassword(plain) {
  const expected = process.env.ADMIN_PASSWORD || ''
  if (!expected || expected.length < 6) return false
  if (typeof plain !== 'string' || plain.length < 1) return false
  const a = crypto.createHash('sha256').update(`admin:${plain}`, 'utf8').digest()
  const b = crypto.createHash('sha256').update(`admin:${expected}`, 'utf8').digest()
  return crypto.timingSafeEqual(a, b)
}

module.exports = { signAdminToken, verifyAdminBearer, verifyAdminPassword, getAdminSecret }
