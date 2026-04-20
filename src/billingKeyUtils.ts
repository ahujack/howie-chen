/**
 * HTTP 请求头值只能是 ISO-8859-1；若粘贴了中文、全角符号等会触发：
 * "Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point"
 *
 * 支持两类 Key：
 * - 经典：`sk_` + 48 位十六进制（与后端 generateApiKey 一致）
 * - 分层：`sk_trial_` / `sk_team_` / `sk_admin_` + 后缀（字母数字下划线连字符，≥8）
 */

const LEGACY_HEX_RE = /sk_[a-fA-F0-9]+/i
const TIERED_FULL_RE = /^sk_(trial|team|admin)_[a-zA-Z0-9_-]{8,128}$/i

/** 与后端 generateApiKey 一致：sk_ + 48 个十六进制字符 */
export const BILLING_KEY_HEX_LEN = 48

export type BillingKeyTier = 'visitor' | 'trial' | 'team' | 'admin' | 'standard'

export function detectBillingKeyTier(raw: string): BillingKeyTier {
  const k = normalizeBillingApiKey(raw)
  if (!k) return 'visitor'
  const m = k.match(/^sk_(trial|team|admin)_/i)
  if (!m) return 'standard'
  const p = m[1].toLowerCase()
  if (p === 'trial') return 'trial'
  if (p === 'team') return 'team'
  if (p === 'admin') return 'admin'
  return 'standard'
}

/**
 * 从粘贴文本中提取 Key：去零宽、去空白；分层 Key 整段保留；否则匹配经典 hex。
 */
export function normalizeBillingApiKey(raw: string): string {
  const trimmed = raw.trim().replace(/[\u200B-\u200D\uFEFF]/g, '')
  const collapsed = trimmed.replace(/\s+/g, '')
  if (TIERED_FULL_RE.test(collapsed)) return collapsed
  const m = collapsed.match(LEGACY_HEX_RE)
  if (m) return m[0]
  const ascii = trimmed.replace(/[^\x00-\x7F]/g, '').trim()
  if (TIERED_FULL_RE.test(ascii)) return ascii
  const m2 = ascii.match(LEGACY_HEX_RE)
  if (m2) return m2[0]
  return ascii
}

function looksLikeLegacyBillingKey(k: string): boolean {
  if (!/^sk_[a-fA-F0-9]+$/i.test(k)) return false
  return k.length === 3 + BILLING_KEY_HEX_LEN
}

/** 任意可发往服务端的计费 Key（经典 hex 或 trial/team/admin 前缀） */
export function looksLikeBillingKey(raw: string): boolean {
  const k = normalizeBillingApiKey(raw)
  if (TIERED_FULL_RE.test(k)) return true
  return looksLikeLegacyBillingKey(k)
}

/** 是否应默认展开「高级设置」（团队 / 管理） */
export function billingTierDefaultsAdvancedOpen(raw: string): boolean {
  const t = detectBillingKeyTier(raw)
  return t === 'team' || t === 'admin'
}
