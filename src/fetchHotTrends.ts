export type HotTrendsResponse = {
  ok: boolean
  fetchedAt?: string
  markdown?: string
  sources?: Array<{
    id: string
    label: string
    query: string
    answer?: string
    items?: Array<{ title: string; url: string; snippet: string }>
    error?: string
  }>
  error?: string
}

export async function fetchHotTrendsMarkdown(): Promise<{ markdown: string } | { error: string }> {
  const r = await fetch('/api/hot-trends', { method: 'GET' })
  const j = (await r.json()) as HotTrendsResponse
  if (!r.ok) {
    return { error: j.error || `请求失败（${r.status}）` }
  }
  if (!j.ok || !j.markdown) {
    return { error: j.error || '未返回热点内容' }
  }
  return { markdown: j.markdown }
}
