import { Fragment, useState } from 'react'

export function DiagnosticStepper({ step }: { step: 1 | 2 | 3 }) {
  const items: { n: 1 | 2 | 3; label: string; hint: string }[] = [
    { n: 1, label: '首轮三问', hint: '工作 / AI / 目标' },
    { n: 2, label: '补充追问', hint: '1～2 个追问' },
    { n: 3, label: '诊断与路径', hint: '段位与行动清单' },
  ]

  return (
    <nav className="diag-stepper" aria-label="诊断进度">
      {items.map((it, i) => {
        const done = step > it.n
        const active = step === it.n
        const prevDone = i > 0 && step > items[i - 1].n
        return (
          <Fragment key={it.n}>
            {i > 0 ? (
              <div
                className={`diag-stepper-line ${prevDone ? 'is-done' : ''}`}
                aria-hidden
              />
            ) : null}
            <div
              className={`diag-step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}`}
              title={it.hint}
            >
              <span className="diag-step-num">{done ? '✓' : it.n}</span>
              <span className="diag-step-text">
                <span className="diag-step-label">{it.label}</span>
                <span className="diag-step-hint">{it.hint}</span>
              </span>
            </div>
          </Fragment>
        )
      })}
    </nav>
  )
}

type Variant = 'hk' | 'universal'

export function DiagnosticFirstRoundForm({
  busy,
  variant,
  onSubmit,
}: {
  busy: boolean
  variant: Variant
  onSubmit: (job: string, aiUsage: string, goal: string) => void
}) {
  const [job, setJob] = useState('')
  const [aiUsage, setAiUsage] = useState('')
  const [goal, setGoal] = useState('')

  const title =
    variant === 'hk' ? '港险 AI 段位诊断' : 'AI 能力自我诊断'
  const subtitle =
    variant === 'hk'
      ? '先完成第 1 步：下面三项会拼成一条消息发出。也可改在底部输入框自行输入首轮内容。'
      : '先完成第 1 步：下面三项会拼成一条消息发出。也可改在底部输入框自行输入首轮内容。'

  const send = () => {
    const j = job.trim()
    const a = aiUsage.trim()
    const g = goal.trim()
    if (!j || !a || !g) {
      window.alert('请把三项都填上，可以简短，但要具体。')
      return
    }
    onSubmit(j, a, g)
  }

  return (
    <div className="diag-first-form">
      <div className="diag-first-head">
        <h2 className="diag-first-title">{title}</h2>
        <p className="diag-first-sub">{subtitle}</p>
      </div>

      <div className="diag-field">
        <label className="diag-field-label" htmlFor="diag-job">
          <span className="diag-field-step">1</span>
          你做什么工作？主要负责哪一块？
        </label>
        <textarea
          id="diag-job"
          className="diag-field-input"
          rows={3}
          disabled={busy}
          placeholder="例如：跨境电商运营 / 港险团队主管 / 独立设计师……"
          value={job}
          onChange={(e) => setJob(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="diag-field">
        <label className="diag-field-label" htmlFor="diag-ai">
          <span className="diag-field-step">2</span>
          平时用不用 AI？用什么？主要干什么？
        </label>
        <textarea
          id="diag-ai"
          className="diag-field-input"
          rows={3}
          disabled={busy}
          placeholder="例如：只用 ChatGPT 写邮件 / 完全没用 / 用 Claude 写脚本……"
          value={aiUsage}
          onChange={(e) => setAiUsage(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="diag-field">
        <label className="diag-field-label" htmlFor="diag-goal">
          <span className="diag-field-step">3</span>
          你最想通过 AI 解决的一个问题？
        </label>
        <textarea
          id="diag-goal"
          className="diag-field-input"
          rows={3}
          disabled={busy}
          placeholder="例如：把周报从 2 小时压到 20 分钟 / 统一团队话术……"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          spellCheck={false}
        />
      </div>

      <button type="button" className="diag-first-submit" disabled={busy} onClick={send}>
        {busy ? '发送中…' : '发送首轮三问'}
      </button>
    </div>
  )
}
