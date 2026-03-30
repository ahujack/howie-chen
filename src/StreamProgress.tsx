import type { WaitPanelState } from './streamChat'

function ProgressRing() {
  return <div className="progress-ring-spinner" aria-hidden />
}

export function ChatWaitPanel({ state }: { state: WaitPanelState }) {
  const { phase, query, answer, items = [], message, injected, skipMessage } = state

  const title =
    phase === 'connecting'
      ? '正在连接…'
      : phase === 'searching'
        ? '正在检索网页'
        : phase === 'search_done'
          ? '检索完成'
          : phase === 'search_skipped'
            ? '联网检索已跳过'
            : '正在生成回答'

  const showList = (phase === 'search_done' || phase === 'generating') && (items.length > 0 || answer)
  const showFootnote =
    (phase === 'search_done' || phase === 'generating') && typeof injected === 'boolean'
      ? injected
        ? '已将检索摘要注入本轮对话。'
        : '未将检索正文注入上下文（模型将主要根据你的问题作答）。'
      : null

  return (
    <div className="wait-panel" role="status">
      <div className="wait-panel-head">
        <ProgressRing />
        <div className="wait-panel-titles">
          <span className="wait-panel-title">{title}</span>
          {phase === 'searching' && query ? (
            <span className="wait-panel-sub">检索词：{query.length > 120 ? `${query.slice(0, 120)}…` : query}</span>
          ) : null}
          {phase === 'search_skipped' && skipMessage ? (
            <span className="wait-panel-sub wait-panel-warn">{skipMessage}</span>
          ) : null}
          {phase === 'generating' && skipMessage ? (
            <span className="wait-panel-sub wait-panel-muted">{skipMessage}</span>
          ) : null}
        </div>
      </div>

      {message && phase !== 'search_skipped' ? (
        <p className="wait-panel-note">{message}</p>
      ) : null}

      {showList ? (
        <div className="wait-panel-body">
          {answer ? (
            <div className="wait-panel-answer">
              <span className="wait-panel-label">检索摘要</span>
              <p>{answer}</p>
            </div>
          ) : null}
          {items.length > 0 ? (
            <ul className="wait-panel-sources">
              {items.map((it, i) => (
                <li key={`${it.url}-${i}`}>
                  <div className="wait-panel-source-title">
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noreferrer noopener">
                        {it.title || '来源'}
                      </a>
                    ) : (
                      <span>{it.title || '来源'}</span>
                    )}
                  </div>
                  {it.snippet ? <p className="wait-panel-snippet">{it.snippet}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {showFootnote ? <p className="wait-panel-foot">{showFootnote}</p> : null}
    </div>
  )
}

export type PinnedRetrieval = {
  userMsgId: string
  kind: 'results' | 'skipped'
  query?: string
  answer?: string
  items: Array<{ title: string; url: string; snippet: string }>
  message?: string
}

export function PinnedRetrievalCard({ data, onDismiss }: { data: PinnedRetrieval; onDismiss: () => void }) {
  return (
    <div className="pinned-retrieval">
      <div className="pinned-retrieval-head">
        <span className="pinned-retrieval-label">
          {data.kind === 'skipped' ? '联网说明' : '本轮检索参考'}
        </span>
        <button type="button" className="pinned-retrieval-dismiss" onClick={onDismiss} aria-label="收起参考">
          收起
        </button>
      </div>
      {data.kind === 'skipped' && data.message ? <p className="pinned-retrieval-note">{data.message}</p> : null}
      {data.kind === 'results' && data.answer ? (
        <div className="pinned-retrieval-answer">
          <span className="wait-panel-label">摘要</span>
          <p>{data.answer}</p>
        </div>
      ) : null}
      {data.kind === 'results' && data.items.length > 0 ? (
        <ul className="pinned-retrieval-list">
          {data.items.map((it, i) => (
            <li key={`${it.url}-${i}`}>
              {it.url ? (
                <a href={it.url} target="_blank" rel="noreferrer noopener">
                  {it.title || '链接'}
                </a>
              ) : (
                <span>{it.title}</span>
              )}
              {it.snippet ? <span className="pinned-retrieval-snippet"> — {it.snippet}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
