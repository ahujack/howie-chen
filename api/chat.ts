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

function parseOptions(body: unknown): { stream: boolean; webSearch: boolean } {
  if (!body || typeof body !== 'object') return { stream: false, webSearch: false }
  const b = body as { stream?: unknown; webSearch?: unknown }
  return {
    stream: b.stream === true,
    webSearch: b.webSearch === true,
  }
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

function sseWrite(res: VercelResponse, obj: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

/** 将 DeepSeek/OpenAI 兼容的 SSE 流转成前端消费的精简事件 { t } */
async function pipeDeepSeekSse(
  body: ReadableStream<Uint8Array>,
  res: VercelResponse,
): Promise<void> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let carry = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    carry += dec.decode(value, { stream: true })
    const lines = carry.split('\n')
    carry = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string | null } }[]
        }
        const piece = json.choices?.[0]?.delta?.content
        if (piece) sseWrite(res, { t: piece })
      } catch {
        // 忽略无法解析的行
      }
    }
  }

  if (carry.trim()) {
    const trimmed = carry.trim()
    if (trimmed.startsWith('data:')) {
      const data = trimmed.slice(5).trim()
      if (data && data !== '[DONE]') {
        try {
          const json = JSON.parse(data) as {
            choices?: { delta?: { content?: string | null } }[]
          }
          const piece = json.choices?.[0]?.delta?.content
          if (piece) sseWrite(res, { t: piece })
        } catch {
          /* ignore */
        }
      }
    }
  }

  sseWrite(res, { done: true })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  const messages = parseMessages(req.body)
  if (!messages) {
    corsJson(res)
    res.status(400).json({ error: '请求体需包含 messages: { role, content }[]' })
    return
  }

  const { stream, webSearch } = parseOptions(req.body)
  const systemContent = buildSystemPrompt(parsePersonalContext(req.body))

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
    stream,
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

  if (stream) {
    if (!ds.body) {
      corsJson(res)
      res.status(502).json({ error: '大模型未返回流' })
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })

    const nodeRes = res as VercelResponse & { flushHeaders?: () => void }
    nodeRes.flushHeaders?.()

    try {
      await pipeDeepSeekSse(ds.body, res)
    } catch (e) {
      console.error('Stream pipe', e)
      sseWrite(res, { error: '流式输出中断' })
    }
    res.end()
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
}
