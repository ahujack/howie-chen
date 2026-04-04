/**
 * 短期方案：用 Tavily 固定检索词近似「微博 / 小红书」热点（非官方榜单，仅供参考）
 * GET /api/hot-trends
 */

const QUERIES = [
  { id: 'weibo', label: '微博', q: '微博热搜榜 今日 热门话题' },
  { id: 'xiaohongshu', label: '小红书', q: '小红书 热门话题 热点 今日' },
]

function corsJson(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

async function tavilyOnce(query, apiKey) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: query.slice(0, 400),
      max_results: 8,
      include_answer: true,
      search_depth: 'basic',
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    return { ok: false, error: `HTTP ${res.status}`, raw: t.slice(0, 200) }
  }
  const data = await res.json()
  const answer = typeof data.answer === 'string' && data.answer.trim() ? data.answer.trim() : ''
  const items = (data.results ?? []).map((r) => ({
    title: r.title ?? '无标题',
    url: r.url ?? '',
    snippet: (r.content ?? '').replace(/\s+/g, ' ').slice(0, 280),
  }))
  return { ok: true, answer, items }
}

function sectionMarkdown(label, query, answer, items) {
  const lines = [`### ${label}（检索词：${query}）`, '']
  if (answer) {
    lines.push('**摘要：**', answer, '')
  }
  if (items.length > 0) {
    lines.push('**摘录：**')
    items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.title}${it.url ? ` — ${it.url}` : ''}`)
      if (it.snippet) lines.push(`   ${it.snippet}`)
    })
  } else if (!answer) {
    lines.push('（本次未返回有效条目）')
  }
  lines.push('')
  return lines.join('\n')
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      corsJson(res)
      res.status(204).end()
      return
    }

    if (req.method !== 'GET') {
      corsJson(res)
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const key = process.env.TAVILY_API_KEY
    if (!key) {
      corsJson(res)
      res.status(503).json({ error: '未配置 TAVILY_API_KEY，无法拉取热点检索' })
      return
    }

    const results = await Promise.all(
      QUERIES.map(async ({ id, label, q }) => {
        const out = await tavilyOnce(q, key)
        return { id, label, query: q, ...out }
      }),
    )

    const parts = [
      '> 说明：以下为 **Tavily 联网检索** 生成的摘要与网页摘录，**不是**微博/小红书官方热搜 API，时效与排序以搜索引擎为准。',
      '',
    ]

    const payload = { ok: true, fetchedAt: new Date().toISOString(), sources: [] }

    for (const r of results) {
      if (!r.ok) {
        payload.sources.push({
          id: r.id,
          label: r.label,
          query: r.query,
          error: r.error,
        })
        parts.push(`### ${r.label}`, '', `（检索失败：${r.error}）`, '')
        continue
      }
      payload.sources.push({
        id: r.id,
        label: r.label,
        query: r.query,
        answer: r.answer,
        items: r.items,
      })
      parts.push(sectionMarkdown(r.label, r.query, r.answer, r.items))
    }

    payload.markdown = parts.join('\n').trim()

    corsJson(res)
    res.status(200).json(payload)
  } catch (e) {
    console.error('[hot-trends]', e)
    corsJson(res)
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : '服务器错误' })
  }
}
