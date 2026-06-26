import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import { buildRecoveredDelegationState } from './agent-collaboration-utils'

function makeSessionMeta(overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    id: 'child-session',
    title: 'Child Session',
    createdAt: 1000,
    updatedAt: 2000,
    channelId: 'channel-1',
    modelId: 'model-1',
    workspaceId: 'workspace-1',
    sdkSessionId: 'sdk-session-1',
    permissionMode: 'auto',
    delegationRole: 'implement',
    delegationGoal: 'Do the work',
    delegationStatus: 'completed',
    ...overrides,
  }
}

describe('buildRecoveredDelegationState', () => {
  test('Given persisted running delegation without live process When recovering Then marks it interrupted', () => {
    const recovered = buildRecoveredDelegationState({
      parentSessionId: 'parent-session',
      delegationId: 'delegation-1',
      session: makeSessionMeta({ delegationStatus: 'running' }),
    })

    expect(recovered.status).toBe('interrupted')
    expect(recovered.completedAt).toBe(2000)
  })

  test('Given completed delegation When recovering Then keeps terminal status', () => {
    const recovered = buildRecoveredDelegationState({
      parentSessionId: 'parent-session',
      delegationId: 'delegation-2',
      session: makeSessionMeta({ delegationStatus: 'completed' }),
    })

    expect(recovered.status).toBe('completed')
    expect(recovered.completedAt).toBe(2000)
  })
})
