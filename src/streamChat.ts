type StreamResult = { ok: true } | { ok: false; error: string }

export type ChatStreamMeta =
  | { phase: 'searching'; query: string }
  | {
      phase: 'search_done'
      query: string
      answer?: string
      items: Array<{ title: string; url: string; snippet: string }>
      message?: string
      injected?: boolean
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
    }
  }
  return prev ?? { phase: 'connecting' }
}

/**
 * 消费 /api/chat 的 SSE（data: {"t":"..."} | {"meta":...} | {"done":true} | {"error":"..."}）
 */
export async function consumeChatSse(
  url: string,
  body: Record<string, unknown>,
  onDelta: (text: string) => void,
  onMeta?: (meta: ChatStreamMeta) => void,
): Promise<StreamResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
          }
          if (json.error) return { ok: false, error: json.error }
          if (json.meta && onMeta) onMeta(json.meta)
          if (json.done) continue
          if (json.t) onDelta(json.t)
        } catch {
          /* 跳过坏包 */
        }
      }
      sep = carry.indexOf('\n\n')
    }
  }

  return { ok: true }
}
