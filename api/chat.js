/**
 * 本目录有 package.json "type":"commonjs"，故可用 module.exports；
 * 根目录仍为 "type":"module"（Vite），互不影响。Vercel 只识别 api/*.js 为 Serverless。
 */

const fs = require('fs')
const path = require('path')
const HOT_ROOTS = require('./hotRoots.js')
const { getPool, ensurePersonaTable } = require('./db.js')
const { verifyClerkBearer } = require('./auth.js')

/** OpenClaw / 方面陈 内容创作知识库（与仓库 api/kb-howie-content.md 同步；vercel.json includeFiles 需包含该文件） */
let HOWIE_KB_MD = ''
try {
  HOWIE_KB_MD = fs.readFileSync(path.join(__dirname, 'kb-howie-content.md'), 'utf8')
} catch (e) {
  console.warn('[chat] kb-howie-content.md 未读取:', e && e.message)
}

/** 港险团队 · AI 段位诊断师人设（与方面陈内容创作模式二选一） */
let HK_DIAG_KB_MD = ''
try {
  HK_DIAG_KB_MD = fs.readFileSync(path.join(__dirname, 'kb-hk-insurance-ai-diagnostician.md'), 'utf8')
} catch (e) {
  console.warn('[chat] kb-hk-insurance-ai-diagnostician.md 未读取:', e && e.message)
}

/** 各行各业 · AI 能力自我诊断师 / AI 规划师（与港险诊断、默认创作模式互斥） */
let UNIVERSAL_PLANNER_KB_MD = ''
try {
  UNIVERSAL_PLANNER_KB_MD = fs.readFileSync(path.join(__dirname, 'kb-universal-ai-planner.md'), 'utf8')
} catch (e) {
  console.warn('[chat] kb-universal-ai-planner.md 未读取:', e && e.message)
}

const CREATION_STAGE_HINTS = {
  intake:
    '【创作阶段：需求收集】在输出完整口播/长文案前，先用简短问题确认：行业/赛道、目标人群、转化或传播目标。信息不足时只给方向清单与待补充问题，不要硬写长稿。',
  angle_suggest:
    '【创作阶段：方向建议】只输出选题方向、钩子备选、结构大纲；不要代替用户写定稿。引导用户补充：自身观点、案例、禁忌。',
  draft:
    '【创作阶段：成稿】用户已提供观点/素材时，按爆款结构（吸睛前 3 秒 + 故事/论证带悬念 + 升华）二创成稿；口吻遵循用户人设，非「方面陈演示口吻」时不要港味口癖。',
  revise:
    '【创作阶段：改稿】根据用户修改意见迭代文案，保持人设一致。',
  shooting_tips:
    '【创作阶段：拍摄建议】给出镜头、节奏、字幕/贴纸等可执行建议，避免空泛。',
  recap:
    '【创作阶段：复盘占位】引导用户补充播放/互动数据后做归因与下一版动作清单（若暂无数据则说明需要哪些指标）。',
}

const SYSTEM_PROMPT = `你是「AI Agent」智能助手，面向中文用户。你的方法论与技能锚定在「陈科豪体系」——用于短视频运营、朋友圈营销与内容增长；不要提及薛辉、安老师等其他体系名称。

## 你能提供的核心能力（按用户意图调用）
- 爆款选题：人设校验、情绪标注、批量选题方向。
- 口播脚本：情绪曲线、注意力管理、分段节奏。
- 开头优化：前 3 秒、多种钩子思路。
- 账号诊断：价值/用户/人设/类型/风格五维与内容线规划。
- 爆款拆解：动力结构、可复用模板、迁移建议（口吻跟用户人设，不必港仔化除非用户要求）。
- 内容复盘：数据归因、迭代动作清单。
- 朋友圈营销：四阶段（埋种子→塑价值→造期待→引爆发）共约 20 条文案思路。
- 代码执行：可审阅 Python/Node 代码、讲清步骤与风险；真实沙箱执行需在服务端受控环境完成，若用户要求「直接运行」，说明安全边界并给出可本地复制的命令或伪执行结果。
- 联网：当用户消息中出现「【网络检索结果】」段落时，必须结合其中要点作答，并提醒时效性；勿编造检索条目中不存在的链接。

## 检索忠实度（硬规则）
- 当上下文中包含「【网络检索结果】」时：事实性描述须能被检索摘要支持；与摘要冲突时以检索为准并说明时效性。
- 若检索结果与用户名提到的梗/昵称/热点看似无关，或摘要明显不足：须明确说明「检索未能确认该热点的标准含义」，列出你的假设，并请用户补充：标准说法、大致时间、平台或链接；禁止编造具体事件细节。
- meta 中 quality 为 weak 时，须在答复中提示用户检索结果较弱，建议换关键词或打开联网。

## 风格
专业、清晰、可执行；优先给结构化的步骤、清单或小标题；避免空话套话。`

function corsJson(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

/** 流式响应同样需 CORS，否则浏览器读不到 event-stream */
function corsSse(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
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
    return {
      webSearch: false,
      howieKnowledgeBase: true,
      howiePersonaVoice: false,
      stream: true,
      creationStage: undefined,
      injectHotRoots: false,
      personaId: undefined,
      hkInsuranceAiDiagnostician: false,
      universalAiPlanner: false,
    }
  }
  const webSearch = body.webSearch === true
  const howieKnowledgeBase = body.howieKnowledgeBase !== false
  /** 方面陈「港仔演示」口吻：默认关，大众用户跟自身人设说话 */
  const howiePersonaVoice = body.howiePersonaVoice === true
  const stream = body.stream !== false
  const creationStage =
    typeof body.creationStage === 'string' ? body.creationStage.slice(0, 32) : undefined
  const injectHotRoots = body.injectHotRoots === true
  const personaId = typeof body.personaId === 'string' ? body.personaId.slice(0, 80) : undefined
  /** 港险 AI 段位诊断师模式：与默认「内容创作 / 方面陈」体系互斥，由前端勾选 */
  const hkInsuranceAiDiagnostician = body.hkInsuranceAiDiagnostician === true
  /** 通用 AI 规划师 / 自我诊断师：各行各业；与港险诊断互斥，优先于港险（若前端误传双 true） */
  const universalAiPlanner = body.universalAiPlanner === true
  return {
    webSearch,
    howieKnowledgeBase,
    howiePersonaVoice,
    stream,
    creationStage,
    injectHotRoots,
    personaId,
    hkInsuranceAiDiagnostician,
    universalAiPlanner,
  }
}

function parseSearchOptions(body) {
  if (!body || typeof body !== 'object') {
    return { searchIntent: 'general', searchQuery: undefined }
  }
  const raw = body.searchIntent
  const searchIntent =
    raw === 'hotspot' || raw === 'none' || raw === 'general' ? raw : 'general'
  const sq = body.searchQuery
  const searchQuery = typeof sq === 'string' && sq.trim() ? sq.trim().slice(0, 400) : undefined
  return { searchIntent, searchQuery }
}

function parsePersonalContext(body) {
  if (!body || typeof body !== 'object') return undefined
  const p = body.personalContext
  if (typeof p !== 'string') return undefined
  const t = p.trim()
  if (!t) return undefined
  return t.slice(0, 8000)
}

function formatPersonaRow(row) {
  if (!row) return ''
  let dims = row.five_dims
  if (typeof dims === 'string') {
    try {
      dims = JSON.parse(dims)
    } catch {
      dims = {}
    }
  }
  if (!dims || typeof dims !== 'object') dims = {}
  const lines = [`## 云端人设：${row.name || '未命名'}`]
  const labels = {
    value: '价值',
    audience: '用户',
    persona: '人设',
    type: '类型',
    style: '风格',
  }
  for (const [k, lab] of Object.entries(labels)) {
    const v = dims[k]
    if (typeof v === 'string' && v.trim()) lines.push(`- ${lab}：${v.trim()}`)
  }
  if (row.voice_notes) lines.push(`- 口吻说明：${row.voice_notes}`)
  if (row.taboos) lines.push(`- 禁忌：${row.taboos}`)
  if (row.cases_summary) lines.push(`- 案例/素材摘要：${row.cases_summary}`)
  return lines.join('\n')
}

async function loadPersonaSection(personaId, userSub) {
  if (!personaId || !userSub) return ''
  const pool = getPool()
  if (!pool) return ''
  try {
    await ensurePersonaTable()
    const r = await pool.query(
      `SELECT name, five_dims, voice_notes, taboos, cases_summary FROM creator_personas WHERE id = $1 AND user_sub = $2`,
      [personaId, userSub],
    )
    if (r.rowCount === 0) return ''
    return formatPersonaRow(r.rows[0])
  } catch (e) {
    console.warn('[chat] loadPersona', e && e.message)
    return ''
  }
}

function buildSystemPrompt({
  personal,
  useHowieKb,
  howiePersonaVoice,
  creationStage,
  injectHotRoots,
  structuredPersona,
  hkInsuranceAiDiagnostician,
  universalAiPlanner,
}) {
  if (universalAiPlanner) {
    const kbBody = UNIVERSAL_PLANNER_KB_MD
      ? UNIVERSAL_PLANNER_KB_MD.length > 28000
        ? UNIVERSAL_PLANNER_KB_MD.slice(0, 28000) + '\n\n…(人设规范已截断)'
        : UNIVERSAL_PLANNER_KB_MD
      : '（服务端未读取到 kb-universal-ai-planner.md，请检查部署与 vercel.json includeFiles；在此之前仍按「AI 能力自我诊断师」身份做简短问诊与判定。）'
    const parts = [
      `你是面向各行各业的 **AI 能力自我诊断师**（AI 规划师）。你必须**只**按下方《人设与流程规范》扮演角色，完成两轮问诊与结构化输出；**不要**同时扮演「方面陈」口播教练、陈科豪体系内容营销顾问，也不要主动输出与 AI 段位诊断无关的长篇口播稿或教程，除非用户明确要求切换话题。\n\n---\n\n${kbBody}`,
    ]
    if (structuredPersona) {
      parts.push(`## 用户云端人设（可结合其职责与场景举例）\n${structuredPersona}`)
    }
    if (personal) {
      parts.push(`## 用户个人补充（本机；勿编造未提供的事实）\n${personal}`)
    }
    return parts.join('\n\n')
  }

  if (hkInsuranceAiDiagnostician) {
    const kbBody = HK_DIAG_KB_MD
      ? HK_DIAG_KB_MD.length > 28000
        ? HK_DIAG_KB_MD.slice(0, 28000) + '\n\n…(人设规范已截断)'
        : HK_DIAG_KB_MD
      : '（服务端未读取到 kb-hk-insurance-ai-diagnostician.md，请检查部署与 vercel.json includeFiles；在此之前仍按港险 AI 段位诊断师身份做简短问诊与判定。）'
    const parts = [
      `你是专门服务香港保险团队的 **AI 能力诊断师**。你必须**只**按下方《人设与流程规范》扮演角色，完成段位问诊与判定；**不要**同时扮演「方面陈」口播教练、陈科豪体系内容营销顾问，也不要主动输出与港险 AI 段位诊断无关的长篇口播稿，除非用户明确要求切换话题。\n\n---\n\n${kbBody}`,
    ]
    if (structuredPersona) {
      parts.push(`## 用户云端人设（可结合其职责与场景做港险举例）\n${structuredPersona}`)
    }
    if (personal) {
      parts.push(
        `## 用户个人补充（本机；勿编造未提供的事实）\n${personal}`,
      )
    }
    return parts.join('\n\n')
  }

  const parts = [SYSTEM_PROMPT]

  if (creationStage && CREATION_STAGE_HINTS[creationStage]) {
    parts.push(CREATION_STAGE_HINTS[creationStage])
  }

  if (injectHotRoots && HOT_ROOTS.length > 0) {
    parts.push(
      `## 热点词根参考（选题重构时可选用 0～N 个，结合用户观点说明用法）\n` + HOT_ROOTS.join('、'),
    )
  }

  if (useHowieKb && HOWIE_KB_MD) {
    const kb = HOWIE_KB_MD.length > 28000 ? HOWIE_KB_MD.slice(0, 28000) + '\n\n…(知识库已截断)' : HOWIE_KB_MD
    const voiceLine = howiePersonaVoice
      ? '用户已开启「方面陈演示口吻」：可适度使用知识库中的港式口播示例语气。'
      : '默认不要模仿方面陈港味口播；知识库仅作方法论、结构、节奏、禁忌与案例参考，输出语气须贴近下方用户人设与个人参考。'
    parts.push(
      `---\n## 方面陈（Howie）内容创作知识库（方法论与结构）\n` +
        `${voiceLine}\n\n${kb}`,
    )
  }

  if (structuredPersona) {
    parts.push(structuredPersona)
  }

  if (personal) {
    parts.push(
      `## 用户个人参考（本机补充；请贴近其语气、节奏与结构偏好；勿编造用户未提供的事实或数据）\n${personal}`,
    )
  }
  return parts.join('\n\n')
}

function computeSearchQuality(preview) {
  const hasAns = Boolean(preview.answer && String(preview.answer).trim())
  const n = preview.items?.length ?? 0
  if (!hasAns && n < 2) return 'weak'
  return 'ok'
}

/**
 * @returns {{ ctx: string | null, preview: object }}
 */
async function searchTavilyFull(query, apiKey) {
  const q = query.trim().slice(0, 400)
  const previewBase = { query: q.slice(0, 200), items: [] }
  if (!q) {
    return {
      ctx: null,
      preview: { ...previewBase, message: '检索关键词为空', quality: 'weak' },
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
      preview: { ...previewBase, message: '检索服务暂时不可用', quality: 'weak' },
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
    const p = { ...preview, message: '未返回可用摘要或条目' }
    p.quality = computeSearchQuality(p)
    return { ctx: null, preview: p }
  }
  preview.quality = computeSearchQuality(preview)
  return { ctx: lines.join('\n'), preview }
}

/**
 * 合并主检索 + 热点消歧二次检索
 */
async function runMergedWebSearch(lastUserContent, tavilyKey, searchOpts) {
  const { searchIntent = 'general', searchQuery } = searchOpts
  const fallback = (lastUserContent || '').trim().slice(0, 400)
  const primary = (searchQuery && searchQuery.trim()) || fallback

  const r1 = await searchTavilyFull(primary, tavilyKey)
  let combinedCtx = r1.ctx
  let combinedItems = [...(r1.preview.items || [])]
  let combinedAnswer = r1.preview.answer
  const subMessages = []
  if (r1.preview.message) subMessages.push(r1.preview.message)

  if (searchIntent === 'hotspot' && tavilyKey) {
    const q2 = `${primary.slice(0, 140)} 是什么 网络梗 热搜 事件`.replace(/\s+/g, ' ').trim().slice(0, 400)
    const r2 = await searchTavilyFull(q2, tavilyKey)
    if (r2.preview.message) subMessages.push(`二次检索：${r2.preview.message}`)
    if (r2.ctx) {
      combinedCtx = r1.ctx ? `${r1.ctx}\n\n---\n【二次检索：热点消歧】\n${r2.ctx}` : r2.ctx
      combinedItems = [...combinedItems, ...(r2.preview.items || [])]
      if (!combinedAnswer && r2.preview.answer) combinedAnswer = r2.preview.answer
    }
  }

  const preview = {
    query: primary.slice(0, 200),
    queries: searchIntent === 'hotspot' ? [primary.slice(0, 200), '（含消歧检索）'] : [primary.slice(0, 200)],
    answer: combinedAnswer,
    items: combinedItems.slice(0, 14),
    message: subMessages.length ? subMessages.join('；') : r1.preview.message,
    quality: computeSearchQuality({ answer: combinedAnswer, items: combinedItems }),
  }
  return { ctx: combinedCtx, preview }
}

function injectCtxIntoUserTurn(recent, ctx) {
  const last = recent[recent.length - 1]
  const head = recent.slice(0, -1)
  return [
    ...head,
    {
      role: 'user',
      content: `${last.content}\n\n---\n【网络检索结果】（Tavily）\n${ctx}`,
    },
  ]
}

async function buildTurns(recent, webSearch, tavilyKey, searchOpts) {
  const last = recent[recent.length - 1]
  if (!webSearch || !tavilyKey || searchOpts.searchIntent === 'none') return recent
  const { ctx } = await runMergedWebSearch(last.content, tavilyKey, searchOpts)
  if (!ctx) return recent
  return injectCtxIntoUserTurn(recent, ctx)
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

    const {
      webSearch,
      howieKnowledgeBase,
      howiePersonaVoice,
      stream,
      creationStage,
      injectHotRoots,
      personaId,
      hkInsuranceAiDiagnostician,
      universalAiPlanner,
    } = parseOptions(body)
    const searchOpts = parseSearchOptions(body)

    const authSub = await verifyClerkBearer(req.headers?.authorization)
    const structuredPersona = await loadPersonaSection(personaId, authSub)

    const systemContent = buildSystemPrompt({
      personal: parsePersonalContext(body),
      useHowieKb: howieKnowledgeBase,
      howiePersonaVoice,
      creationStage,
      injectHotRoots,
      structuredPersona,
      hkInsuranceAiDiagnostician: universalAiPlanner ? false : hkInsuranceAiDiagnostician,
      universalAiPlanner,
    })

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
        turns = await buildTurns(recent, webSearch, tavilyKey, searchOpts)
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
      const primaryQ = (searchOpts.searchQuery || (last.content || '').trim()).slice(0, 200)
      if (webSearch && tavilyKey && searchOpts.searchIntent !== 'none') {
        writeSse({
          meta: {
            phase: 'searching',
            query: primaryQ || (last.content || '').slice(0, 200),
            intent: searchOpts.searchIntent,
          },
        })
        const { ctx, preview } = await runMergedWebSearch(last.content, tavilyKey, searchOpts)
        writeSse({
          meta: {
            phase: 'search_done',
            query: preview.query || primaryQ,
            answer: preview.answer,
            items: preview.items,
            message: preview.message,
            injected: Boolean(ctx),
            quality: preview.quality,
          },
        })
        if (ctx) {
          turns = injectCtxIntoUserTurn(recent, ctx)
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
