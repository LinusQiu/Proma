export const FOREGROUND_PARTIAL_UPDATE_INTERVAL_MS = 50
export const BACKGROUND_DELEGATION_PARTIAL_UPDATE_INTERVAL_MS = 250

export interface PartialUpdatePriorityInput {
  isDelegation: boolean
  isActiveSession: boolean
}

/**
 * 协作子会话默认属于后台工作：限制其累计全文 partial 的发送频率，
 * 避免多个并行 Agent 争用主 Renderer 的 IPC/反序列化预算。
 * 用户实际打开子会话时立即恢复前台更新速率。
 */
export function resolvePartialUpdateIntervalMs(input: PartialUpdatePriorityInput): number {
  if (!input.isDelegation || input.isActiveSession) {
    return FOREGROUND_PARTIAL_UPDATE_INTERVAL_MS
  }
  return BACKGROUND_DELEGATION_PARTIAL_UPDATE_INTERVAL_MS
}
