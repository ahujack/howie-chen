/**
 * HTTP 请求头值只能是 ISO-8859-1；若粘贴了中文、全角符号等会触发：
 * "Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point"
 *
 * 计费 Key 格式为 sk_ + 十六进制（与后端 generateApiKey 一致）。
 */

const KEY_RE = /sk_[a-fA-F0-9]+/i

/**
 * 从粘贴文本中提取合法 Key；去掉零宽字符；若无合法片段则返回去掉非 ASCII 后的串（可能为空）。
 */
export function normalizeBillingApiKey(raw: string): string {
  const trimmed = raw.trim().replace(/[\u200B-\u200D\uFEFF]/g, '')
  const m = trimmed.match(KEY_RE)
  if (m) return m[0]
  return trimmed.replace(/[^\x00-\x7F]/g, '').trim()
}

export function looksLikeBillingKey(raw: string): boolean {
  const k = normalizeBillingApiKey(raw)
  return k.length > 10 && /^sk_[a-fA-F0-9]+$/i.test(k)
}
