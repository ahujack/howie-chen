import { useCallback, useEffect, useRef, useState } from 'react'
import { buildLocalReply } from './chatReply'
import { HERO_GREETING, HERO_INTRO, QUICK_CHIPS, WELCOME_MESSAGE } from './copy'
import { loadPersonalContext, savePersonalContext } from './personalStorage'
import { consumeChatSse } from './streamChat'
import './App.css'

type Role = 'user' | 'assistant'

type Msg = {
  id: string
  role: Role
  content: string
}

type SendOpts = {
  webSearchOverride?: boolean
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 仅本地 `npm run dev` 生效；生产构建忽略，避免 Vercel 上误配后永远走假回复 */
const USE_LOCAL_ONLY =
  import.meta.env.DEV && import.meta.env.VITE_USE_LOCAL_CHAT === 'true'

function RobotMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="robot-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden
    >
      <rect width="40" height="40" rx="6" fill="#111" />
      <circle cx="14" cy="16" r="3" fill="#fff" />
      <circle cx="26" cy="16" r="3" fill="#fff" />
      <path
        d="M12 26 Q20 30 28 26"
        fill="none"
        stroke="#fff"
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

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [webSearch, setWebSearch] = useState(false)
  const [pendingWebSearch, setPendingWebSearch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [awaitingToken, setAwaitingToken] = useState(false)
  const [personalDraft, setPersonalDraft] = useState(loadPersonalContext)
  const listRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const hasUserMessage = messages.some((m) => m.role === 'user')

  const scrollBottom = useCallback(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    scrollBottom()
  }, [messages, awaitingToken, scrollBottom])

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
      }

      if (USE_LOCAL_ONLY) {
        await new Promise((r) => setTimeout(r, 420))
        pushAssistant(uid(), buildLocalReply(text))
        endBusy()
        return
      }

      const personal = loadPersonalContext().trim()
      const payload: Record<string, unknown> = {
        messages: nextMessages.map(({ role, content }) => ({ role, content })),
        stream: false,
        webSearch: useWeb,
      }
      if (personal) payload.personalContext = personal

      let assistantId: string | null = null

      const result = await consumeChatSse('/api/chat', payload, (delta) => {
        if (!assistantId) {
          assistantId = uid()
          setAwaitingToken(false)
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
      })

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
    [busy, webSearch],
  )

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void sendText(input)
  }

  return (
    <div className="chat-app">
      <header className="header-brand">
        <RobotMark size={36} />
        <div className="header-brand-text">
          <h1 className="header-title">AI Agent</h1>
          <p className="header-tagline">智能助手 · 工具调用 · 技能系统</p>
        </div>
      </header>

      <div className="main-area">
        {!hasUserMessage && (
          <section className="hero" aria-label="欢迎">
            <div className="hero-robot">
              <RobotMark size={72} />
            </div>
            <h2 className="hero-greeting">{HERO_GREETING}</h2>
            <p className="hero-intro">{HERO_INTRO}</p>
            <details className="hero-details">
              <summary>查看全部能力与关键词</summary>
              <pre className="hero-details-pre">{WELCOME_MESSAGE}</pre>
            </details>
          </section>
        )}

        {hasUserMessage && (
          <main className="thread" ref={listRef} aria-live="polite">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`bubble-row ${msg.role === 'user' ? 'is-user' : 'is-assistant'}`}
              >
                <div className={`bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                  <pre className="bubble-pre">{msg.content}</pre>
                </div>
              </div>
            ))}

            {awaitingToken && (
              <div className="bubble-row is-assistant">
                <div className="bubble assistant thinking-bubble">
                  <span className="thinking-dot" />
                  {pendingWebSearch ? '正在检索并思考…' : '正在思考…'}
                </div>
              </div>
            )}
          </main>
        )}
      </div>

      <div className="dock">
        <div className="dock-tools">
          <label className="web-toggle">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              disabled={busy}
            />
            <span>联网搜索</span>
          </label>
          <details className="dock-personal">
            <summary>个人风格（本机）</summary>
            <textarea
              className="personal-textarea"
              value={personalDraft}
              onChange={(e) => setPersonalDraft(e.target.value)}
              onBlur={() => savePersonalContext(personalDraft)}
              disabled={busy}
              placeholder="爆款片段、口头禅、禁忌等；失焦保存。"
              rows={3}
              spellCheck={false}
            />
          </details>
        </div>

        <div className="chips" role="toolbar" aria-label="快捷指令">
          {QUICK_CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() =>
                void sendText(c.text, {
                  webSearchOverride: c.forceWebSearch ? true : undefined,
                })
              }
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
              placeholder="输入消息…"
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
