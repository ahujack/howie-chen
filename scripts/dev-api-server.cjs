/**
 * 本地起微型 HTTP，挂载 /api/chat、/api/health（读环境变量 DEEPSEEK_API_KEY 等）。
 * 用法：node scripts/dev-api-server.cjs
 * 另开终端：curl -s http://127.0.0.1:8787/api/health
 */
const http = require('http')
const chatHandler = require('../api/chat.cjs')
const healthHandler = require('../api/health.cjs')

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

const server = http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0]

  try {
    if (url === '/api/health' && req.method === 'GET') {
      const vres = attachVercelLikeRes(res)
      await Promise.resolve(healthHandler(req, vres))
      return
    }

    if (url === '/api/chat' && req.method === 'POST') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const raw = Buffer.concat(chunks).toString('utf8')
      let body = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        body = {}
      }
      const mockReq = { method: 'POST', body, headers: req.headers }
      const vres = attachVercelLikeRes(res)
      await chatHandler(mockReq, vres)
      return
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain')
    res.end('Not found. Try GET /api/health or POST /api/chat')
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
  console.log(`dev api: http://127.0.0.1:${PORT}/api/health | POST /api/chat`)
})
