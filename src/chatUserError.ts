/**
 * 将 /api/chat 返回的原始错误转为终端用户可读文案（不暴露部署细节）。
 * 完整原文仅用于 console，便于开发者排查。
 */
export function userFacingChatError(raw: string): string {
  const t = raw.trim()
  if (!t) return '暂时无法完成回复，请稍后再试。'

  const lower = t.toLowerCase()

  if (
    /无效的\s*x-api-key|需要有效的\s*x-api-key|未携带有效计费\s*key|invalid[`\s]*x-api-key/i.test(t) ||
    (lower.includes('x-api-key') && /invalid|无效|unauthorized|401/.test(lower))
  ) {
    if (/未携带有效计费|block_anonymous|拒绝未带头/i.test(t)) {
      return '当前部署要求必须携带有效计费 Key 才能对话。若应支持未填 Key 的免费体验，请联系管理员关闭服务端限制。'
    }
    return '计费 Key 校验未通过：请检查页面右上角已保存的 API Key 是否正确，或联系管理员。'
  }

  if (/积分不足/.test(t) || (lower.includes('insufficient') && lower.includes('point'))) {
    return t.includes('积分') ? t : '积分不足，请续费或联系管理员。'
  }

  if (
    /未配置\s*deepseek|deepseek_api_key|deepspeek|模型服务|大模型请求失败|502/.test(lower) ||
    /503/.test(t)
  ) {
    return 'AI 服务暂时不可用，请稍后再试。若多次失败，请联系管理员。'
  }

  if (/检索服务异常|搜索|tavily/i.test(t)) {
    return '联网检索暂时不可用，请关闭联网重试，或稍后再试。'
  }

  if (/fetch failed|failed to fetch|networkerror|timeout|超时|网络/i.test(lower)) {
    return '网络异常，请检查连接后重试。'
  }

  if (/method not allowed|405|400|须为 json|包含 messages/i.test(lower)) {
    return '请求异常，请刷新页面后重试。'
  }

  return '暂时无法完成回复，请稍后再试。若问题持续，请联系管理员。'
}
