/**
 * 路人无 Key：免费对话轮次（每成功完成一轮计 1 次，仅前端计数）。
 * sk_trial_ 学员 Key：单独计数，默认 10 次（可与服务端积分并行，用于首屏「剩余 N 次」展示）。
 */

const STORAGE_KEY = 'howie_free_user_rounds_v1'
/** 路人默认 1 次；可通过 VITE_FREE_CHAT_ROUNDS 覆盖 */
const DEFAULT_VISITOR_LIMIT = 1

const TRIAL_STORAGE_KEY = 'howie_trial_sk_rounds_v1'
const DEFAULT_TRIAL_LIMIT = 10

export function getFreeChatLimit(): number {
  const v = import.meta.env.VITE_FREE_CHAT_ROUNDS
  if (v != null && String(v).trim() !== '') {
    const n = parseInt(String(v), 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return DEFAULT_VISITOR_LIMIT
}

export function getTrialChatLimit(): number {
  const v = import.meta.env.VITE_TRIAL_SK_CHAT_ROUNDS
  if (v != null && String(v).trim() !== '') {
    const n = parseInt(String(v), 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return DEFAULT_TRIAL_LIMIT
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

export function getTrialRoundsUsed(): number {
  try {
    const s = localStorage.getItem(TRIAL_STORAGE_KEY)
    const n = parseInt(s ?? '0', 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function incrementTrialRoundsUsed(): void {
  try {
    const n = getTrialRoundsUsed() + 1
    localStorage.setItem(TRIAL_STORAGE_KEY, String(n))
  } catch {
    /* ignore */
  }
}
