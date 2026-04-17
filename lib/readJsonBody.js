/**
 * Serverless 中 req.body 有时未自动解析；统一读取 JSON POST/PATCH 体。
 */
async function readJsonBody(req) {
  if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body
  }
  if (typeof req.body === 'string') {
    try {
      return req.body.trim() ? JSON.parse(req.body) : {}
    } catch {
      return null
    }
  }
  if (Buffer.isBuffer(req.body)) {
    try {
      const s = req.body.toString('utf8')
      return s.trim() ? JSON.parse(s) : {}
    } catch {
      return null
    }
  }
  const chunks = []
  try {
    for await (const chunk of req) chunks.push(chunk)
  } catch {
    return null
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

module.exports = { readJsonBody }
