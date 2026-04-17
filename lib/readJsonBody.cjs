/**
 * Serverless 中 req.body 有时未自动解析。
 * 禁止使用无超时的 for-await：在 Vercel 上可能导致挂起直至函数超时，返回非 JSON 的「A server error…」页面。
 */

const DEFAULT_TIMEOUT_MS = 12000

function tryParseBuffer(buf) {
  const s = buf.toString('utf8').trim()
  if (!s) return {}
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function readStreamWithTimeout(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!req || typeof req.on !== 'function') {
      resolve(Buffer.alloc(0))
      return
    }
    if (req.readableEnded) {
      resolve(Buffer.alloc(0))
      return
    }
    const chunks = []
    const to = setTimeout(() => {
      cleanup()
      if (typeof req.destroy === 'function') req.destroy()
      reject(new Error('read_body_timeout'))
    }, timeoutMs)
    function cleanup() {
      clearTimeout(to)
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onErr)
    }
    function onData(c) {
      chunks.push(c)
    }
    function onEnd() {
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    function onErr(e) {
      cleanup()
      reject(e)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onErr)
  })
}

async function readJsonBody(req, timeoutMs = DEFAULT_TIMEOUT_MS) {
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
    return tryParseBuffer(req.body)
  }

  let rawBuf
  try {
    rawBuf = await readStreamWithTimeout(req, timeoutMs)
  } catch (e) {
    if (e && e.message === 'read_body_timeout') {
      return null
    }
    return null
  }
  return tryParseBuffer(rawBuf)
}

module.exports = { readJsonBody }
