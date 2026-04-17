/**
 * HTTP 请求头值只能是 ISO-8859-1；若粘贴了中文、全角符号等会触发：
 * "Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point"
 *
 * 计费 Key 格式为 sk_ + 十六进制（与后端 lib/billingCore.cjs generateApiKey：24 字节 hex = 48 位）。
 */

const KEY_RE = /sk_[a-fA-F0-9]+/i

/** 与后端 generateApiKey 一致：sk_ + 48 个十六进制字符 */
export const BILLING_KEY_HEX_LEN = 48

/**
 * 从粘贴文本中提取 Key：去零宽、去空白后再匹配，避免从后台复制时夹带换行/空格导致只识别前半段。
 */
export function normalizeBillingApiKey(raw: string): string {
  const trimmed = raw.trim().replace(/[\u200B-\u200D\uFEFF]/g, '')
  const collapsed = trimmed.replace(/\s+/g, '')
  const m = collapsed.match(KEY_RE)
  if (m) return m[0]
  const ascii = trimmed.replace(/[^\x00-\x7F]/g, '').trim()
  const m2 = ascii.match(KEY_RE)
  if (m2) return m2[0]
  return ascii
}

/** 仅当格式完整时才向服务端带 X-API-Key，否则走免费轮次，避免半段/错误 Key 触发 401 */
export function looksLikeBillingKey(raw: string): boolean {
  const k = normalizeBillingApiKey(raw)
  if (!/^sk_[a-fA-F0-9]+$/i.test(k)) return false
  return k.length === 3 + BILLING_KEY_HEX_LEN
}
