/**
 * 本目录有 package.json "type":"commonjs"，故可用 module.exports；
 * 根目录仍为 "type":"module"（Vite），互不影响。Vercel 只识别 api/*.js 为 Serverless。
 */

const fs = require('fs')
const path = require('path')

/** OpenClaw / 方面陈 内容创作知识库（与仓库 api/kb-howie-content.md 同步；vercel.json includeFiles 需包含该文件） */
let HOWIE_KB_MD = ''
try {
  HOWIE_KB_MD = fs.readFileSync(path.join(__dirname, 'kb-howie-content.md'), 'utf8')
} catch (e) {
  console.warn('[chat] kb-howie-content.md 未读取:', e && e.message)
}

const SYSTEM_PROMPT = `你是「AI Agent」智能助手，面向中文用户。你的方法论与技能锚定在「陈科豪体系」——用于短视频运营、朋友圈营销与内容增长；不要提及薛辉、安老师等其他体系名称。

## 你能提供的核心能力（按用户意图调用）
- 爆款选题：人设校验、情绪标注、批量选题方向。
- 口播脚本：情绪曲线、注意力管理、分段节奏。
- 开头优化：前 3 秒、多种钩子思路。
- 账号诊断：价值/用户/人设/类型/风格五维与内容线规划。
- 爆款拆解：动力结构、可复用模板、迁移建议。
- 内容复盘：数据归因、迭代动作清单。
- 朋友圈营销：四阶段（埋种子→塑价值→造期待→引爆发）共约 20 条文案思路。
- 代码执行：可审阅 Python/Node 代码、讲清步骤与风险；真实沙箱执行需在服务端受控环境完成，若用户要求「直接运行」，说明安全边界并给出可本地复制的命令或伪执行结果。
- 联网：当用户消息中出现「【网络检索结果】」段落时，必须结合其中要点作答，并提醒时效性；勿编造检索条目中不存在的链接。

## 风格
专业、清晰、可执行；优先给结构化的步骤、清单或小标题；避免空话套话。`

function corsJson(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

/** 流式响应同样需 CORS，否则浏览器读不到 event-stream */
function corsSse(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

/**
 * 读取 DeepSeek（OpenAI 兼容）的 SSE，转发为前端约定的 data: {"t":"片段"}
 */
async function pipeDeepSeekSseToClient(dsResponse, res) {
  if (!dsResponse.body) {
    res.write(`data: ${JSON.stringify({ error: '模型未返回流式正文' })}\n\n`)
    return
  }
  const reader = dsResponse.body.getReader()
  const dec = new TextDecoder()
  let carry = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      carry += dec.decode(value, { stream: true })
      const lines = carry.split('\n')
      carry = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trimEnd()
        if (!trimmed.startsWith('data:')) continue
        const raw = trimmed.slice(5).trim()
        if (raw === '[DONE]') continue
        let j
        try {
          j = JSON.parse(raw)
        } catch {
          continue
        }
        const errObj = j.error
        const errMsg =
          errObj && typeof errObj === 'object'
            ? errObj.message || String(errObj)
            : typeof errObj === 'string'
              ? errObj
              : null
        if (errMsg) {
          res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`)
          return
        }
        const piece = j.choices?.[0]?.delta?.content
        if (typeof piece === 'string' && piece.length > 0) {
          res.write(`data: ${JSON.stringify({ t: piece })}\n\n`)
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
}

function parseMessages(body) {
  if (!body || typeof body !== 'object') return null
  const raw = body.messages
  if (!Array.isArray(raw)) return null
  const out = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const { role, content } = m
    if ((role === 'user' || role === 'assistant') && typeof content === 'string') {
      const c = content.slice(0, 32000)
      if (c.length > 0) out.push({ role, content: c })
    }
  }
  return out.length > 0 ? out : null
}

function parseOptions(body) {
  if (!body || typeof body !== 'object') {
    return { webSearch: false, howieKnowledgeBase: true, stream: true }
  }
  const webSearch = body.webSearch === true
  /** 默认开启；传 howieKnowledgeBase: false 可关闭以省上下文 */
  const howieKnowledgeBase = body.howieKnowledgeBase !== false
  /** 默认流式；传 stream: false 时走整包 JSON（便于测试或特殊客户端） */
  const stream = body.stream !== false
  return { webSearch, howieKnowledgeBase, stream }
}

function parsePersonalContext(body) {
  if (!body || typeof body !== 'object') return undefined
  const p = body.personalContext
  if (typeof p !== 'string') return undefined
  const t = p.trim()
  if (!t) return undefined
  return t.slice(0, 8000)
}

function buildSystemPrompt(personal, useHowieKb) {
  const parts = [SYSTEM_PROMPT]
  if (useHowieKb && HOWIE_KB_MD) {
    const kb = HOWIE_KB_MD.length > 28000 ? HOWIE_KB_MD.slice(0, 28000) + '\n\n…(知识库已截断)' : HOWIE_KB_MD
    parts.push(
      `---\n## 方面陈（Howie）内容创作知识库（OpenClaw Skill）\n` +
        `当用户需要口播/脚本/朋友圈/选题/爆款结构时，必须优先遵守下列人设、禁忌、节奏与案例；` +
        `若用户明确要求其他风格或虚构场景，再按其说明调整。\n\n${kb}`,
    )
  }
  if (personal) {
    parts.push(
      `## 用户个人参考（请贴近其语气、节奏与结构偏好；勿编造用户未提供的事实或数据）\n${personal}`,
    )
  }
  return parts.join('\n\n')
}

/**
 * @returns {{ ctx: string | null, preview: { query: string, answer?: string, items: Array<{title:string,url:string,snippet:string}>, message?: string } }}
 */
async function searchTavilyFull(query, apiKey) {
  const q = query.trim().slice(0, 400)
  const previewBase = { query: q.slice(0, 200), items: [] }
  if (!q) {
    return {
      ctx: null,
      preview: { ...previewBase, message: '检索关键词为空' },
    }
  }
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: q,
      max_results: 6,
      include_answer: true,
      search_depth: 'basic',
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('Tavily HTTP', res.status, errText.slice(0, 500))
    return {
      ctx: null,
      preview: { ...previewBase, message: '检索服务暂时不可用' },
    }
  }
  const data = await res.json()
  const results = data.results ?? []
  const items = results.map((r) => ({
    title: r.title ?? '无标题',
    url: r.url ?? '',
    snippet: (r.content ?? '').replace(/\s+/g, ' ').slice(0, 220),
  }))
  const preview = {
    query: q.slice(0, 200),
    answer: typeof data.answer === 'string' && data.answer.trim() ? data.answer.trim() : undefined,
    items,
  }
  const lines = []
  if (data.answer) {
    lines.push('摘要：', data.answer, '')
  }
  if (results.length > 0) {
    lines.push('摘录：')
    results.forEach((r, i) => {
      const title = r.title ?? '无标题'
      const url = r.url ?? ''
      const snippet = (r.content ?? '').replace(/\s+/g, ' ').slice(0, 360)
      lines.push(`${i + 1}. ${title}${url ? ` — ${url}` : ''}`)
      if (snippet) lines.push(`   ${snippet}`)
    })
  }
  if (lines.length === 0) {
    return {
      ctx: null,
      preview: { ...preview, message: '未返回可用摘要或条目' },
    }
  }
  return { ctx: lines.join('\n'), preview }
}

async function buildTurns(recent, webSearch, tavilyKey) {
  const last = recent[recent.length - 1]
  if (!webSearch || !tavilyKey) return recent
  const { ctx } = await searchTavilyFull(last.content, tavilyKey)
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

module.exports = async function handler(req, res) {
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

    let body = req.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
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

    const { webSearch, howieKnowledgeBase, stream } = parseOptions(body)
    const systemContent = buildSystemPrompt(parsePersonalContext(body), howieKnowledgeBase)

    const recent = messages.slice(-24)
    const last = recent[recent.length - 1]
    if (!last || last.role !== 'user') {
      corsJson(res)
      res.status(400).json({ error: '最后一条须为用户消息' })
      return
    }

    const tavilyKey = process.env.TAVILY_API_KEY

    const payloadBaseForTurns = (turns) => ({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: systemContent }, ...turns],
      temperature: 0.6,
      max_tokens: 4096,
    })

    if (!stream) {
      let turns
      try {
        turns = await buildTurns(recent, webSearch, tavilyKey)
      } catch (e) {
        console.error('Tavily', e)
        corsJson(res)
        res.status(502).json({ error: '检索服务异常' })
        return
      }

      const payloadBase = payloadBaseForTurns(turns)
      const payload = { ...payloadBase, stream: false }
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

      const json = await ds.json()
      const reply = json.choices?.[0]?.message?.content?.trim()
      if (!reply) {
        corsJson(res)
        res.status(502).json({ error: '大模型返回为空' })
        return
      }

      corsJson(res)
      res.status(200).json({ reply })
      return
    }

    /** 流式：先开 SSE，再检索（推送进度），最后拉模型流 */
    corsSse(res)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    if (typeof res.status === 'function') res.status(200)
    else res.statusCode = 200

    try {
      if (typeof res.flushHeaders === 'function') res.flushHeaders()
    } catch {
      /* 部分环境无 flushHeaders */
    }

    const writeSse = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`)
    }

    let turns = recent
    try {
      const lastQ = (last.content || '').slice(0, 200)
      if (webSearch && tavilyKey) {
        writeSse({
          meta: {
            phase: 'searching',
            query: lastQ,
          },
        })
        const { ctx, preview } = await searchTavilyFull(last.content, tavilyKey)
        writeSse({
          meta: {
            phase: 'search_done',
            query: preview.query || lastQ,
            answer: preview.answer,
            items: preview.items,
            message: preview.message,
            injected: Boolean(ctx),
          },
        })
        if (ctx) {
          const head = recent.slice(0, -1)
          turns = [
            ...head,
            {
              role: 'user',
              content: `${last.content}\n\n---\n【网络检索结果】（Tavily）\n${ctx}`,
            },
          ]
        }
      } else if (webSearch && !tavilyKey) {
        writeSse({
          meta: {
            phase: 'search_skipped',
            message: '未配置联网检索密钥（TAVILY_API_KEY），已跳过网页检索',
          },
        })
        turns = recent
      }

      writeSse({ meta: { phase: 'generating' } })

      const payloadStream = { ...payloadBaseForTurns(turns), stream: true }
      const ds = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(payloadStream),
      })

      if (!ds.ok) {
        const errText = await ds.text().catch(() => '')
        console.error('DeepSeek stream', ds.status, errText.slice(0, 800))
        writeSse({ error: '大模型请求失败，请稍后重试' })
        res.end()
        return
      }

      await pipeDeepSeekSseToClient(ds, res)
      res.end()
    } catch (e) {
      console.error('api/chat stream', e)
      if (!res.headersSent) {
        corsJson(res)
        const msg = e instanceof Error ? e.message : '流式输出失败'
        res.status(500).json({ error: msg })
      } else {
        try {
          writeSse({ error: e instanceof Error ? e.message : '流式输出中断' })
        } catch {
          /* ignore */
        }
        res.end()
      }
    }
  } catch (e) {
    console.error('api/chat', e)
    if (!res.headersSent) {
      corsJson(res)
      const msg = e instanceof Error ? e.message : '服务器内部错误'
      res.status(500).json({ error: msg })
    }
  }
}
