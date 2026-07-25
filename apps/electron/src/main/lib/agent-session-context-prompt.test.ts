import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

type SessionContextPrompt = typeof import('./agent-session-context-prompt')

let sessionContextPrompt: SessionContextPrompt
let tempHome: string
let resourcesPath: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV
const originalResourcesPath = process.resourcesPath

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
    getAppPath: () => join(tempHome, 'app'),
  },
  BrowserWindow: class {},
  clipboard: {},
  dialog: {},
  nativeImage: { createFromPath: () => ({}) },
  nativeTheme: {},
  powerMonitor: {},
  powerSaveBlocker: {},
  screen: {},
  shell: {},
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
}))

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function writeSessionIndex(): void {
  const configDir = join(tempHome, '.proma')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'agent-sessions.json'), JSON.stringify({
    version: 1,
    sessions: [
      { id: 'current', title: '当前会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 2 },
      { id: 'source', title: '来源 <会话>', workspaceId: 'workspace-a', createdAt: 3, updatedAt: 4 },
      { id: 'large', title: '超大来源会话', workspaceId: 'workspace-a', createdAt: 5, updatedAt: 6 },
      { id: 'other-workspace', title: '不应出现', workspaceId: 'workspace-b', createdAt: 7, updatedAt: 8 },
    ],
  }), 'utf-8')
}

function writeSourceSession(): void {
  const sessionsDir = join(tempHome, '.proma', 'agent-sessions')
  mkdirSync(sessionsDir, { recursive: true })
  const rows = [
    { type: 'user', message: { content: [{ type: 'text', text: '请检查 <untrusted> 的实现' }] }, parent_tool_use_id: null },
    { type: 'assistant', message: { content: [{ type: 'text', text: '已完成检查' }] }, parent_tool_use_id: null },
  ]
  writeFileSync(join(sessionsDir, 'source.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf-8')
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-session-context-prompt-'))
  resourcesPath = join(tempHome, 'resources')
  mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
  writeFileSync(join(resourcesPath, 'bin', 'proma'), '', 'utf-8')
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesPath })
  writeSessionIndex()
  writeSourceSession()
  sessionContextPrompt = await import('./agent-session-context-prompt')
})

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalPromaDev === undefined) delete process.env.PROMA_DEV
  else process.env.PROMA_DEV = originalPromaDev
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: originalResourcesPath })
  rmSync(tempHome, { recursive: true, force: true })
})

describe('引用 Agent 会话上下文', () => {
  test('Given 同工作区会话被显式引用 When 构建 prompt Then 注入受限地图和明确 CLI 深读命令', () => {
    const prompt = sessionContextPrompt.buildReferencedSessionsPrompt(
      'current',
      ['source', 'other-workspace'],
      'workspace-a',
      'proma-dev',
    )

    expect(prompt).toContain('<referenced_sessions>')
    expect(prompt).toContain('<session_outline totalTurns="2" shownTurns="2">')
    expect(prompt).toContain('#0 用户 · 请检查 &lt;untrusted&gt; 的实现')
    expect(prompt).toContain('"$PROMA_CLI" session info source')
    expect(prompt).toContain('"$PROMA_CLI" session export source --turns A-B')
    expect(prompt).toContain('不得只依据标题、元数据或地图回答')
    expect(prompt).not.toContain('other-workspace')
  })

  test('Given 引用会话超过地图阈值 When 构建 prompt Then 不同步扫描正文并要求 CLI 深读', () => {
    const sessionsDir = join(tempHome, '.proma', 'agent-sessions')
    const largeText = 'x'.repeat(2 * 1024 * 1024 + 1)
    writeFileSync(join(sessionsDir, 'large.jsonl'), `${JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: largeText }] },
      parent_tool_use_id: null,
    })}\n`, 'utf-8')

    const prompt = sessionContextPrompt.buildReferencedSessionsPrompt('current', ['large'], 'workspace-a')

    expect(prompt).toContain('<session_outline skipped="too-large"')
    expect(prompt).toContain('请先使用 CLI 的 info 和 outline 命令渐进读取')
    expect(prompt).not.toContain(largeText)
  })

  test('Given 会话引用与 Skill 引用同时存在 When Pi 处理引用 Then 保留用户 Skill 并补充 session-cleaner', () => {
    expect(sessionContextPrompt.mergeSessionCleanerSkillMention(['automation'], ['source']))
      .toEqual(['automation', 'session-cleaner'])
    expect(sessionContextPrompt.mergeSessionCleanerSkillMention(['session-cleaner'], ['source']))
      .toEqual(['session-cleaner'])
    expect(sessionContextPrompt.mergeSessionCleanerSkillMention(['automation'], [])).toEqual(['automation'])
  })
})
