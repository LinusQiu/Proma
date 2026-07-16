import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

type ChannelManagerModule = typeof import('./channel-manager')

let channelManager: ChannelManagerModule
let tempHome: string
let lastFetchInput: { url: string; init?: RequestInit } | null = null
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV

mock.module('electron', () => ({
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

mock.module('./proxy-settings-service', () => ({
  getEffectiveProxyUrl: async () => undefined,
}))

mock.module('./proxy-fetch', () => ({
  getFetchFn: () => async (url: string, init?: RequestInit) => {
    lastFetchInput = { url, init }
    return new Response(JSON.stringify({
      code: 200,
      success: true,
      data: {
        limits: [
          {
            type: 'TOKENS_LIMIT',
            unit: 3,
            percentage: 25,
            nextResetTime: 1_800_000_000,
          },
          {
            type: 'TOKENS_LIMIT',
            unit: 6,
            percentage: 40,
            nextResetTime: 1_800_086_400,
          },
        ],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}))

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-channel-manager-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  channelManager = await import('./channel-manager')
})

beforeEach(() => {
  lastFetchInput = null
  rmSync(join(tempHome, '.proma'), { recursive: true, force: true })
  mkdirSync(join(tempHome, '.proma'), { recursive: true })
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalPromaDev === undefined) {
    delete process.env.PROMA_DEV
  } else {
    process.env.PROMA_DEV = originalPromaDev
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('Channel manager plan quota', () => {
  test('Given 火山方舟 Anthropic 兼容地址 When 拉取模型 Then 使用 Ark Coding Plan 预设', async () => {
    const result = await channelManager.fetchModels({
      provider: 'anthropic-compatible',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
      apiKey: 'ark-token',
    })

    expect(result.success).toBe(true)
    expect(result.message).toContain('火山方舟 Coding Plan')
    expect(result.models.map((model) => model.id)).toContain('doubao-seed-2.0-code')
    expect(lastFetchInput).toBeNull()
  })

  test('Given 智谱团队版只填写 API Token When 查询额度 Then 使用默认组织项目上下文', async () => {
    writeFileSync(join(tempHome, '.proma', 'channels.json'), JSON.stringify({
      version: 2,
      channels: [
        {
          id: 'zhipu-team',
          name: 'GLM Team',
          provider: 'zhipu-coding-team',
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          apiKey: 'team-token',
          models: [],
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }), 'utf-8')

    const result = await channelManager.getChannelPlanQuota('zhipu-team')

    expect(result.supported).toBe(true)
    expect(result.provider).toBe('zhipu-coding-team')
    expect(result.windows.map((window) => window.type)).toEqual(['5h', 'weekly'])
    expect(lastFetchInput?.url).toBe('https://bigmodel.cn/api/monitor/usage/quota/limit?type=2')
    expect((lastFetchInput?.init?.headers as Record<string, string>).Authorization).toBe('team-token')
    expect((lastFetchInput?.init?.headers as Record<string, string>)['bigmodel-organization']).toBeUndefined()
    expect((lastFetchInput?.init?.headers as Record<string, string>)['bigmodel-project']).toBeUndefined()
  })
})
