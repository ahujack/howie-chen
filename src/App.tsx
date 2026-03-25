import { useCallback, useEffect, useRef, useState } from 'react'
import { buildLocalReply } from './chatReply'
import { QUICK_CHIPS, WELCOME_MESSAGE } from './copy'
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
  /** 本条消息临时是否联网；不传则沿用顶部开关 */
  webSearchOverride?: boolean
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const USE_LOCAL_ONLY = import.meta.env.VITE_USE_LOCAL_CHAT === 'true'

function RobotMark() {
  return (
    <svg className="robot-mark" viewBox="0 0 40 40" aria-hidden>
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

function IconBrain() {
  return (
    <svg className="input-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2a5 5 0 0 0-5 5v1H6a3 3 0 0 0-3 3v2a3 3 0 0 0 3 3h1v2a5 5 0 0 0 10 0v-2h1a3 3 0 0 0 3-3v-2a3 3 0 0 0-3-3h-1V7a5 5 0 0 0-5-5zm-3 7V7a3 3 0 1 1 6 0v2H9zm-3 4h12v2a1 1 0 0 1-1 1h-2v3a3 3 0 1 1-6 0v-3H7a1 1 0 0 1-1-1v-2z"
      />
    </svg>
  )
}

function IconSend() {
  return (
    <svg className="send-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M3 11.5v1l17.5 7.5 1.5-.5L22 12 22 11.5 21.5 11 4 3.5 2.5 3 3 11.5zm2.13.5L18.5 11 5.13 5.25 5 5.3 5 5.4v6.2l.13.05zm0 1.4v6.2l.13.05L18.5 13 5.13 7.25 5 7.3z"
      />
    </svg>
  )
}

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([
    { id: uid(), role: 'assistant', content: WELCOME_MESSAGE },
  ])
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
        stream: true,
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
        pushAssistant(uid(), buildLocalReply(text))
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
      <header className="top-bar">
        <p className="site-name">AI Agent</p>
      </header>

      <header className="brand">
        <RobotMark />
        <div className="brand-text">
          <h1>AI Agent</h1>
          <p className="tagline">个人向 · 陈科豪体系 · 可选联网</p>
        </div>
      </header>

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

      <div className="tool-row">
        <label className="web-toggle">
          <input
            type="checkbox"
            checked={webSearch}
            onChange={(e) => setWebSearch(e.target.checked)}
            disabled={busy}
          />
          <span className="web-toggle-label">联网搜索（Tavily）</span>
        </label>
        <span className="tool-hint">
          默认关闭省 Token；「热点选题」等芯片会临时联网，不改变此处开关。
        </span>

        <details className="personal-details">
          <summary className="personal-summary">个人风格与参考（本机保存）</summary>
          <textarea
            className="personal-textarea"
            value={personalDraft}
            onChange={(e) => setPersonalDraft(e.target.value)}
            onBlur={() => savePersonalContext(personalDraft)}
            disabled={busy}
            placeholder="粘贴爆款片段、口头禅、禁忌、人设一句话等；失焦自动保存到本机。"
            rows={4}
            spellCheck={false}
          />
          <p className="tool-hint personal-note">
            仅保存在本浏览器；每次发消息会随请求发给模型。勿填密码或极度敏感信息。
          </p>
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
            <IconBrain />
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
  )
}
