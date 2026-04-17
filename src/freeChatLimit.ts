/**
 * 未配置计费 API Key 时，限制免费对话轮次（每成功完成一轮用户提问计 1 次）。
 * 仅前端提示与拦截；配 Key 后由积分体系计费。
 */

const STORAGE_KEY = 'howie_free_user_rounds_v1'
const DEFAULT_LIMIT = 10

export function getFreeChatLimit(): number {
  const v = import.meta.env.VITE_FREE_CHAT_ROUNDS
  if (v != null && String(v).trim() !== '') {
    const n = parseInt(String(v), 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return DEFAULT_LIMIT
}

export function getFreeRoundsUsed(): number {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    const n = parseInt(s ?? '0', 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function incrementFreeRoundsUsed(): void {
  try {
    const n = getFreeRoundsUsed() + 1
    localStorage.setItem(STORAGE_KEY, String(n))
  } catch {
    /* ignore */
  }
}
