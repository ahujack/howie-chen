const KEY = 'howie_chen_personal_v1'

export function loadPersonalContext(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function savePersonalContext(text: string): void {
  try {
    localStorage.setItem(KEY, text)
  } catch {
    /* 隐私模式等 */
  }
}
