import type { SDKMessage } from '@proma/shared'

/**
 * 将运行时已确定的渠道身份写入会话消息。
 *
 * 同一模型可能在多个渠道中出现；会话恢复后不能只依赖 modelId 推断来源渠道。
 * 仅为 assistant/result 写入元数据，避免把渠道配置耦合到用户输入或系统状态消息。
 */
export function assignChannelIdToAgentMessage(message: SDKMessage, channelId: string): void {
  if (!channelId || (message.type !== 'assistant' && message.type !== 'result')) return

  const record = message as unknown as Record<string, unknown>
  if (typeof record._channelId === 'string') return

  record._channelId = channelId
}
