export type BillingStreamInfo = { pointsBalance: number; pointsDeducted: number }

type StreamResult =
  | { ok: true; billing?: BillingStreamInfo }
  | { ok: false; error: string }

export type ChatStreamMeta =
  | { phase: 'searching'; query: string; intent?: string }
  | {
      phase: 'search_done'
      query: string
      answer?: string
      items: Array<{ title: string; url: string; snippet: string }>
      message?: string
      injected?: boolean
      quality?: 'weak' | 'ok'
    }
  | { phase: 'search_skipped'; message?: string; reason?: string }
  | { phase: 'generating' }

export type WaitPanelState = {
  phase: 'connecting' | 'searching' | 'search_done' | 'search_skipped' | 'generating'
  query?: string
  answer?: string
  items?: Array<{ title: string; url: string; snippet: string }>
  message?: string
  injected?: boolean
  skipMessage?: string
  searchQuality?: 'weak' | 'ok'
}

export function mergeMetaToWaitState(
  prev: WaitPanelState | null,
  meta: ChatStreamMeta,
): WaitPanelState {
  if (meta.phase === 'searching') {
    return { phase: 'searching', query: meta.query }
  }
  if (meta.phase === 'search_done') {
    return {
      phase: 'search_done',
      query: meta.query,
      answer: meta.answer,
      items: meta.items ?? [],
      message: meta.message,
      injected: meta.injected,
      searchQuality: meta.quality,
    }
  }
  if (meta.phase === 'search_skipped') {
    return {
      phase: 'search_skipped',
      skipMessage: meta.message ?? '已跳过联网检索',
    }
  }
  if (meta.phase === 'generating') {
    const base = prev ?? { phase: 'connecting' as const }
    return {
      phase: 'generating',
      query: base.query,
      answer: base.answer,
      items: base.items,
      message: base.message,
      injected: base.injected,
      skipMessage: base.skipMessage,
      searchQuality: base.searchQuality,
    }
  }
  return prev ?? { phase: 'connecting' }
}

/**
 * 消费 /api/chat 的 SSE（data: {"t":"..."} | {"meta":...} | {"done":true} | {"error":"..."}）
 */
/** Fetch 要求请求头值为 ISO-8859-1；若混入中文等会抛错 */
function latin1HeaderValue(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c <= 255) out += s[i]!
  }
  return out
}

export async function consumeChatSse(
  url: string,
  body: Record<string, unknown>,
  onDelta: (text: string) => void,
  onMeta?: (meta: ChatStreamMeta) => void,
  extraHeaders?: Record<string, string>,
): Promise<StreamResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers[k] = latin1HeaderValue(v)
    }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const ctHeader = res.headers.get('content-type') || ''
  const ct = ctHeader.split(';')[0].trim()

  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    try {
      const j = JSON.parse(raw) as { error?: string }
      if (j?.error) return { ok: false, error: j.error }
    } catch {
      /* 非 JSON */
    }
    if (raw && raw.length < 500 && !raw.trimStart().startsWith('<')) {
      return { ok: false, error: `请求失败（${res.status}）：${raw.slice(0, 240)}` }
    }
    return { ok: false, error: `请求失败（HTTP ${res.status}）` }
  }

  const isSse =
    ct === 'text/event-stream' || (res.headers.get('content-type') || '').includes('text/event-stream')

  if (!isSse || !res.body) {
    if (ctHeader.includes('application/json')) {
      try {
        const j = (await res.json()) as { reply?: string }
        if (j.reply) onDelta(j.reply)
        return { ok: true }
      } catch {
        return { ok: false, error: '无法解析响应' }
      }
    }
    return { ok: false, error: '服务器未返回有效数据' }
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let carry = ''
  let lastBilling: BillingStreamInfo | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    carry += dec.decode(value, { stream: true })

    let sep = carry.indexOf('\n\n')
    while (sep !== -1) {
      const block = carry.slice(0, sep)
      carry = carry.slice(sep + 2)
      for (const line of block.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const raw = trimmed.slice(5).trim()
        if (raw === '[DONE]') continue
        try {
          const json = JSON.parse(raw) as {
            t?: string
            meta?: ChatStreamMeta
            done?: boolean
            error?: string
            billing?: BillingStreamInfo
          }
          if (json.error) return { ok: false, error: json.error }
          if (json.meta && onMeta) onMeta(json.meta)
          if (json.billing) lastBilling = json.billing
          if (json.done) continue
          if (json.t) onDelta(json.t)
        } catch {
          /* 跳过坏包 */
        }
      }
      sep = carry.indexOf('\n\n')
    }
  }

  return { ok: true, billing: lastBilling }
}
