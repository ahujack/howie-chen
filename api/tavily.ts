type TavilyResult = {
  title?: string
  url?: string
  content?: string
}

type TavilyResponse = {
  answer?: string
  results?: TavilyResult[]
}

export async function searchTavily(query: string, apiKey: string): Promise<string | null> {
  const q = query.trim().slice(0, 400)
  if (!q) return null

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
    return null
  }

  const data = (await res.json()) as TavilyResponse
  const lines: string[] = []

  if (data.answer) {
    lines.push('摘要：', data.answer, '')
  }

  const results = data.results ?? []
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

  if (lines.length === 0) return null
  return lines.join('\n')
}
