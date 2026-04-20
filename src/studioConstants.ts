/** 方面陈工作室 · 转化与展示（可按部署改 env） */
export const STUDIO_APP_TITLE = '方面陈 AI 工作室'
export const STUDIO_WECHAT_ID =
  (import.meta.env.VITE_STUDIO_WECHAT as string | undefined)?.trim() || 'hklaochen'
