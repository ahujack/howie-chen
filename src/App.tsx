import {
  ClerkProvider,
  SignInButton,
  SignedIn,
  SignedOut,
  useAuth,
  UserButton,
} from '@clerk/clerk-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildLocalReply } from './chatReply'
import {
  CREATION_STAGE_OPTIONS,
  HOWIE_QUICK_CHIPS,
  HK_QUICK_CHIPS,
  type QuickChip,
  UNIVERSAL_QUICK_CHIPS,
  WELCOME_MESSAGE,
} from './copy'
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
import {
  loadBillingApiKey,
  loadBillingUsername,
  saveBillingApiKey,
  saveBillingUsername,
} from './billingStorage'
import {
  billingTierDefaultsAdvancedOpen,
  detectBillingKeyTier,
  looksLikeBillingKey,
  normalizeBillingApiKey,
} from './billingKeyUtils'

const BILLING_BAR_COLLAPSED_KEY = 'howie_billing_bar_collapsed_v1'
import {
  getFreeChatLimit,
  getFreeRoundsUsed,
  getTrialChatLimit,
  getTrialRoundsUsed,
  incrementFreeRoundsUsed,
  incrementTrialRoundsUsed,
} from './freeChatLimit'
import { DiagnosticFirstRoundForm, DiagnosticStepper } from './DiagnosticUI'
import { ChatWaitPanel, PinnedRetrievalCard, type PinnedRetrieval } from './StreamProgress'
import { userFacingChatError } from './chatUserError'
import { STUDIO_APP_TITLE, STUDIO_WECHAT_ID } from './studioConstants'
import { StudioWorkbench } from './StudioWorkbench'
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

function PersonaDockBar(props: {
  variant: 'key' | 'clerk'
  selectedPersonaId: string
  personas: PersonaRow[]
  busy: boolean
  personaBusy: boolean
  onSelectId: (id: string) => void
  onCreate: () => void
  onRefresh: () => void
}) {
  const {
    variant,
    selectedPersonaId,
    personas,
    busy,
    personaBusy,
    onSelectId,
    onCreate,
    onRefresh,
  } = props
  return (
    <div className="persona-bar">
      <span>云端人设</span>
      {variant === 'key' ? (
        <span
          className="persona-bar-badge"
          title="使用计费 Key 作为云端账号；与谷歌登录可并存，服务端优先采用已登录身份"
        >
          Key 账号
        </span>
      ) : null}
      <select
        className="dock-select"
        value={selectedPersonaId}
        onChange={(e) => onSelectId(e.target.value)}
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
      <button type="button" disabled={busy || personaBusy} onClick={onCreate}>
        新建默认人设
      </button>
      <button type="button" disabled={busy || personaBusy} onClick={onRefresh}>
        刷新
      </button>
    </div>
  )
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
  const [billingKeyDraft, setBillingKeyDraft] = useState(loadBillingApiKey)
  const [billingUsernameDraft, setBillingUsernameDraft] = useState(loadBillingUsername)
  const [showBillingKeyPlain, setShowBillingKeyPlain] = useState(false)
  const [guardMsg, setGuardMsg] = useState('')
  const [freeTierBump, setFreeTierBump] = useState(0)
  const [studioAdvancedOpen, setStudioAdvancedOpen] = useState(() =>
    billingTierDefaultsAdvancedOpen(loadBillingApiKey()),
  )
  const [pointsBalance, setPointsBalance] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  const waitPanelRef = useRef<WaitPanelState | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    waitPanelRef.current = waitPanel
  }, [waitPanel])

  useEffect(() => {
    if (!looksLikeBillingKey(loadBillingApiKey())) {
      try {
        localStorage.removeItem(BILLING_BAR_COLLAPSED_KEY)
      } catch {
        /* ignore */
      }
    }
  }, [freeTierBump, billingKeyDraft])

  const persistBillingCollapsedPref = (collapsed: boolean) => {
    try {
      localStorage.setItem(BILLING_BAR_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  const saveBillingAndCollapse = () => {
    if (!looksLikeBillingKey(billingKeyDraft)) {
      setGuardMsg(
        '请粘贴完整的管理员下发的 sk_ Key（sk_ 后共 48 位字母数字），或清空后使用免费体验轮次。',
      )
      return
    }
    const k = normalizeBillingApiKey(billingKeyDraft)
    saveBillingApiKey(billingKeyDraft)
    saveBillingUsername(billingUsernameDraft)
    setBillingKeyDraft(k)
    void refreshBilling()
    setGuardMsg('')
    setFreeTierBump((v) => v + 1)
    persistBillingCollapsedPref(true)
    if (billingTierDefaultsAdvancedOpen(k)) setStudioAdvancedOpen(true)
  }

  const buildPersonaFetchHeaders = useCallback(async (): Promise<Record<string, string> | null> => {
    const headers: Record<string, string> = {}
    const t = await getToken()
    const raw = billingKeyDraft || loadBillingApiKey()
    const k = looksLikeBillingKey(raw) ? normalizeBillingApiKey(raw) : ''
    if (t) headers.Authorization = `Bearer ${t}`
    if (k) headers['X-API-Key'] = k
    if (!t && !k) return null
    return headers
  }, [getToken, billingKeyDraft, freeTierBump])

  const refreshPersonas = useCallback(async () => {
    const headers = await buildPersonaFetchHeaders()
    if (!headers) {
      setPersonas([])
      setSelectedPersonaId('')
      return
    }
    try {
      const r = await fetch('/api/persona', { headers })
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
  }, [buildPersonaFetchHeaders])

  useEffect(() => {
    void refreshPersonas()
  }, [refreshPersonas])

  const refreshBilling = useCallback(async () => {
    const raw = loadBillingApiKey()
    if (!looksLikeBillingKey(raw)) {
      setPointsBalance(null)
      return
    }
    const k = normalizeBillingApiKey(raw)
    try {
      const r = await fetch('/api/billing-me', { headers: { 'X-API-Key': k } })
      if (!r.ok) {
        setPointsBalance(null)
        return
      }
      const j = (await r.json()) as { pointsBalance?: number }
      if (typeof j.pointsBalance === 'number') setPointsBalance(j.pointsBalance)
    } catch {
      setPointsBalance(null)
    }
  }, [freeTierBump])

  const clearBillingKeyAndUseFree = useCallback(() => {
    saveBillingApiKey('')
    setBillingKeyDraft('')
    setPointsBalance(null)
    setGuardMsg('')
    setFreeTierBump((v) => v + 1)
    try {
      localStorage.setItem(BILLING_BAR_COLLAPSED_KEY, '0')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refreshBilling()
  }, [refreshBilling])

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
    const headers = await buildPersonaFetchHeaders()
    if (!headers) return
    setPersonaBusy(true)
    try {
      const r = await fetch('/api/persona', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
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
  }, [buildPersonaFetchHeaders, refreshPersonas])

  const sendText = useCallback(
    async (raw: string, opts?: SendOpts) => {
      const text = raw.trim()
      if (!text || busy) return

      const billingKeyRaw = billingKeyDraft || loadBillingApiKey()
      const billingKeyForRequest = looksLikeBillingKey(billingKeyRaw)
        ? normalizeBillingApiKey(billingKeyRaw)
        : ''
      const billingTier = detectBillingKeyTier(billingKeyRaw)

      if (!USE_LOCAL_ONLY) {
        if (!billingKeyForRequest) {
          const lim = getFreeChatLimit()
          if (getFreeRoundsUsed() >= lim) {
            setGuardMsg(
              `免费体验已用完（${lim} 次）。请点右上角「填入 Key」或加微信 ${STUDIO_WECHAT_ID} 领取。`,
            )
            return
          }
        } else if (billingTier === 'trial') {
          const tlim = getTrialChatLimit()
          if (getTrialRoundsUsed() >= tlim) {
            setGuardMsg(`学员试用已用完（${tlim} 次）。请联系 ${STUDIO_WECHAT_ID} 续费或升级 Key。`)
            return
          }
        }
      }

      const hadBillingKey = billingKeyForRequest.length > 0

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
      if (billingKeyForRequest) extraHeaders['X-API-Key'] = billingKeyForRequest

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
        if (result.billing) setPointsBalance(result.billing.pointsBalance)
        if (billingKeyForRequest) {
          saveBillingApiKey(billingKeyForRequest)
          setBillingKeyDraft(billingKeyForRequest)
        }
        if (!USE_LOCAL_ONLY && !hadBillingKey) {
          incrementFreeRoundsUsed()
          setFreeTierBump((v) => v + 1)
        } else if (!USE_LOCAL_ONLY && hadBillingKey && billingTier === 'trial') {
          incrementTrialRoundsUsed()
          setFreeTierBump((v) => v + 1)
        }
        setGuardMsg('')
        if (!assistantId) pushAssistant(uid(), '（无内容）')
        return
      }

      if (!assistantId) {
        console.warn('[chat] 请求失败（详情供排查）:', result.error)
        pushAssistant(uid(), userFacingChatError(result.error))
        return
      }

      console.warn('[chat] 流式错误（详情供排查）:', result.error)
      const friendlyErr = userFacingChatError(result.error)
      setMessages((prev) => {
        const n = prev.map((m) =>
          m.id === assistantId ? { ...m, content: `${m.content}\n\n[错误] ${friendlyErr}` } : m,
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
      billingKeyDraft,
    ],
  )

  const freeChatBlocked = useMemo(() => {
    if (USE_LOCAL_ONLY) return false
    const raw = billingKeyDraft || loadBillingApiKey()
    if (looksLikeBillingKey(raw)) {
      if (detectBillingKeyTier(raw) === 'trial' && getTrialRoundsUsed() >= getTrialChatLimit()) {
        return true
      }
      return false
    }
    return getFreeRoundsUsed() >= getFreeChatLimit()
  }, [freeTierBump, billingKeyDraft])

  const trialRoundsForUi = useMemo(() => {
    const raw = billingKeyDraft || loadBillingApiKey()
    if (!looksLikeBillingKey(raw) || detectBillingKeyTier(raw) !== 'trial') return null
    const lim = getTrialChatLimit()
    const used = getTrialRoundsUsed()
    return { lim, used, rem: Math.max(0, lim - used) }
  }, [freeTierBump, billingKeyDraft])

  const studioVisitor = useMemo(
    () => !looksLikeBillingKey(billingKeyDraft || loadBillingApiKey()),
    [freeTierBump, billingKeyDraft],
  )

  const studioSubtitle = useMemo(() => {
    if (studioVisitor) return '我日常在用的 AI 工作流'
    if (trialRoundsForUi) {
      return `学员版 · 剩余 ${trialRoundsForUi.rem} 次`
    }
    if (pointsBalance != null) {
      return `学员版 · 积分 ${pointsBalance.toLocaleString('zh-CN')}`
    }
    return '学员版 · 已登录'
  }, [studioVisitor, trialRoundsForUi, pointsBalance, freeTierBump, billingKeyDraft])

  const applyProductMode = useCallback((m: 'howie' | 'hk' | 'universal') => {
    if (m === 'howie') {
      setHkInsuranceAiDiagnostician(false)
      saveHkInsuranceAiDiagnostician(false)
      setUniversalAiPlanner(false)
      saveUniversalAiPlanner(false)
    } else if (m === 'hk') {
      setHkInsuranceAiDiagnostician(true)
      saveHkInsuranceAiDiagnostician(true)
      setUniversalAiPlanner(false)
      saveUniversalAiPlanner(false)
    } else {
      setUniversalAiPlanner(true)
      saveUniversalAiPlanner(true)
      setHkInsuranceAiDiagnostician(false)
      saveHkInsuranceAiDiagnostician(false)
    }
  }, [])

  const onQuickChipClick = useCallback(
    (c: QuickChip) => {
      if (busy || freeChatBlocked) return
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
    },
    [busy, freeChatBlocked, sendText],
  )

  const freeRoundsForUi = useMemo(() => {
    if (USE_LOCAL_ONLY) return null
    if (looksLikeBillingKey(billingKeyDraft || loadBillingApiKey())) return null
    const lim = getFreeChatLimit()
    const used = getFreeRoundsUsed()
    return { lim, used, rem: Math.max(0, lim - used) }
  }, [freeTierBump, billingKeyDraft])

  const showPersonaBarByKey = useMemo(
    () => looksLikeBillingKey(billingKeyDraft || loadBillingApiKey()),
    [freeTierBump, billingKeyDraft],
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
  const productMode: 'howie' | 'hk' | 'universal' = universalAiPlanner
    ? 'universal'
    : hkInsuranceAiDiagnostician
      ? 'hk'
      : 'howie'

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

  const studioFooterLine = useMemo(() => {
    if (studioVisitor) {
      const lim = getFreeChatLimit()
      const rem = Math.max(0, lim - getFreeRoundsUsed())
      return `今天还剩 ${rem} 次免费体验 · 加 ${STUDIO_WECHAT_ID} 领 Key`
    }
    if (trialRoundsForUi) {
      return `学员 Key · 剩余 ${trialRoundsForUi.rem} 次 · 有问题 → ${STUDIO_WECHAT_ID}`
    }
    return `已登录 · 有问题 → ${STUDIO_WECHAT_ID}`
  }, [studioVisitor, trialRoundsForUi, freeTierBump, billingKeyDraft])

  const showWorkbenchLayout = !hasUserMessage && !diagMode

  return (
    <div className="chat-app">
      <header className="header-brand header-brand--studio">
        <div className="header-studio-left">
          <div className="studio-logo-mark" aria-hidden>
            方
          </div>
          <div className="header-brand-text">
            <h1 className="header-title header-title--studio">{STUDIO_APP_TITLE}</h1>
            <p className="header-tagline header-tagline--studio">{studioSubtitle}</p>
            <div className="header-billing-row">
              <a className="header-admin-link" href="/admin" target="_blank" rel="noreferrer">
                管理后台
              </a>
            </div>
          </div>
        </div>
        <div className="header-trailing header-trailing--studio">
          {!studioVisitor ? (
            <span className="studio-badge-ok">✓ 已登录</span>
          ) : hasClerk ? (
            <SignedIn>
              <span className="studio-badge-ok">✓ 已登录</span>
            </SignedIn>
          ) : null}
          <button
            type="button"
            className="studio-gear-btn"
            aria-expanded={studioAdvancedOpen}
            onClick={() => setStudioAdvancedOpen((v) => !v)}
          >
            {studioVisitor ? '⚙ 填入 Key' : '⚙ 高级设置'}
          </button>
          {hasClerk ? (
            <div className="header-auth">
              <SignedOut>
                <SignInButton mode="modal">
                  <button type="button" className="chip chip--cta studio-clerk-login">
                    登录
                  </button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <UserButton />
              </SignedIn>
            </div>
          ) : null}
        </div>
      </header>

      {studioVisitor ? (
        <div className="studio-banner studio-banner--visitor">
          <p className="studio-banner-title">
            选一个场景，<strong>免费试一次</strong>
          </p>
          <p className="studio-banner-sub">
            用完想继续？加我微信 <strong>{STUDIO_WECHAT_ID}</strong> 领取专属 Key
          </p>
        </div>
      ) : (
        <div className="studio-banner studio-banner--student">
          <p className="studio-banner-title">欢迎，方面陈课程学员</p>
          <p className="studio-banner-sub">方面陈知识库和港仔语气已默认开启，直接用就行</p>
        </div>
      )}

      {studioAdvancedOpen ? (
        <div className="studio-advanced-panel" id="studio-advanced" role="region" aria-label="高级设置">
      <section className="billing-credential-bar" aria-label="计费账户与 API Key">
        <div className="billing-credential-head">
          <span className="billing-credential-badge">计费登录</span>
          {billingUsernameDraft.trim() ? (
            <span className="billing-credential-nick" title="本地备注，仅自己可见">
              {billingUsernameDraft.trim()}
            </span>
          ) : null}
        </div>
        <div className="billing-credential-fields">
          <label className="billing-credential-field">
            <span className="billing-credential-label">用户名（可选）</span>
            <input
              className="billing-credential-input"
              type="text"
              autoComplete="off"
              value={billingUsernameDraft}
              onChange={(e) => setBillingUsernameDraft(e.target.value)}
              onBlur={() => saveBillingUsername(billingUsernameDraft)}
              disabled={busy}
              placeholder="与后台账户备注一致即可，仅本地显示"
              spellCheck={false}
            />
          </label>
          <label className="billing-credential-field billing-credential-field--key">
            <span className="billing-credential-label">API Key（sk_ 开头，完整 51 位；留空可走免费体验）</span>
            <div className="billing-key-row">
              <div className="billing-key-input-wrap">
                <input
                  className="billing-credential-input billing-key-input"
                  type={showBillingKeyPlain ? 'text' : 'password'}
                  autoComplete="off"
                  value={billingKeyDraft}
                  onChange={(e) => setBillingKeyDraft(e.target.value)}
                  onBlur={() => {
                    saveBillingApiKey(billingKeyDraft)
                    void refreshBilling()
                    if (billingKeyDraft.trim()) setGuardMsg('')
                    setFreeTierBump((v) => v + 1)
                  }}
                  disabled={busy}
                  placeholder="粘贴完整 sk_…（或留空）"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="billing-key-eye"
                  disabled={busy}
                  aria-label={showBillingKeyPlain ? '隐藏 Key' : '显示 Key'}
                  title={showBillingKeyPlain ? '隐藏' : '显示'}
                  onClick={() => setShowBillingKeyPlain((v) => !v)}
                >
                  {showBillingKeyPlain ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                type="button"
                className="chip chip--cta billing-save-collapse-btn"
                disabled={busy}
                onClick={() => saveBillingAndCollapse()}
              >
                保存并收起
              </button>
            </div>
          </label>
        </div>
        <div className="billing-key-actions">
          <button
            type="button"
            className="billing-clear-key-link"
            disabled={busy || (!billingKeyDraft.trim() && !loadBillingApiKey())}
            onClick={() => clearBillingKeyAndUseFree()}
          >
            清除 Key，改用免费体验
          </button>
        </div>
        {freeRoundsForUi ? (
          <p className="billing-free-rounds" role="status">
            未填 Key 时可免费体验约 <strong>{freeRoundsForUi.rem}</strong> / {freeRoundsForUi.lim} 轮对话（已成功回复计 1 轮）；用完后请向助理索取 Key 填在上方。
          </p>
        ) : null}
        <p className="billing-credential-hint">
          与「登录」是两套体系：Clerk 用于人设与同步；此处填管理员下发的 Key（经典 <code>sk_</code> 48 位十六进制，或{' '}
          <code>sk_trial_</code> / <code>sk_team_</code> / <code>sk_admin_</code> 前缀试用与分级权限）。若部署开启{' '}
          <code>BLOCK_ANONYMOUS_CHAT</code>，无 Key 请求可能被拒绝。
        </p>
      </section>

      <p className="studio-advanced-section-title">云端人设</p>
      {hasClerk ? (
        <>
          <SignedIn>
            <PersonaDockBar
              variant="clerk"
              selectedPersonaId={selectedPersonaId}
              personas={personas}
              busy={busy}
              personaBusy={personaBusy}
              onSelectId={setSelectedPersonaId}
              onCreate={() => void createDefaultPersona()}
              onRefresh={() => void refreshPersonas()}
            />
          </SignedIn>
          <SignedOut>
            {showPersonaBarByKey ? (
              <PersonaDockBar
                variant="key"
                selectedPersonaId={selectedPersonaId}
                personas={personas}
                busy={busy}
                personaBusy={personaBusy}
                onSelectId={setSelectedPersonaId}
                onCreate={() => void createDefaultPersona()}
                onRefresh={() => void refreshPersonas()}
              />
            ) : null}
          </SignedOut>
        </>
      ) : showPersonaBarByKey ? (
        <PersonaDockBar
          variant="key"
          selectedPersonaId={selectedPersonaId}
          personas={personas}
          busy={busy}
          personaBusy={personaBusy}
          onSelectId={setSelectedPersonaId}
          onCreate={() => void createDefaultPersona()}
          onRefresh={() => void refreshPersonas()}
        />
      ) : null}

      <p className="studio-advanced-section-title">模型与检索</p>
      <div className="dock-tools dock-tools-toggles studio-advanced-toggles">
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
      {webSearch ? (
        <div className="dock-search-query">
          <input
            type="text"
            value={searchQueryDraft}
            onChange={(e) => setSearchQueryDraft(e.target.value)}
            disabled={busy}
            placeholder="联网检索词（可选）"
            autoComplete="off"
          />
        </div>
      ) : null}
      <div className="dock-row-tools">
        <label className="web-toggle" style={{ flex: '1 1 200px' }}>
          <span style={{ marginRight: 8 }}>创作阶段</span>
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

      <p className="studio-advanced-section-title">个人补充（仅本浏览器）</p>
      <textarea
        className="personal-textarea"
        value={personalDraft}
        onChange={(e) => setPersonalDraft(e.target.value)}
        onBlur={() => savePersonalContext(personalDraft)}
        disabled={busy}
        placeholder="口头禅、禁忌、语气偏好等，会随每次请求发送"
        rows={3}
        spellCheck={false}
      />

      <p className="studio-advanced-section-title">备用快捷指令</p>
      <div className="chips studio-advanced-chips">
        {HOWIE_QUICK_CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            className="chip"
            disabled={busy || freeChatBlocked}
            onClick={() => onQuickChipClick(c)}
          >
            {c.label}
          </button>
        ))}
        {HK_QUICK_CHIPS.map((c) => (
          <button
            key={`hk-${c.label}`}
            type="button"
            className="chip"
            disabled={busy || freeChatBlocked}
            onClick={() => onQuickChipClick(c)}
          >
            {c.label}
          </button>
        ))}
        {UNIVERSAL_QUICK_CHIPS.map((c) => (
          <button
            key={`uni-${c.label}`}
            type="button"
            className="chip"
            disabled={busy || freeChatBlocked}
            onClick={() => onQuickChipClick(c)}
          >
            {c.label}
          </button>
        ))}
      </div>
        </div>
      ) : null}

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
                  freeChatBlocked={freeChatBlocked}
                  variant={universalAiPlanner ? 'universal' : 'hk'}
                  onSubmit={handleDiagFirstRound}
                />
              ) : (
                <div className="hero-panel-studio">
                  <StudioWorkbench
                    productMode={productMode}
                    applyProductMode={applyProductMode}
                    onQuickChipClick={onQuickChipClick}
                    busy={busy}
                    freeChatBlocked={freeChatBlocked}
                    hotTrendsLoading={hotTrendsLoading}
                    onHotTrends={() => void appendHotTrendsToInput()}
                  />
                  <div className="studio-direct-block">
                    <span className="studio-direct-label">或者直接说</span>
                    <textarea
                      className="studio-direct-textarea"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      disabled={busy || freeChatBlocked}
                      placeholder="例：帮我写一条关于香港 DSE 的爆款视频脚本"
                      rows={4}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="studio-direct-send chip chip--cta"
                      disabled={busy || !input.trim() || freeChatBlocked}
                      onClick={() => void sendText(input)}
                    >
                      发送
                    </button>
                  </div>
                  <details className="hero-details">
                    <summary>查看全部能力与关键词</summary>
                    <pre className="hero-details-pre">{WELCOME_MESSAGE}</pre>
                  </details>
                </div>
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
        {!showWorkbenchLayout ? (
          <>
        {hasClerk ? (
          <>
            <SignedIn>
              <PersonaDockBar
                variant="clerk"
                selectedPersonaId={selectedPersonaId}
                personas={personas}
                busy={busy}
                personaBusy={personaBusy}
                onSelectId={setSelectedPersonaId}
                onCreate={() => void createDefaultPersona()}
                onRefresh={() => void refreshPersonas()}
              />
            </SignedIn>
            <SignedOut>
              {showPersonaBarByKey ? (
                <PersonaDockBar
                  variant="key"
                  selectedPersonaId={selectedPersonaId}
                  personas={personas}
                  busy={busy}
                  personaBusy={personaBusy}
                  onSelectId={setSelectedPersonaId}
                  onCreate={() => void createDefaultPersona()}
                  onRefresh={() => void refreshPersonas()}
                />
              ) : null}
            </SignedOut>
          </>
        ) : showPersonaBarByKey ? (
          <PersonaDockBar
            variant="key"
            selectedPersonaId={selectedPersonaId}
            personas={personas}
            busy={busy}
            personaBusy={personaBusy}
            onSelectId={setSelectedPersonaId}
            onCreate={() => void createDefaultPersona()}
            onRefresh={() => void refreshPersonas()}
          />
        ) : null}

        <div className="dock-mode-tabs" role="tablist" aria-label="产品模式">
          <button
            type="button"
            role="tab"
            aria-selected={productMode === 'howie'}
            className={`dock-mode-tab${productMode === 'howie' ? ' is-active' : ''}`}
            onClick={() => applyProductMode('howie')}
            disabled={busy}
          >
            方面陈爆款
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={productMode === 'hk'}
            className={`dock-mode-tab${productMode === 'hk' ? ' is-active' : ''}`}
            onClick={() => applyProductMode('hk')}
            disabled={busy}
          >
            港险 AI 规划师
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={productMode === 'universal'}
            className={`dock-mode-tab${productMode === 'universal' ? ' is-active' : ''}`}
            onClick={() => applyProductMode('universal')}
            disabled={busy}
          >
            通用 AI 规划师
          </button>
        </div>

        <p className="dock-mode-panel-hint">
          {productMode === 'howie'
            ? '选题、脚本、朋友圈、热点等创作能力；先选模式再点下方快捷句，减少干扰。'
            : productMode === 'hk'
              ? '港险团队 AI 段位诊断流程；与方面陈口播创作互不叠加。'
              : '全行业 AI 能力自我诊断 / 规划；与方面陈创作互不叠加。'}
        </p>

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
          {productMode === 'howie' ? (
            <>
              <label className="web-toggle">
                <input
                  type="checkbox"
                  checked={howieKnowledgeBase}
                  onChange={(e) => {
                    const on = e.target.checked
                    setHowieKnowledgeBase(on)
                    saveHowieKnowledgeBase(on)
                  }}
                  disabled={busy}
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
                  disabled={busy}
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
                  disabled={busy}
                />
                <span>注入热点词根</span>
              </label>
            </>
          ) : null}
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

        {productMode === 'howie' ? (
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
                disabled={busy}
              >
                {CREATION_STAGE_OPTIONS.map((o) => (
                  <option key={o.id || 'default'} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

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
          {productMode === 'howie' ? (
            <>
              <button
                type="button"
                className="chip chip-hot-trends"
                disabled={busy || hotTrendsLoading}
                onClick={() => void appendHotTrendsToInput()}
                title="用 Tavily 检索「微博/小红书」相关网页摘要，填入输入框（非官方热搜 API）"
              >
                {hotTrendsLoading ? '正在拉取热点…' : '拉取微博/小红书热点'}
              </button>
              {HOWIE_QUICK_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className="chip"
                  disabled={busy || freeChatBlocked}
                  onClick={() => onQuickChipClick(c)}
                >
                  {c.label}
                </button>
              ))}
            </>
          ) : productMode === 'hk' ? (
            HK_QUICK_CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                className="chip"
                disabled={busy || freeChatBlocked}
                onClick={() => onQuickChipClick(c)}
              >
                {c.label}
              </button>
            ))
          ) : (
            UNIVERSAL_QUICK_CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                className="chip"
                disabled={busy || freeChatBlocked}
                onClick={() => onQuickChipClick(c)}
              >
                {c.label}
              </button>
            ))
          )}
        </div>
          </>
        ) : null}

        {showWorkbenchLayout ? (
          <div className="studio-footer-bar">
            <span className="studio-footer-text">{studioFooterLine}</span>
          </div>
        ) : null}

        {guardMsg ? (
          <div className="chat-guard-banner" role="alert">
            {guardMsg}
          </div>
        ) : null}
        <form className={`composer${showWorkbenchLayout ? ' composer--studio-min' : ''}`} onSubmit={onSubmit}>
          <div className="composer-inner">
            <span className="composer-icon-wrap" aria-hidden>
              <IconLightbulb />
            </span>
            {!showWorkbenchLayout ? (
            <input
              className="composer-input"
              placeholder={
                freeChatBlocked
                  ? '免费轮次已用完，请点右上角「填入 Key」或加微信领 Key'
                  : diagMode && userMessageCount === 0
                    ? '或在此输入首轮内容（与上方表单二选一）…'
                    : diagMode && userMessageCount === 1
                      ? '第 2 步：回复 AI 的追问…'
                      : diagMode && userMessageCount >= 2
                        ? '第 3 步：可继续追问，或请 AI 输出完整诊断…'
                        : '输入消息…'
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy || freeChatBlocked}
              enterKeyHint="send"
              autoComplete="off"
            />
            ) : (
              <span className="composer-input composer-input--studio-hint">
                在上方大框编辑后，点此发送
              </span>
            )}
            <button
              type="submit"
              className="send-btn"
              disabled={busy || !input.trim() || freeChatBlocked}
              aria-label="发送"
            >
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
