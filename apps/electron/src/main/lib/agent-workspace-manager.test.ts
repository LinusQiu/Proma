import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeWorkspaceMcpConfig,
  readWorkspaceBoard,
  writeWorkspaceBoard,
} from './agent-workspace-manager'
import { getAgentWorkspacePath } from './config-paths'

describe('Agent 工作区 MCP 配置', () => {
  test('Given 工作区 MCP 包含内置保留名 When 归一化配置 Then 剔除冲突项并保留普通服务器', () => {
    const normalized = normalizeWorkspaceMcpConfig({
      servers: {
        automation: {
          type: 'stdio',
          command: 'custom-automation',
          enabled: true,
        },
        nano_banana: {
          type: 'stdio',
          command: 'custom-nano',
          enabled: true,
        },
        github: {
          type: 'stdio',
          command: 'github-mcp',
          enabled: true,
        },
      },
    })

    expect(Object.keys(normalized.servers).sort()).toEqual(['github'])
    expect(normalized.servers.github?.command).toBe('github-mcp')
  })

  test('Given 工作区已有旧 Markdown 协作台 When 读取协作台 Then 转为结构化 JSON schema', () => {
    const workspaceSlug = `legacy-board-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`

    try {
      const contextDir = join(getAgentWorkspacePath(workspaceSlug), 'workspace-files', '.context')
      mkdirSync(contextDir, { recursive: true })
      writeFileSync(join(contextDir, 'workspace-board.md'), '# 协作台\n\n- [ ] 迁移旧 Todo\n', 'utf-8')

      const board = readWorkspaceBoard(workspaceSlug)
      expect(board.schemaVersion).toBe(1)
      expect(board.todos[0]?.title).toBe('迁移旧 Todo')
      expect(board.recommendations[0]?.kind).toBe('follow_up')
      expect(board.recommendations[0]?.sourceRefs?.[0]?.path).toBe('.context/workspace-board.md')
      expect(board.notes[0]?.source).toBe('.context/workspace-board.md')
    } finally {
      rmSync(getAgentWorkspacePath(workspaceSlug), { recursive: true, force: true })
    }
  })
})

describe('Agent 工作区协作台', () => {
  test('Given 工作区没有协作台文件 When 保存协作台内容 Then 写入 workspace-files/.context 并可再次读取', () => {
    const workspaceSlug = `board-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`

    try {
      const empty = readWorkspaceBoard(workspaceSlug)
      expect(empty.schemaVersion).toBe(1)
      expect(empty.todos).toEqual([])
      expect(empty.recommendations).toEqual([])
      expect(empty.automationRefs).toEqual([])
      expect(empty.skillRefs).toEqual([])
      expect(empty.automationLevel).toBe('suggest')

      writeWorkspaceBoard(workspaceSlug, {
        ...empty,
        automationLevel: 'assistive',
        recommendations: [{
          id: 'recommendation-1',
          title: '创建自动任务跟进阻塞',
          kind: 'create_automation',
          status: 'suggested',
          confidence: 1.2,
          safetyLevel: 'creates_automation',
          sourceRefs: [{ type: 'board', id: 'blocker-1', title: '阻塞记录' }],
          createdAt: '2026-07-05T00:00:00.000Z',
          updatedAt: '2026-07-05T00:00:00.000Z',
        }],
        automationRefs: [{
          id: 'automation-ref-1',
          title: '每日状态扫描',
          status: 'linked',
          automationId: 'automation-1',
          trigger: 'daily',
          createdAt: '2026-07-05T00:00:00.000Z',
          updatedAt: '2026-07-05T00:00:00.000Z',
        }],
        skillRefs: [{
          id: 'skill-ref-1',
          title: '缺陷扫描流程',
          status: 'enabled',
          skillSlug: 'proma-daily-defect-scan',
          createdAt: '2026-07-05T00:00:00.000Z',
          updatedAt: '2026-07-05T00:00:00.000Z',
        }],
        todos: [{
          id: 'todo-1',
          title: '跟进状态',
          status: 'in_progress',
          owner: 'agent',
          createdAt: '2026-07-05T00:00:00.000Z',
          updatedAt: '2026-07-05T00:00:00.000Z',
        }],
      })

      const saved = readWorkspaceBoard(workspaceSlug)
      expect(saved.schemaVersion).toBe(1)
      expect(saved.automationLevel).toBe('assistive')
      expect(saved.todos[0]?.title).toBe('跟进状态')
      expect(saved.todos[0]?.status).toBe('in_progress')
      expect(saved.recommendations[0]?.confidence).toBe(1)
      expect(saved.recommendations[0]?.sourceRefs?.[0]?.type).toBe('board')
      expect(saved.automationRefs[0]?.trigger).toBe('daily')
      expect(saved.skillRefs[0]?.skillSlug).toBe('proma-daily-defect-scan')

      expect(existsSync(join(
        getAgentWorkspacePath(workspaceSlug),
        'workspace-files',
        '.context',
        'workspace-board.json',
      ))).toBe(true)
    } finally {
      rmSync(getAgentWorkspacePath(workspaceSlug), { recursive: true, force: true })
    }
  })
})
