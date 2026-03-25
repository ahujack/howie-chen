/**
 * 不依赖 Vercel CLI，直接调用 api/chat.js，验证 handler 可运行。
 * 用法：
 *   node scripts/test-chat-local.cjs                    # 无 Key → 期望 503
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/test-chat-local.cjs  # 真请求 DeepSeek
 */
const handler = require('../api/chat.js')

function createRes(label) {
  return {
    headersSent: false,
    _status: 200,
    _headers: {},
    setHeader(k, v) {
      this._headers[k] = v
    },
    status(c) {
      this._status = c
      return this
    },
    end(chunk) {
      this.headersSent = true
      console.log(`\n[${label}] status=${this._status} end`, chunk !== undefined ? String(chunk) : '')
    },
    json(obj) {
      this.headersSent = true
      console.log(`\n[${label}] status=${this._status} json:\n`, JSON.stringify(obj, null, 2))
    },
  }
}

async function run() {
  console.log('--- OPTIONS ---')
  await handler({ method: 'OPTIONS', body: {} }, createRes('OPTIONS'))

  console.log('\n--- POST 无 DEEPSEEK_API_KEY（应 503）---')
  const prev = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  await handler(
    {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: '你好' }],
        stream: false,
        webSearch: false,
      },
    },
    createRes('no-key'),
  )
  if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev

  const key = process.env.DEEPSEEK_API_KEY
  if (!key) {
    console.log('\n未设置 DEEPSEEK_API_KEY，跳过真模型请求。')
    return
  }

  console.log('\n--- POST 真请求 DeepSeek（应 200 + reply）---')
  await handler(
    {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: '只回复两个字：收到' }],
        stream: false,
        webSearch: false,
      },
    },
    createRes('llm'),
  )
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
