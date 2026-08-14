import type {
  AgentAssistantDeltaMetadata,
  AgentAssistantDeltaOperation,
  AgentStreamEvent,
  SDKAssistantMessage,
  SDKContentBlock,
} from '@proma/shared'

export const AGENT_USAGE_DELTA_INTERVAL_MS = 500

interface AssistantDeltaState {
  message: SDKAssistantMessage
  sequence: number
  runStartedAt?: number
  lastUsageSentAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPartialAssistantMessage(message: unknown): message is SDKAssistantMessage {
  return isRecord(message)
    && message.type === 'assistant'
    && message._partial === true
}

function getMessageId(message: SDKAssistantMessage, sessionId: string): string {
  return message.uuid ?? `assistant:${sessionId}`
}

function valuesEqual(previous: unknown, next: unknown): boolean {
  if (previous === next) return true
  try {
    return JSON.stringify(previous) === JSON.stringify(next)
  } catch {
    return false
  }
}

function diffBlocks(
  previous: SDKContentBlock[],
  next: SDKContentBlock[],
): AgentAssistantDeltaOperation[] {
  const operations: AgentAssistantDeltaOperation[] = []
  const commonLength = Math.min(previous.length, next.length)

  for (let index = 0; index < commonLength; index++) {
    const previousBlock = previous[index]!
    const nextBlock = next[index]!

    if (previousBlock.type === 'text' && nextBlock.type === 'text') {
      const previousText = typeof previousBlock.text === 'string' ? previousBlock.text : ''
      const nextText = typeof nextBlock.text === 'string' ? nextBlock.text : ''
      if (nextText === previousText) continue
      if (nextText.startsWith(previousText)) {
        operations.push({ type: 'append_text', blockIndex: index, text: nextText.slice(previousText.length) })
      } else {
        operations.push({ type: 'replace_block', blockIndex: index, block: nextBlock })
      }
      continue
    }

    if (previousBlock.type === 'thinking' && nextBlock.type === 'thinking') {
      const previousThinking = typeof previousBlock.thinking === 'string' ? previousBlock.thinking : ''
      const nextThinking = typeof nextBlock.thinking === 'string' ? nextBlock.thinking : ''
      if (nextThinking === previousThinking) continue
      if (nextThinking.startsWith(previousThinking)) {
        operations.push({
          type: 'append_thinking',
          blockIndex: index,
          thinking: nextThinking.slice(previousThinking.length),
        })
      } else {
        operations.push({ type: 'replace_block', blockIndex: index, block: nextBlock })
      }
      continue
    }

    if (!valuesEqual(previousBlock, nextBlock)) {
      operations.push({ type: 'replace_block', blockIndex: index, block: nextBlock })
    }
  }

  for (let index = commonLength; index < next.length; index++) {
    operations.push({ type: 'append_block', block: next[index]! })
  }

  if (next.length < previous.length) {
    operations.push({ type: 'truncate_blocks', length: next.length })
  }

  return operations
}

function diffMetadata(
  previous: SDKAssistantMessage,
  next: SDKAssistantMessage,
  includeUsage: boolean,
): AgentAssistantDeltaMetadata | undefined {
  const metadata: AgentAssistantDeltaMetadata = {}

  if (includeUsage && !valuesEqual(previous.message.usage, next.message.usage) && next.message.usage) {
    metadata.usage = next.message.usage
  }
  if (previous.message.model !== next.message.model && next.message.model !== undefined) {
    metadata.model = next.message.model
  }
  if (previous.message.stop_reason !== next.message.stop_reason && next.message.stop_reason !== undefined) {
    metadata.stopReason = next.message.stop_reason
  }
  if (previous.parent_tool_use_id !== next.parent_tool_use_id) {
    metadata.parentToolUseId = next.parent_tool_use_id
  }
  if (previous.session_id !== next.session_id && next.session_id !== undefined) {
    metadata.sessionId = next.session_id
  }
  if (previous._channelModelId !== next._channelModelId && next._channelModelId !== undefined) {
    metadata.channelModelId = next._channelModelId
  }
  if (previous._channelId !== next._channelId && next._channelId !== undefined) {
    metadata.channelId = next._channelId
  }
  if (previous._channelProvider !== next._channelProvider && next._channelProvider !== undefined) {
    metadata.channelProvider = next._channelProvider
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}

/**
 * 将已在 main 侧合帧的累计 assistant partial 转换为 renderer canonical delta。
 * EventBus 的其他消费者仍接收原始 SDKMessage；只有 Electron renderer IPC 使用本编码器。
 */
export class AgentTranscriptDeltaEncoder {
  private readonly states = new Map<string, AssistantDeltaState>()
  private readonly runStartedAtBySession = new Map<string, number>()

  constructor(private readonly now: () => number = Date.now) {}

  encode(event: AgentStreamEvent): AgentStreamEvent {
    const { sessionId, payload } = event

    if (payload.kind === 'proma_event'
      && (payload.event.type === 'run_started' || payload.event.type === 'external_run_started')) {
      this.runStartedAtBySession.set(sessionId, payload.event.startedAt)
      this.clearSessionMessages(sessionId)
      return event
    }

    if (payload.kind !== 'sdk_message') return event

    const messageRecord = payload.message as unknown as Record<string, unknown>
    if (!isPartialAssistantMessage(messageRecord)) {
      if (payload.message.type === 'assistant') {
        const assistant = payload.message as SDKAssistantMessage
        this.states.delete(this.stateKey(sessionId, getMessageId(assistant, sessionId)))
      } else if (payload.message.type === 'result') {
        this.clear(sessionId)
      }
      return event
    }

    const message = payload.message as SDKAssistantMessage
    const messageId = getMessageId(message, sessionId)
    const key = this.stateKey(sessionId, messageId)
    const previous = this.states.get(key)
    const runStartedAt = this.runStartedAtBySession.get(sessionId)
    const sameRun = previous !== undefined && previous.runStartedAt === runStartedAt
    const sequence = sameRun ? previous.sequence + 1 : 1

    if (!previous || !sameRun) {
      this.states.set(key, {
        message,
        sequence,
        runStartedAt,
        lastUsageSentAt: this.now(),
      })
      return {
        sessionId,
        payload: {
          kind: 'assistant_message_delta',
          messageId,
          sequence,
          ...(runStartedAt !== undefined && { runStartedAt }),
          reset: message,
          operations: [],
        },
      }
    }

    const operations = diffBlocks(previous.message.message.content, message.message.content)
    const now = this.now()
    const includeUsage = now - previous.lastUsageSentAt >= AGENT_USAGE_DELTA_INTERVAL_MS
    const metadata = diffMetadata(previous.message, message, includeUsage)
    this.states.set(key, {
      message,
      sequence,
      runStartedAt,
      lastUsageSentAt: metadata?.usage ? now : previous.lastUsageSentAt,
    })

    return {
      sessionId,
      payload: {
        kind: 'assistant_message_delta',
        messageId,
        sequence,
        ...(runStartedAt !== undefined && { runStartedAt }),
        operations,
        ...(metadata && { metadata }),
      },
    }
  }

  clear(sessionId: string): void {
    this.clearSessionMessages(sessionId)
    this.runStartedAtBySession.delete(sessionId)
  }

  private clearSessionMessages(sessionId: string): void {
    const prefix = `${sessionId}\u0000`
    for (const key of this.states.keys()) {
      if (key.startsWith(prefix)) this.states.delete(key)
    }
  }

  private stateKey(sessionId: string, messageId: string): string {
    return `${sessionId}\u0000${messageId}`
  }
}
