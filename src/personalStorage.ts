const KEY = 'howie_chen_personal_v1'
const KEY_HOWIE_KB = 'howie_chen_use_howie_kb_v1'

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

export function loadHowieKnowledgeBase(): boolean {
  try {
    const v = localStorage.getItem(KEY_HOWIE_KB)
    if (v === null) return true
    return v === '1'
  } catch {
    return true
  }
}

export function saveHowieKnowledgeBase(on: boolean): void {
  try {
    localStorage.setItem(KEY_HOWIE_KB, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}
