import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import { assignChannelIdToAgentMessage } from './agent-message-channel-metadata'

describe('Agent 消息渠道元数据', () => {
  test('Given 同名模型渠道的 assistant 消息 When 持久化前补充渠道 Then 保存精确 channelId', () => {
    const message = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '完成' }] },
    } as unknown as SDKMessage

    assignChannelIdToAgentMessage(message, 'channel-official')

    expect((message as unknown as Record<string, unknown>)._channelId).toBe('channel-official')
  })

  test('Given 已带渠道的 result 消息 When 处理 Then 不覆盖原始渠道身份', () => {
    const message = {
      type: 'result',
      _channelId: 'channel-original',
    } as unknown as SDKMessage

    assignChannelIdToAgentMessage(message, 'channel-new')

    expect((message as unknown as Record<string, unknown>)._channelId).toBe('channel-original')
  })

  test('Given 用户或系统消息 When 处理 Then 不写入渠道元数据', () => {
    const userMessage = { type: 'user' } as SDKMessage
    const systemMessage = { type: 'system' } as SDKMessage

    assignChannelIdToAgentMessage(userMessage, 'channel-a')
    assignChannelIdToAgentMessage(systemMessage, 'channel-a')

    expect((userMessage as unknown as Record<string, unknown>)._channelId).toBeUndefined()
    expect((systemMessage as unknown as Record<string, unknown>)._channelId).toBeUndefined()
  })
})
