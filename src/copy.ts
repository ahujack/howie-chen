/** 首屏问候（短） */
export const HERO_GREETING = '你好，有什么可以帮你？'

export const HERO_INTRO =
  '我可以结合联网检索（可选）协助你：短视频选题与脚本、开头优化、账号诊断、朋友圈文案等；默认叠加「方面陈 · 内容创作方法论知识库」。底部可一键「拉取微博/小红书热点」（Tavily 检索摘要，非官方榜单）。登录后可同步「云端人设」（五维等）到对话。'

/** 首条助手介绍（品牌：陈科豪体系）— 放在「查看全部能力」里 */
export const WELCOME_MESSAGE = `我可以作为您的智能助手，协助您处理短视频运营、朋友圈营销以及代码执行等相关任务。具体来说，我能为您做以下事情：

🚀 短视频创作与运营（基于陈科豪体系）

1. 爆款选题生成
帮您批量生成具有爆款潜质的视频选题，内置人设校验和情绪标注。
关键词：爆款选题、生成选题、帮我想选题

2. 脚本撰写
生成带情绪曲线和注意力管理的完整短视频口播脚本（口吻默认跟您的人设，非「方面陈演示口吻」时不港仔化）。
关键词：写脚本、生成脚本、帮我写口播

3. 开头优化
针对前3秒黄金时间，利用多种钩子思路优化视频开头，提升留存率。
关键词：优化开头、改开篇、帮我写开头

4. 账号诊断
从价值、用户、人设、类型、风格五维定位您的账号，并规划流量路径和内容线。
关键词：账号诊断、诊断我的账号、账号策划

5. 爆款视频拆解
深度分析任意爆款视频的动力结构，输出可复用模板；口吻可跟您的人设二创。
关键词：拆爆款、分析这条视频、帮我拆解

6. 内容复盘
对已发布视频进行数据诊断和归因分析，输出下一步迭代行动方案。
关键词：复盘、帮我复盘、分析数据

📱 朋友圈营销

朋友圈文案生成
围绕新品上市或大型活动，生成「埋种子→塑价值→造期待→引爆发」四个阶段的营销朋友圈内容。
关键词：写朋友圈、帮我写朋友圈、上新朋友圈

💻 技术与工具支持

代码执行
可审阅 Python/Node 代码、讲清步骤与风险。

联网搜索
勾选「联网搜索」时通过 Tavily 检索；热点类建议在「联网检索词」里填标准热点名，并优先用「热点解读」类快捷指令（含二次消歧检索）。

云端人设（需登录 + DATABASE_URL）
在 Vercel 配置 Postgres 与 Clerk 后，可创建人设并随对话注入；本机「个人补充」仍可作临时补充。

方面陈知识库 vs 演示口吻
「方面陈知识库」注入方法论与结构；「方面陈演示口吻」单独开关，打开后可用港式口播示例语气。

创作阶段
可在下方选择「收集需求 / 方向建议 / 成稿」等，引导模型分步输出。

——
直接说出您的需求或点击下方快捷指令即可开始。`

/** 热点向：自动联网检索后再让模型结合陈科豪体系出选题 */
export const HOT_TOPIC_PROMPT = `请先根据检索到的近日热点/话题，结合陈科豪体系，给我 5 个短视频选题。
每个选题请包含：一句话选题、适合谁看、前 3 秒钩子方向、情绪标签、可延伸的关键词。
若我不曾说明赛道或人设，请先列出你需要我补充的 3 个要点，再给一版「待定赛道」的示例选题。
（请在发送前于下方「联网检索词」填写你要跟的热点关键词，便于检索准确。）`

export const CREATION_STAGE_OPTIONS: { id: string; label: string }[] = [
  { id: '', label: '创作阶段：不限' },
  { id: 'intake', label: '收集需求（先问行业/人群/目标）' },
  { id: 'angle_suggest', label: '只给方向（不成稿）' },
  { id: 'draft', label: '成稿（需我已提供观点/素材）' },
  { id: 'revise', label: '改稿' },
  { id: 'shooting_tips', label: '拍摄建议' },
  { id: 'recap', label: '复盘（占位）' },
]

export type QuickChip = {
  label: string
  text: string
  /** 发送本条时临时打开联网，不改变顶部开关状态 */
  forceWebSearch?: boolean
  searchIntent?: 'hotspot' | 'general'
  creationStage?: string
  injectHotRoots?: boolean
  /** 为 true 时启用港险 AI 段位诊断师模式并勾选底部开关 */
  hkInsuranceAiDiagnostician?: boolean
  /** 为 true 时启用各行各业 AI 规划师 / 自我诊断 */
  universalAiPlanner?: boolean
}

export const QUICK_CHIPS: QuickChip[] = [
  {
    label: '通用·AI规划师',
    text: '你好，我想做一下 AI 能力自我诊断（不限行业）。',
    universalAiPlanner: true,
  },
  {
    label: '港险·AI诊断',
    text: '你好，我想开始港险 AI 段位诊断。',
    hkInsuranceAiDiagnostician: true,
  },
  {
    label: '热点解读',
    text:
      '我想基于一个网络热点，先联网搞清楚「这个热点在讲什么」，再结合我的人设给「讲解角度与结构建议」（本步先不要写完整口播稿）。热点名称或检索词：',
    forceWebSearch: true,
    searchIntent: 'hotspot',
    creationStage: 'intake',
  },
  { label: '热点选题', text: HOT_TOPIC_PROMPT, forceWebSearch: true, searchIntent: 'hotspot' },
  { label: '爆款选题', text: '帮我做爆款选题', creationStage: 'angle_suggest' },
  {
    label: '词根重构',
    text:
      '请结合下方注入的「热点词根」列表，把我的选题/观点重构成：吸睛 3 秒开头 + 故事铺开（悬念/转折/论证）+ 升华 的整体结构；先列提纲再问我是否成稿。',
    injectHotRoots: true,
    creationStage: 'angle_suggest',
  },
  { label: '写脚本', text: '帮我写一条口播脚本', creationStage: 'draft' },
  { label: '优化开头', text: '帮我优化视频开头' },
  { label: '账号诊断', text: '账号诊断', creationStage: 'intake' },
  { label: '写朋友圈', text: '写朋友圈，新品上新' },
  { label: '随便问问', text: '搜索近期 AI 应用案例与趋势', forceWebSearch: true },
]
