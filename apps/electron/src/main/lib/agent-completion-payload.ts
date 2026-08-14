import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type {
  AgentSendInput,
  AgentStreamCompletePayload,
} from '@proma/shared'

export type AgentStreamCompletionDetails = Omit<
  AgentStreamCompletePayload,
  'sessionId' | 'triggeredBy'
>

export interface AgentStreamCompleteTarget {
  send(channel: string, payload: AgentStreamCompletePayload): void
}

export type ScopedAgentRunInput = AgentSendInput & { startedAt: number }

/** 在进入 orchestrator 前固定 run scope，初始化早期异常也能发送可匹配的 completion。 */
export function ensureAgentRunStartedAt(
  input: AgentSendInput,
  now: () => number = Date.now,
): ScopedAgentRunInput {
  if (input.startedAt != null) return input as ScopedAgentRunInput
  return { ...input, startedAt: now() }
}

export function buildAgentStreamCompletePayload(
  run: Readonly<Pick<AgentSendInput, 'sessionId' | 'triggeredBy'>>,
  details: AgentStreamCompletionDetails = {},
): AgentStreamCompletePayload {
  return {
    sessionId: run.sessionId,
    triggeredBy: run.triggeredBy,
    ...details,
  }
}

export function sendAgentStreamComplete(
  target: AgentStreamCompleteTarget,
  run: Readonly<Pick<AgentSendInput, 'sessionId' | 'triggeredBy'>>,
  details: AgentStreamCompletionDetails = {},
): void {
  target.send(
    AGENT_IPC_CHANNELS.STREAM_COMPLETE,
    buildAgentStreamCompletePayload(run, details),
  )
}
