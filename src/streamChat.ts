type StreamResult = { ok: true } | { ok: false; error: string }

/**
 * 消费 /api/chat 的 SSE（data: {"t":"..."} | {"done":true} | {"error":"..."}）
 */
export async function consumeChatSse(
  url: string,
  body: Record<string, unknown>,
  onDelta: (text: string) => void,
): Promise<StreamResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const ct = res.headers.get('content-type') || ''

  if (!res.ok) {
    if (ct.includes('application/json')) {
      try {
        const j = (await res.json()) as { error?: string }
        return { ok: false, error: j.error || `请求失败（${res.status}）` }
      } catch {
        return { ok: false, error: `请求失败（${res.status}）` }
      }
    }
    return { ok: false, error: `请求失败（${res.status}）` }
  }

  if (!ct.includes('text/event-stream') || !res.body) {
    if (ct.includes('application/json')) {
      try {
        const j = (await res.json()) as { reply?: string }
        if (j.reply) onDelta(j.reply)
        return { ok: true }
      } catch {
        return { ok: false, error: '无法解析响应' }
      }
    }
    return { ok: false, error: '服务器未返回流式数据' }
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
            done?: boolean
            error?: string
          }
          if (json.error) return { ok: false, error: json.error }
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
