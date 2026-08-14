import { useCallback, useSyncExternalStore } from 'react'
import type {
  AgentAssistantMessageDelta,
  AgentAssistantDeltaOperation,
  SDKAssistantMessage,
  SDKContentBlock,
} from '@proma/shared'

interface LiveAssistantRecord {
  message: SDKAssistantMessage
  sequence: number
  runStartedAt?: number
}

interface SessionLiveTranscript {
  records: Map<string, LiveAssistantRecord>
  order: string[]
  snapshot: SDKAssistantMessage[]
  listeners: Set<() => void>
}

const EMPTY_MESSAGES: SDKAssistantMessage[] = []

function cloneAssistantMessage(message: SDKAssistantMessage): SDKAssistantMessage {
  return {
    ...message,
    message: {
      ...message.message,
      content: message.message.content.map((block) => ({ ...block })),
      ...(message.message.usage && { usage: { ...message.message.usage } }),
    },
  }
}

function applyOperation(
  blocks: SDKContentBlock[],
  operation: AgentAssistantDeltaOperation,
): SDKContentBlock[] | null {
  switch (operation.type) {
    case 'append_text': {
      const block = blocks[operation.blockIndex]
      if (!block || block.type !== 'text' || typeof block.text !== 'string') return null
      const next = [...blocks]
      next[operation.blockIndex] = { ...block, text: block.text + operation.text }
      return next
    }
    case 'append_thinking': {
      const block = blocks[operation.blockIndex]
      if (!block || block.type !== 'thinking' || typeof block.thinking !== 'string') return null
      const next = [...blocks]
      next[operation.blockIndex] = { ...block, thinking: block.thinking + operation.thinking }
      return next
    }
    case 'append_block':
      return [...blocks, { ...operation.block }]
    case 'replace_block': {
      if (operation.blockIndex < 0 || operation.blockIndex >= blocks.length) return null
      const next = [...blocks]
      next[operation.blockIndex] = { ...operation.block }
      return next
    }
    case 'truncate_blocks':
      return operation.length >= 0 && operation.length <= blocks.length
        ? blocks.slice(0, operation.length)
        : null
  }
}

function applyMetadata(
  message: SDKAssistantMessage,
  delta: AgentAssistantMessageDelta,
): SDKAssistantMessage {
  const metadata = delta.metadata
  if (!metadata) return message

  return {
    ...message,
    message: {
      ...message.message,
      ...(metadata.usage && { usage: { ...metadata.usage } }),
      ...(metadata.model !== undefined && { model: metadata.model }),
      ...(metadata.stopReason !== undefined && { stop_reason: metadata.stopReason }),
    },
    ...(metadata.parentToolUseId !== undefined && { parent_tool_use_id: metadata.parentToolUseId }),
    ...(metadata.sessionId !== undefined && { session_id: metadata.sessionId }),
    ...(metadata.channelModelId !== undefined && { _channelModelId: metadata.channelModelId }),
    ...(metadata.channelId !== undefined && { _channelId: metadata.channelId }),
    ...(metadata.channelProvider !== undefined && { _channelProvider: metadata.channelProvider }),
  }
}

export class AgentLiveTranscriptStore {
  private readonly sessions = new Map<string, SessionLiveTranscript>()

  apply(sessionId: string, delta: AgentAssistantMessageDelta): SDKAssistantMessage | null {
    const session = this.getOrCreateSession(sessionId)
    const previous = session.records.get(delta.messageId)

    if (previous && delta.sequence <= previous.sequence) return previous.message
    if (previous && delta.runStartedAt !== previous.runStartedAt && !delta.reset) return null
    if (previous && delta.sequence !== previous.sequence + 1 && !delta.reset) return null
    if (!previous && !delta.reset) return null

    let nextMessage = delta.reset
      ? cloneAssistantMessage(delta.reset)
      : cloneAssistantMessage(previous!.message)

    for (const operation of delta.operations) {
      const nextBlocks = applyOperation(nextMessage.message.content, operation)
      if (!nextBlocks) return null
      nextMessage = {
        ...nextMessage,
        message: { ...nextMessage.message, content: nextBlocks },
      }
    }
    nextMessage = applyMetadata(nextMessage, delta)

    session.records.set(delta.messageId, {
      message: nextMessage,
      sequence: delta.sequence,
      runStartedAt: delta.runStartedAt,
    })
    if (!session.order.includes(delta.messageId)) session.order.push(delta.messageId)
    this.publish(session)
    return nextMessage
  }

  finalize(sessionId: string, messageId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || !session.records.delete(messageId)) return
    session.order = session.order.filter((id) => id !== messageId)
    this.publish(session)
    this.deleteIfUnused(sessionId, session)
  }

  clear(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.records.clear()
    session.order = []
    this.publish(session)
    this.deleteIfUnused(sessionId, session)
  }

  getSnapshot(sessionId: string): SDKAssistantMessage[] {
    return this.sessions.get(sessionId)?.snapshot ?? EMPTY_MESSAGES
  }

  subscribe(sessionId: string, listener: () => void): () => void {
    const session = this.getOrCreateSession(sessionId)
    session.listeners.add(listener)
    return () => {
      session.listeners.delete(listener)
      if (session.listeners.size === 0 && session.records.size === 0) {
        this.sessions.delete(sessionId)
      }
    }
  }

  private getOrCreateSession(sessionId: string): SessionLiveTranscript {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    const created: SessionLiveTranscript = {
      records: new Map(),
      order: [],
      snapshot: EMPTY_MESSAGES,
      listeners: new Set(),
    }
    this.sessions.set(sessionId, created)
    return created
  }

  private publish(session: SessionLiveTranscript): void {
    session.snapshot = session.order
      .map((id) => session.records.get(id)?.message)
      .filter((message): message is SDKAssistantMessage => message !== undefined)
    for (const listener of session.listeners) listener()
  }

  private deleteIfUnused(sessionId: string, session: SessionLiveTranscript): void {
    if (session.listeners.size === 0 && session.records.size === 0) {
      this.sessions.delete(sessionId)
    }
  }
}

export const agentLiveTranscriptStore = new AgentLiveTranscriptStore()

export function useAgentLiveTranscriptMessages(sessionId: string): SDKAssistantMessage[] {
  const subscribe = useCallback(
    (listener: () => void) => agentLiveTranscriptStore.subscribe(sessionId, listener),
    [sessionId],
  )
  const getSnapshot = useCallback(
    () => agentLiveTranscriptStore.getSnapshot(sessionId),
    [sessionId],
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_MESSAGES)
}
