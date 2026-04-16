const KEY = 'howie_chen_personal_v1'
const KEY_HOWIE_KB = 'howie_chen_use_howie_kb_v1'
const KEY_HOWIE_VOICE = 'howie_chen_howie_persona_voice_v1'
const KEY_INJECT_ROOTS = 'howie_chen_inject_hot_roots_v1'
const KEY_CREATION_STAGE = 'howie_chen_creation_stage_v1'
const KEY_HK_DIAG = 'howie_chen_hk_insurance_ai_diagnostician_v1'
const KEY_UNIVERSAL_PLANNER = 'howie_chen_universal_ai_planner_v1'

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

/** 「方面陈港仔演示口吻」默认关 */
export function loadHowiePersonaVoice(): boolean {
  try {
    return localStorage.getItem(KEY_HOWIE_VOICE) === '1'
  } catch {
    return false
  }
}

export function saveHowiePersonaVoice(on: boolean): void {
  try {
    localStorage.setItem(KEY_HOWIE_VOICE, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function loadInjectHotRoots(): boolean {
  try {
    return localStorage.getItem(KEY_INJECT_ROOTS) === '1'
  } catch {
    return false
  }
}

export function saveInjectHotRoots(on: boolean): void {
  try {
    localStorage.setItem(KEY_INJECT_ROOTS, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** 默认创作阶段（空=不限） */
export function loadCreationStage(): string {
  try {
    return localStorage.getItem(KEY_CREATION_STAGE) ?? ''
  } catch {
    return ''
  }
}

export function saveCreationStage(id: string): void {
  try {
    localStorage.setItem(KEY_CREATION_STAGE, id)
  } catch {
    /* ignore */
  }
}

/** 港险 AI 段位诊断师模式（与方面陈内容创作体系互斥，由服务端忽略方面陈 KB） */
export function loadHkInsuranceAiDiagnostician(): boolean {
  try {
    return localStorage.getItem(KEY_HK_DIAG) === '1'
  } catch {
    return false
  }
}

export function saveHkInsuranceAiDiagnostician(on: boolean): void {
  try {
    localStorage.setItem(KEY_HK_DIAG, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** 各行各业 · AI 规划师 / 自我诊断（与港险诊断互斥） */
export function loadUniversalAiPlanner(): boolean {
  try {
    return localStorage.getItem(KEY_UNIVERSAL_PLANNER) === '1'
  } catch {
    return false
  }
}

export function saveUniversalAiPlanner(on: boolean): void {
  try {
    localStorage.setItem(KEY_UNIVERSAL_PLANNER, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** 两种诊断模式互斥；若历史数据同时为 true，保留通用、关闭港险 */
export function loadDiagExclusive(): {
  hkInsuranceAiDiagnostician: boolean
  universalAiPlanner: boolean
} {
  let hk = loadHkInsuranceAiDiagnostician()
  const uni = loadUniversalAiPlanner()
  if (hk && uni) {
    saveHkInsuranceAiDiagnostician(false)
    hk = false
  }
  return { hkInsuranceAiDiagnostician: hk, universalAiPlanner: uni }
}
