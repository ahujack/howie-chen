import {
  HK_QUICK_CHIPS,
  STUDIO_HOWIE_SCENARIOS,
  type StudioHowieScenario,
  UNIVERSAL_QUICK_CHIPS,
  type QuickChip,
} from './copy'

export type StudioProductMode = 'howie' | 'hk' | 'universal'

type Props = {
  productMode: StudioProductMode
  applyProductMode: (m: StudioProductMode) => void
  onQuickChipClick: (c: QuickChip) => void
  busy: boolean
  freeChatBlocked: boolean
  hotTrendsLoading: boolean
  onHotTrends: () => void
  /** 手机端：爆款第二步场景区默认折叠，首屏只突出三规划师 + 诊断按钮 */
  collapseHowieScenarioGrid?: boolean
}

export function StudioWorkbench({
  productMode,
  applyProductMode,
  onQuickChipClick,
  busy,
  freeChatBlocked,
  hotTrendsLoading,
  onHotTrends,
  collapseHowieScenarioGrid,
}: Props) {
  const howieScenarioGrid = (
    <div className="studio-scenario-grid">
      {STUDIO_HOWIE_SCENARIOS.map((s: StudioHowieScenario) => (
        <button
          key={s.tag}
          type="button"
          className={`studio-scenario-card studio-scenario-card--${s.tagTone}`}
          disabled={busy || freeChatBlocked}
          onClick={() => onQuickChipClick(s.chip)}
        >
          <span className="studio-scenario-tag">{s.tag}</span>
          <span className="studio-scenario-title">{s.title}</span>
          <span className="studio-scenario-sub">{s.sub}</span>
        </button>
      ))}
      <button
        type="button"
        className="studio-scenario-card studio-scenario-card--wide studio-scenario-card--amber"
        disabled={busy || hotTrendsLoading || freeChatBlocked}
        onClick={() => void onHotTrends()}
      >
        <span className="studio-scenario-tag">拉表热点</span>
        <span className="studio-scenario-title">
          {hotTrendsLoading ? '正在拉取…' : '拉取微博 / 小红书热点摘要'}
        </span>
        <span className="studio-scenario-sub">填入输入框后再发</span>
      </button>
    </div>
  )

  return (
    <div className="studio-workbench">
      <div className="studio-step-label">第一步：选一个 AI 规划师</div>
      <div className="studio-planner-grid" role="tablist" aria-label="AI 规划师">
        <button
          type="button"
          role="tab"
          aria-selected={productMode === 'howie'}
          className={`studio-planner-card${productMode === 'howie' ? ' is-active' : ''}`}
          onClick={() => applyProductMode('howie')}
          disabled={busy}
        >
          <span className="studio-planner-name">方面陈爆款</span>
          <span className="studio-planner-sub">做内容</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={productMode === 'hk'}
          className={`studio-planner-card${productMode === 'hk' ? ' is-active' : ''}`}
          onClick={() => applyProductMode('hk')}
          disabled={busy}
        >
          <span className="studio-planner-name">港险 AI 规划师</span>
          <span className="studio-planner-sub">测 AI 段位</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={productMode === 'universal'}
          className={`studio-planner-card${productMode === 'universal' ? ' is-active' : ''}`}
          onClick={() => applyProductMode('universal')}
          disabled={busy}
        >
          <span className="studio-planner-name">通用 AI 规划师</span>
          <span className="studio-planner-sub">测 AI 段位</span>
        </button>
      </div>

      <div className="studio-step-label studio-step-label--2">第二步：{productMode === 'howie' ? '选一个场景' : '开始诊断'}</div>

      {productMode === 'howie' ? (
        collapseHowieScenarioGrid ? (
          <details className="studio-mobile-scenarios-fold">
            <summary>第二步：选场景（点开）</summary>
            {howieScenarioGrid}
          </details>
        ) : (
          howieScenarioGrid
        )
      ) : productMode === 'hk' ? (
        <div className="studio-diag-cta">
          <button
            type="button"
            className="studio-cta-primary"
            disabled={busy || freeChatBlocked}
            onClick={() => onQuickChipClick(HK_QUICK_CHIPS[0]!)}
          >
            开始诊断
          </button>
          <p className="studio-diag-hint">进入港险团队 AI 段位诊断流程；首轮三问在对话区进行。</p>
        </div>
      ) : (
        <div className="studio-diag-cta">
          <button
            type="button"
            className="studio-cta-primary"
            disabled={busy || freeChatBlocked}
            onClick={() => onQuickChipClick(UNIVERSAL_QUICK_CHIPS[0]!)}
          >
            开始诊断
          </button>
          <p className="studio-diag-hint">进入通用行业 AI 能力自我诊断；首轮三问在对话区进行。</p>
        </div>
      )}
    </div>
  )
}
