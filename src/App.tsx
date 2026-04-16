import {
  ClerkProvider,
  SignInButton,
  SignedIn,
  SignedOut,
  useAuth,
  UserButton,
} from '@clerk/clerk-react'
import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react'
import { buildLocalReply } from './chatReply'
import { CREATION_STAGE_OPTIONS, HERO_GREETING, HERO_INTRO, QUICK_CHIPS, WELCOME_MESSAGE } from './copy'
import { fetchHotTrendsMarkdown } from './fetchHotTrends'
import { MessageBody } from './MessageBody'
import {
  loadCreationStage,
  loadDiagExclusive,
  loadHowieKnowledgeBase,
  loadHowiePersonaVoice,
  loadInjectHotRoots,
  loadPersonalContext,
  saveCreationStage,
  saveHkInsuranceAiDiagnostician,
  saveUniversalAiPlanner,
  saveHowieKnowledgeBase,
  saveHowiePersonaVoice,
  saveInjectHotRoots,
  savePersonalContext,
} from './personalStorage'
import { DiagnosticFirstRoundForm, DiagnosticStepper } from './DiagnosticUI'
import { ChatWaitPanel, PinnedRetrievalCard, type PinnedRetrieval } from './StreamProgress'
import { consumeChatSse, mergeMetaToWaitState, type WaitPanelState } from './streamChat'
import './App.css'

type Role = 'user' | 'assistant'

type Msg = {
  id: string
  role: Role
  content: string
}

type SendOpts = {
  webSearchOverride?: boolean
  searchIntent?: 'hotspot' | 'general' | 'none'
  searchQuery?: string
  creationStage?: string
  injectHotRoots?: boolean
  /** true 时本请求走港险 AI 段位诊断师系统提示；未传则用界面开关状态 */
  hkInsuranceAiDiagnostician?: boolean
  /** true 时走各行各业 AI 规划师 / 自我诊断；与港险诊断互斥 */
  universalAiPlanner?: boolean
}

type PersonaRow = { id: string; name: string; updated_at?: string }

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 仅本地 `npm run dev` 生效；生产构建忽略，避免 Vercel 上误配后永远走假回复 */
const USE_LOCAL_ONLY =
  import.meta.env.DEV && import.meta.env.VITE_USE_LOCAL_CHAT === 'true'

function RobotMark({ size = 40 }: { size?: number }) {
  const gid = useId().replace(/:/g, '')
  const gradId = `logo-grad-${gid}`
  return (
    <svg
      className="robot-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill={`url(#${gradId})`} />
      <circle cx="14" cy="16" r="3" fill="#0f172a" />
      <circle cx="26" cy="16" r="3" fill="#0f172a" />
      <path
        d="M12 26 Q20 30 28 26"
        fill="none"
        stroke="#0f172a"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconLightbulb() {
  return (
    <svg className="input-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2a7 7 0 0 0-4 12.74V18a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3.26A7 7 0 0 0 12 2zm-2 18h4v1h-4v-1zm2-16a5 5 0 0 1 3.38 8.62l-.38.35V18h-6v-5.03l-.38-.35A5 5 0 0 1 12 4zM9 21h6v1H9v-1z"
      />
    </svg>
  )
}

function IconSend() {
  return (
    <svg className="send-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M2 21l21-9L2 3v7l15 2-15 2v7z"
      />
    </svg>
  )
}

type ChatAppProps = {
  getToken: () => Promise<string | null>
  hasClerk: boolean
}

function ChatApp({ getToken, hasClerk }: ChatAppProps) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [webSearch, setWebSearch] = useState(false)
  const [pendingWebSearch, setPendingWebSearch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [awaitingToken, setAwaitingToken] = useState(false)
  const [personalDraft, setPersonalDraft] = useState(loadPersonalContext)
  const [howieKnowledgeBase, setHowieKnowledgeBase] = useState(loadHowieKnowledgeBase)
  const [howiePersonaVoice, setHowiePersonaVoice] = useState(loadHowiePersonaVoice)
  const [injectHotRoots, setInjectHotRoots] = useState(loadInjectHotRoots)
  const [creationStage, setCreationStage] = useState(loadCreationStage)
  const [hkInsuranceAiDiagnostician, setHkInsuranceAiDiagnostician] = useState(
    () => loadDiagExclusive().hkInsuranceAiDiagnostician,
  )
  const [universalAiPlanner, setUniversalAiPlanner] = useState(
    () => loadDiagExclusive().universalAiPlanner,
  )
  const [searchQueryDraft, setSearchQueryDraft] = useState('')
  const [personas, setPersonas] = useState<PersonaRow[]>([])
  const [selectedPersonaId, setSelectedPersonaId] = useState('')
  const [personaBusy, setPersonaBusy] = useState(false)
  const [hotTrendsLoading, setHotTrendsLoading] = useState(false)
  const [waitPanel, setWaitPanel] = useState<WaitPanelState | null>(null)
  const [pinnedRetrieval, setPinnedRetrieval] = useState<PinnedRetrieval | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  const waitPanelRef = useRef<WaitPanelState | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    waitPanelRef.current = waitPanel
  }, [waitPanel])

  const refreshPersonas = useCallback(async () => {
    const t = await getToken()
    if (!t) {
      setPersonas([])
      setSelectedPersonaId('')
      return
    }
    try {
      const r = await fetch('/api/persona', { headers: { Authorization: `Bearer ${t}` } })
      if (!r.ok) return
      const j = (await r.json()) as { personas?: PersonaRow[] }
      const list = j.personas ?? []
      setPersonas(list)
      setSelectedPersonaId((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev
        return list[0]?.id ?? ''
      })
    } catch {
      /* ignore */
    }
  }, [getToken])

  useEffect(() => {
    void refreshPersonas()
  }, [refreshPersonas])

  const hasUserMessage = messages.some((m) => m.role === 'user')

  const scrollBottom = useCallback(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    scrollBottom()
  }, [messages, awaitingToken, waitPanel, scrollBottom])

  /** 诊断分支：切换港险/通用或从「无诊断」新进入某一诊断时，清空会话以回到首轮三问表单与步骤 1 */
  const diagBranchKey: 'none' | 'hk' | 'uni' = universalAiPlanner
    ? 'uni'
    : hkInsuranceAiDiagnostician
      ? 'hk'
      : 'none'
  const prevDiagBranchRef = useRef<'none' | 'hk' | 'uni' | undefined>(undefined)
  useEffect(() => {
    const prev = prevDiagBranchRef.current
    prevDiagBranchRef.current = diagBranchKey
    if (prev === undefined) return
    if (prev !== diagBranchKey && diagBranchKey !== 'none') {
      setMessages([])
      messagesRef.current = []
      setPinnedRetrieval(null)
      setWaitPanel(null)
      setInput('')
      setAwaitingToken(false)
      setBusy(false)
      setPendingWebSearch(false)
    }
  }, [diagBranchKey])

  const createDefaultPersona = useCallback(async () => {
    const t = await getToken()
    if (!t) return
    setPersonaBusy(true)
    try {
      const r = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({
          name: '我的人设',
          five_dims: { value: '', audience: '', persona: '', type: '', style: '' },
        }),
      })
      if (r.ok) {
        const row = (await r.json()) as { id: string }
        await refreshPersonas()
        setSelectedPersonaId(row.id)
      }
    } finally {
      setPersonaBusy(false)
    }
  }, [getToken, refreshPersonas])

  const sendText = useCallback(
    async (raw: string, opts?: SendOpts) => {
      const text = raw.trim()
      if (!text || busy) return

      const useWeb =
        opts?.webSearchOverride !== undefined ? opts.webSearchOverride : webSearch

      const userMsg: Msg = { id: uid(), role: 'user', content: text }
      const nextMessages = [...messagesRef.current, userMsg]
      messagesRef.current = nextMessages
      setMessages(nextMessages)
      setInput('')
      setBusy(true)
      setAwaitingToken(true)
      setPendingWebSearch(useWeb)
      setWaitPanel({ phase: 'connecting' })
      setPinnedRetrieval(null)

      const pushAssistant = (id: string, content: string) => {
        setMessages((prev) => {
          const n = [...prev, { id, role: 'assistant' as const, content }]
          messagesRef.current = n
          return n
        })
      }

      const endBusy = () => {
        setAwaitingToken(false)
        setBusy(false)
        setPendingWebSearch(false)
        setWaitPanel(null)
      }

      if (USE_LOCAL_ONLY) {
        await new Promise((r) => setTimeout(r, 420))
        pushAssistant(uid(), buildLocalReply(text))
        endBusy()
        return
      }

      const pinFromWaitState = (w: WaitPanelState | null) => {
        if (!w) return
        if (w.phase === 'search_skipped' && w.skipMessage) {
          setPinnedRetrieval({
            userMsgId: userMsg.id,
            kind: 'skipped',
            items: [],
            message: w.skipMessage,
          })
          return
        }
        if (w.items?.length || w.answer) {
          setPinnedRetrieval({
            userMsgId: userMsg.id,
            kind: 'results',
            query: w.query,
            answer: w.answer,
            items: w.items ?? [],
            message: w.message,
          })
        }
      }

      const personal = loadPersonalContext().trim()
      const sq = (opts?.searchQuery ?? searchQueryDraft).trim().slice(0, 400)
      const intent =
        opts?.searchIntent ??
        (useWeb ? 'general' : 'none')

      const stage = opts?.creationStage ?? creationStage
      const roots = opts?.injectHotRoots ?? injectHotRoots
      const uniPlan =
        opts?.universalAiPlanner !== undefined
          ? opts.universalAiPlanner
          : universalAiPlanner
      const hkDiag =
        opts?.hkInsuranceAiDiagnostician !== undefined
          ? opts.hkInsuranceAiDiagnostician
          : hkInsuranceAiDiagnostician

      const payload: Record<string, unknown> = {
        messages: nextMessages.map(({ role, content }) => ({ role, content })),
        stream: true,
        webSearch: useWeb,
        howieKnowledgeBase,
        howiePersonaVoice,
        injectHotRoots: roots,
      }
      if (uniPlan) payload.universalAiPlanner = true
      else if (hkDiag) payload.hkInsuranceAiDiagnostician = true
      if (personal) payload.personalContext = personal
      if (stage) payload.creationStage = stage
      if (useWeb && intent !== 'none') {
        payload.searchIntent = intent
        if (sq) payload.searchQuery = sq
      }
      if (selectedPersonaId) payload.personaId = selectedPersonaId

      let assistantId: string | null = null

      const token = await getToken()
      const extraHeaders: Record<string, string> = {}
      if (token) extraHeaders.Authorization = `Bearer ${token}`

      const result = await consumeChatSse(
        '/api/chat',
        payload,
        (delta) => {
          if (!assistantId) {
            assistantId = uid()
            const w = waitPanelRef.current
            setAwaitingToken(false)
            setWaitPanel(null)
            pinFromWaitState(w)
            setMessages((prev) => {
              const row: Msg = { id: assistantId!, role: 'assistant', content: delta }
              const n = [...prev, row]
              messagesRef.current = n
              return n
            })
          } else {
            setMessages((prev) => {
              const n = prev.map((m): Msg =>
                m.id === assistantId ? { ...m, content: m.content + delta } : m,
              )
              messagesRef.current = n
              return n
            })
          }
        },
        (meta) => {
          setWaitPanel((prev) => mergeMetaToWaitState(prev, meta))
        },
        extraHeaders,
      )

      endBusy()

      if (result.ok) {
        if (!assistantId) pushAssistant(uid(), '（无内容）')
        return
      }

      if (!assistantId) {
        pushAssistant(
          uid(),
          [
            '未能从 AI 服务取得回复，请按下面排查：',
            '',
            `• 错误信息：${result.error}`,
            '• Vercel → 项目 → Settings → Environment Variables：确认已添加 **DEEPSEEK_API_KEY**，并勾选 **Production**（改完后在 Deployments 里 **Redeploy** 一次）。',
            '• 不要在生产环境变量里设置 **VITE_USE_LOCAL_CHAT**（该变量只应在本地 .env.local 用于纯前端调试）。',
            '• 若仍失败，打开浏览器开发者工具 → Network，查看 **/api/chat** 请求的状态码与响应体。',
          ].join('\n'),
        )
        return
      }

      setMessages((prev) => {
        const n = prev.map((m) =>
          m.id === assistantId ? { ...m, content: `${m.content}\n\n[错误：${result.error}]` } : m,
        )
        messagesRef.current = n
        return n
      })
    },
    [
      busy,
      webSearch,
      howieKnowledgeBase,
      howiePersonaVoice,
      injectHotRoots,
      creationStage,
      hkInsuranceAiDiagnostician,
      universalAiPlanner,
      searchQueryDraft,
      selectedPersonaId,
      getToken,
    ],
  )

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void sendText(input)
  }

  const appendHotTrendsToInput = useCallback(async () => {
    if (busy || hotTrendsLoading) return
    setHotTrendsLoading(true)
    try {
      const out = await fetchHotTrendsMarkdown()
      if ('error' in out) {
        window.alert(out.error)
        return
      }
      const follow =
        '\n\n请根据以上热点参考，结合我的赛道与人设，给我 3～5 个可做短视频的选题方向（每条一句话 + 前 3 秒钩子方向即可）。'
      setInput((prev) => {
        const tail = prev.trim() ? `${prev.trim()}\n\n` : ''
        return `${tail}${out.markdown}${follow}`
      })
    } finally {
      setHotTrendsLoading(false)
    }
  }, [busy, hotTrendsLoading])

  const diagMode = hkInsuranceAiDiagnostician || universalAiPlanner

  const userMessageCount = messages.filter((m) => m.role === 'user').length
  const diagStep: 1 | 2 | 3 =
    userMessageCount >= 2 ? 3 : userMessageCount === 1 ? 2 : 1

  const handleDiagFirstRound = useCallback(
    (job: string, aiUsage: string, goal: string) => {
      const text = `我完成首轮三问，请按你的人设继续问诊（如需再追问 1～2 个关键问题）：\n\n1）工作内容：${job}\n2）AI 使用：${aiUsage}\n3）最想解决：${goal}`
      void sendText(text)
    },
    [sendText],
  )

  return (
    <div className="chat-app">
      <header className="header-brand">
        <RobotMark size={36} />
        <div className="header-brand-text">
          <h1 className="header-title">
            <span className="header-title-gradient">AI Agent</span>
          </h1>
          <p className="header-tagline">智能助手 · 工具调用 · 技能系统</p>
        </div>
        {hasClerk ? (
          <div className="header-auth">
            <SignedOut>
              <SignInButton mode="modal">
                <button type="button" className="chip chip--cta">
                  登录
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
        ) : null}
      </header>

      {diagMode ? <DiagnosticStepper step={diagStep} /> : null}

      <div className="main-area">
        {!hasUserMessage && (
          <section
            className={`hero ${diagMode ? 'hero--diag-form' : ''}`}
            aria-label="欢迎"
          >
            <div className="hero-panel">
              {diagMode ? (
                <DiagnosticFirstRoundForm
                  key={diagBranchKey}
                  busy={busy}
                  variant={universalAiPlanner ? 'universal' : 'hk'}
                  onSubmit={handleDiagFirstRound}
                />
              ) : (
                <>
                  <span className="hero-badge">多模式 · 联网可选</span>
                  <div className="hero-robot">
                    <RobotMark size={72} />
                  </div>
                  <h2 className="hero-greeting">{HERO_GREETING}</h2>
                  <p className="hero-intro">{HERO_INTRO}</p>
                  <details className="hero-details">
                    <summary>查看全部能力与关键词</summary>
                    <pre className="hero-details-pre">{WELCOME_MESSAGE}</pre>
                  </details>
                </>
              )}
            </div>
          </section>
        )}

        {hasUserMessage && (
          <main className="thread" ref={listRef} aria-live="polite">
            {messages.map((msg, i) => (
              <Fragment key={msg.id}>
                <div
                  className={`bubble-row ${msg.role === 'user' ? 'is-user' : 'is-assistant'}`}
                >
                  <div className={`bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                    <MessageBody role={msg.role} content={msg.content} />
                  </div>
                </div>
                {pinnedRetrieval &&
                  msg.role === 'user' &&
                  pinnedRetrieval.userMsgId === msg.id &&
                  messages[i + 1]?.role === 'assistant' && (
                    <div className="bubble-row is-assistant">
                      <PinnedRetrievalCard
                        data={pinnedRetrieval}
                        onDismiss={() => setPinnedRetrieval(null)}
                      />
                    </div>
                  )}
              </Fragment>
            ))}

            {awaitingToken && (
              <div className="bubble-row is-assistant">
                <div className="bubble assistant thinking-bubble thinking-bubble-wide">
                  {waitPanel ? (
                    <ChatWaitPanel state={waitPanel} />
                  ) : (
                    <>
                      <span className="thinking-dot" />
                      {pendingWebSearch ? '正在检索并思考…' : '正在思考…'}
                    </>
                  )}
                </div>
              </div>
            )}
          </main>
        )}
      </div>

      <div className="dock">
        {hasClerk ? (
          <SignedIn>
            <div className="persona-bar">
              <span>云端人设</span>
              <select
                className="dock-select"
                value={selectedPersonaId}
                onChange={(e) => setSelectedPersonaId(e.target.value)}
                disabled={busy || personaBusy}
                aria-label="选择云端人设"
              >
                {personas.length === 0 ? (
                  <option value="">（无人设，请先创建）</option>
                ) : (
                  personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
              <button type="button" disabled={busy || personaBusy} onClick={() => void createDefaultPersona()}>
                新建默认人设
              </button>
              <button type="button" disabled={busy || personaBusy} onClick={() => void refreshPersonas()}>
                刷新
              </button>
            </div>
          </SignedIn>
        ) : null}

        <div className="dock-tools dock-tools-toggles">
          <label className="web-toggle">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              disabled={busy}
            />
            <span>联网搜索</span>
          </label>
          <label className="web-toggle">
            <input
              type="checkbox"
              checked={hkInsuranceAiDiagnostician}
              onChange={(e) => {
                const on = e.target.checked
                setHkInsuranceAiDiagnostician(on)
                saveHkInsuranceAiDiagnostician(on)
                if (on) {
                  setUniversalAiPlanner(false)
                  saveUniversalAiPlanner(false)
                }
              }}
              disabled={busy}
            />
            <span>港险·AI段位诊断师</span>
          </label>
          <label className="web-toggle">
            <input
              type="checkbox"
              checked={universalAiPlanner}
              onChange={(e) => {
                const on = e.target.checked
                setUniversalAiPlanner(on)
                saveUniversalAiPlanner(on)
                if (on) {
                  setHkInsuranceAiDiagnostician(false)
                  saveHkInsuranceAiDiagnostician(false)
                }
              }}
              disabled={busy}
            />
            <span>通用·AI规划师</span>
          </label>
          <label className="web-toggle">
            <input
              type="checkbox"
              checked={howieKnowledgeBase}
              onChange={(e) => {
                const on = e.target.checked
                setHowieKnowledgeBase(on)
                saveHowieKnowledgeBase(on)
              }}
              disabled={busy || diagMode}
            />
            <span>方面陈知识库</span>
          </label>
          <label className="web-toggle">
            <input
              type="checkbox"
              checked={howiePersonaVoice}
              onChange={(e) => {
                const on = e.target.checked
                setHowiePersonaVoice(on)
                saveHowiePersonaVoice(on)
              }}
              disabled={busy || diagMode}
            />
            <span>方面陈演示口吻</span>
          </label>
          <label className="web-toggle">
            <input
              type="checkbox"
              checked={injectHotRoots}
              onChange={(e) => {
                const on = e.target.checked
                setInjectHotRoots(on)
                saveInjectHotRoots(on)
              }}
              disabled={busy || diagMode}
            />
            <span>注入热点词根</span>
          </label>
        </div>
        {diagMode ? (
          <p className="dock-personal-hint" style={{ marginTop: 4, marginBottom: 0 }}>
            {universalAiPlanner
              ? '通用·AI规划师：面向各行各业；不注入方面陈知识库与创作阶段。云端人设与个人补充仍会带上。助理微信已在诊断结果中固定为 hklaochen09。'
              : '港险·AI段位诊断师：不注入方面陈知识库与创作阶段扩展；云端人设与个人补充仍会带上，便于结合你的职责举例。'}
          </p>
        ) : null}

        {webSearch ? (
          <div className="dock-search-query">
            <input
              type="text"
              value={searchQueryDraft}
              onChange={(e) => setSearchQueryDraft(e.target.value)}
              disabled={busy}
              placeholder="联网检索词（可选）：填标准热点名更易搜准，留空则用整句问题检索"
              autoComplete="off"
            />
          </div>
        ) : null}

        <div className="dock-row-tools">
          <label className="web-toggle" style={{ flex: '1 1 200px' }}>
            <span style={{ marginRight: 8 }}>阶段</span>
            <select
              className="dock-select"
              value={creationStage}
              onChange={(e) => {
                const v = e.target.value
                setCreationStage(v)
                saveCreationStage(v)
              }}
              disabled={busy || diagMode}
            >
              {CREATION_STAGE_OPTIONS.map((o) => (
                <option key={o.id || 'default'} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="dock-personal-wrap">
          <details className="dock-personal dock-personal-block">
            <summary>个人补充（仅本浏览器）</summary>
            <p className="dock-personal-hint">
              写口头禅、禁忌、人设语气等偏好。这些内容会附在每次对话请求里发给模型，用来对齐你的风格；文字只保存在当前浏览器的本地存储，换设备或清除站点数据后需重新填写，不会单独上传到云端「个人档案」。
            </p>
            {hkInsuranceAiDiagnostician ? (
              <p className="dock-personal-hint">
                港险·AI段位诊断师：若希望诊断结尾的「想进一步聊」带出真实顾问微信、表单或预约链接，请在此写明（模型会按规范填入，勿编造）；落地页静态展示时也可留空，由页面其他位置承接。
              </p>
            ) : null}
            {universalAiPlanner ? (
              <p className="dock-personal-hint">
                通用·AI规划师：一对一跟进助理微信已固定为 hklaochen09（人设内写入），此处可只填个人语气、行业禁忌等补充。
              </p>
            ) : null}
            <textarea
              className="personal-textarea"
              value={personalDraft}
              onChange={(e) => setPersonalDraft(e.target.value)}
              onBlur={() => savePersonalContext(personalDraft)}
              disabled={busy}
              placeholder={
                hkInsuranceAiDiagnostician
                  ? '例如：官方咨询微信 xxx；或本活动表单链接……（可选）'
                  : universalAiPlanner
                    ? '例如：不说套话、行业禁忌、称呼偏好……（可选）'
                    : '例如：不说「亲们」、多用短句、口头禅……失焦自动保存。'
              }
              rows={3}
              spellCheck={false}
            />
          </details>
        </div>

        <div className="chips" role="toolbar" aria-label="快捷指令">
          <button
            type="button"
            className="chip chip-hot-trends"
            disabled={busy || hotTrendsLoading}
            onClick={() => void appendHotTrendsToInput()}
            title="用 Tavily 检索「微博/小红书」相关网页摘要，填入输入框（非官方热搜 API）"
          >
            {hotTrendsLoading ? '正在拉取热点…' : '拉取微博/小红书热点'}
          </button>
          {QUICK_CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => {
                if (c.hkInsuranceAiDiagnostician) {
                  setHkInsuranceAiDiagnostician(true)
                  saveHkInsuranceAiDiagnostician(true)
                  setUniversalAiPlanner(false)
                  saveUniversalAiPlanner(false)
                }
                if (c.universalAiPlanner) {
                  setUniversalAiPlanner(true)
                  saveUniversalAiPlanner(true)
                  setHkInsuranceAiDiagnostician(false)
                  saveHkInsuranceAiDiagnostician(false)
                }
                void sendText(c.text, {
                  webSearchOverride: c.forceWebSearch ? true : undefined,
                  searchIntent: c.searchIntent,
                  creationStage: c.creationStage,
                  injectHotRoots: c.injectHotRoots,
                  hkInsuranceAiDiagnostician: c.hkInsuranceAiDiagnostician,
                  universalAiPlanner: c.universalAiPlanner,
                })
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <form className="composer" onSubmit={onSubmit}>
          <div className="composer-inner">
            <span className="composer-icon-wrap" aria-hidden>
              <IconLightbulb />
            </span>
            <input
              className="composer-input"
              placeholder={
                diagMode && userMessageCount === 0
                  ? '或在此输入首轮内容（与上方表单二选一）…'
                  : diagMode && userMessageCount === 1
                    ? '第 2 步：回复 AI 的追问…'
                    : diagMode && userMessageCount >= 2
                      ? '第 3 步：可继续追问，或请 AI 输出完整诊断…'
                      : '输入消息…'
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              enterKeyHint="send"
              autoComplete="off"
            />
            <button type="submit" className="send-btn" disabled={busy || !input.trim()} aria-label="发送">
              <IconSend />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ClerkGate() {
  const { isLoaded, getToken } = useAuth()
  if (!isLoaded) {
    return <div className="chat-app chat-boot">加载身份验证…</div>
  }
  return <ChatApp getToken={() => getToken()} hasClerk />
}

export default function App() {
  const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim()
  if (!pk) {
    return <ChatApp getToken={async () => null} hasClerk={false} />
  }
  return (
    <ClerkProvider publishableKey={pk} afterSignOutUrl="/">
      <ClerkGate />
    </ClerkProvider>
  )
}
