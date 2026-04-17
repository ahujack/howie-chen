const KEY = 'howie_billing_api_key_v1'
const USERNAME_KEY = 'howie_billing_username_v1'

export function loadBillingApiKey(): string {
  try {
    return localStorage.getItem(KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function saveBillingApiKey(key: string): void {
  try {
    localStorage.setItem(KEY, key.trim())
  } catch {
    /* ignore */
  }
}

/** 仅本地展示用备注名（与积分 Key 对应）；不发给服务端，鉴权只依赖 API Key */
export function loadBillingUsername(): string {
  try {
    return localStorage.getItem(USERNAME_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function saveBillingUsername(name: string): void {
  try {
    localStorage.setItem(USERNAME_KEY, name.trim())
  } catch {
    /* ignore */
  }
}
