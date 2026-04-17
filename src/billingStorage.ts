const KEY = 'howie_billing_api_key_v1'

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
