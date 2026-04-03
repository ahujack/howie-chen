/**
 * 本地起微型 HTTP，挂载 /api/chat、/api/persona、/api/health。
 * 用法：node scripts/dev-api-server.cjs
 */
const http = require('http')
const { URL } = require('url')
const chatHandler = require('../api/chat.js')
const healthHandler = require('../api/health.js')
const personaHandler = require('../api/persona.js')

const PORT = Number(process.env.PORT || 8787)

function attachVercelLikeRes(nodeRes) {
  const v = {
    headersSent: false,
    _status: 200,
    setHeader(k, val) {
      nodeRes.setHeader(k, val)
    },
    status(code) {
      this._status = code
      return this
    },
    write(chunk) {
      if (!this.headersSent) {
        nodeRes.writeHead(this._status)
        this.headersSent = true
      }
      nodeRes.write(chunk, 'utf8')
    },
    end(chunk) {
      if (!this.headersSent) {
        nodeRes.writeHead(this._status)
        this.headersSent = true
      }
      nodeRes.end(chunk !== undefined ? chunk : '')
    },
    json(obj) {
      const body = JSON.stringify(obj)
      if (!this.headersSent) {
        nodeRes.writeHead(this._status, {
          'Content-Type': 'application/json; charset=utf-8',
        })
        this.headersSent = true
      }
      nodeRes.end(body)
    },
  }
  return v
}

async function readJsonBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

const server = http.createServer(async (req, res) => {
  const full = new URL(req.url || '/', 'http://127.0.0.1')
  const pathname = full.pathname
  const query = Object.fromEntries(full.searchParams.entries())

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      const vres = attachVercelLikeRes(res)
      await Promise.resolve(healthHandler(req, vres))
      return
    }

    if (pathname === '/api/chat') {
      const vres = attachVercelLikeRes(res)
      if (req.method === 'OPTIONS') {
        const mockReq = { method: 'OPTIONS', body: {}, headers: req.headers, query }
        await chatHandler(mockReq, vres)
        return
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        const mockReq = { method: 'POST', body, headers: req.headers, query }
        await chatHandler(mockReq, vres)
        return
      }
    }

    if (pathname === '/api/persona') {
      const vres = attachVercelLikeRes(res)
      if (req.method === 'OPTIONS') {
        const mockReq = { method: 'OPTIONS', body: {}, headers: req.headers, query }
        await personaHandler(mockReq, vres)
        return
      }
      let body = {}
      if (req.method === 'POST' || req.method === 'PATCH') {
        body = await readJsonBody(req)
      }
      const mockReq = { method: req.method, body, headers: req.headers, query }
      await personaHandler(mockReq, vres)
      return
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain')
    res.end('Not found. Try GET /api/health, POST /api/chat, /api/persona')
  } catch (e) {
    console.error(e)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: String(e?.message || e) }))
    }
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dev api: http://127.0.0.1:${PORT}/api/health | /api/chat | /api/persona`)
})
