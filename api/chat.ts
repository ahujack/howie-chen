import type { VercelRequest, VercelResponse } from '@vercel/node'
import { SYSTEM_PROMPT } from './prompt'
import { searchTavily } from './tavily'

type Role = 'user' | 'assistant'

type ChatTurn = { role: Role; content: string }

function corsJson(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function parseMessages(body: unknown): ChatTurn[] | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { messages?: unknown }).messages
  if (!Array.isArray(raw)) return null

  const out: ChatTurn[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const role = (m as { role?: string }).role
    const content = (m as { content?: string }).content
    if ((role === 'user' || role === 'assistant') && typeof content === 'string') {
      const c = content.slice(0, 32000)
      if (c.length > 0) out.push({ role, content: c })
    }
  }
  return out.length > 0 ? out : null
}

function parseOptions(body: unknown): { webSearch: boolean } {
  if (!body || typeof body !== 'object') return { webSearch: false }
  const b = body as { webSearch?: unknown }
  return { webSearch: b.webSearch === true }
}

function parsePersonalContext(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const p = (body as { personalContext?: unknown }).personalContext
  if (typeof p !== 'string') return undefined
  const t = p.trim()
  if (!t) return undefined
  return t.slice(0, 8000)
}

function buildSystemPrompt(personal?: string): string {
  if (!personal) return SYSTEM_PROMPT
  return `${SYSTEM_PROMPT}

## 用户个人参考（请贴近其语气、节奏与结构偏好；勿编造用户未提供的事实或数据）
${personal}`
}

async function buildTurns(
  recent: ChatTurn[],
  webSearch: boolean,
  tavilyKey: string | undefined,
): Promise<ChatTurn[]> {
  const last = recent[recent.length - 1]
  if (!webSearch || !tavilyKey) return recent

  const ctx = await searchTavily(last.content, tavilyKey)
  if (!ctx) return recent

  const head = recent.slice(0, -1)
  return [
    ...head,
    {
      role: 'user',
      content: `${last.content}\n\n---\n【网络检索结果】（Tavily）\n${ctx}`,
    },
  ]
}

/**
 * Vercel Node Serverless 上 SSE + res.write 易出现 FUNCTION_INVOCATION_FAILED，
 * 此处统一走 DeepSeek 非流式 JSON，由前端一次性展示（仍走 consumeChatSse 的 JSON 分支）。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    const key = process.env.DEEPSEEK_API_KEY
    if (!key) {
      corsJson(res)
      res.status(503).json({ error: '未配置 DEEPSEEK_API_KEY' })
      return
    }

    let body: unknown = req.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body) as unknown
      } catch {
        corsJson(res)
        res.status(400).json({ error: '请求体须为 JSON' })
        return
      }
    }

    const messages = parseMessages(body)
    if (!messages) {
      corsJson(res)
      res.status(400).json({ error: '请求体需包含 messages: { role, content }[]' })
      return
    }

    const { webSearch } = parseOptions(body)
    const systemContent = buildSystemPrompt(parsePersonalContext(body))

    const recent = messages.slice(-24)
    const last = recent[recent.length - 1]
    if (!last || last.role !== 'user') {
      corsJson(res)
      res.status(400).json({ error: '最后一条须为用户消息' })
      return
    }

    const tavilyKey = process.env.TAVILY_API_KEY
    let turns: ChatTurn[]
    try {
      turns = await buildTurns(recent, webSearch, tavilyKey)
    } catch (e) {
      console.error('Tavily', e)
      corsJson(res)
      res.status(502).json({ error: '检索服务异常' })
      return
    }

    const payload = {
      model: 'deepseek-chat',
      messages: [{ role: 'system' as const, content: systemContent }, ...turns],
      temperature: 0.6,
      max_tokens: 4096,
      stream: false,
    }

    const ds = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    })

    if (!ds.ok) {
      const errText = await ds.text().catch(() => '')
      console.error('DeepSeek', ds.status, errText.slice(0, 800))
      corsJson(res)
      res.status(502).json({ error: '大模型请求失败，请稍后重试' })
      return
    }

    const json = (await ds.json()) as {
      choices?: { message?: { content?: string | null } }[]
    }
    const reply = json.choices?.[0]?.message?.content?.trim()
    if (!reply) {
      corsJson(res)
      res.status(502).json({ error: '大模型返回为空' })
      return
    }

    corsJson(res)
    res.status(200).json({ reply })
  } catch (e) {
    console.error('api/chat', e)
    if (!res.headersSent) {
      corsJson(res)
      const msg = e instanceof Error ? e.message : '服务器内部错误'
      res.status(500).json({ error: msg })
    }
  }
}
