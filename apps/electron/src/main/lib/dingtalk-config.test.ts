import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createStableDingTalkBotId } from './dingtalk-bot-identity'

type DingTalkConfigModule = typeof import('./dingtalk-config')
type ConfigPathsModule = typeof import('./config-paths')

let dingtalkConfig: DingTalkConfigModule
let configPaths: ConfigPathsModule
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
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

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-dingtalk-config-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  configPaths = await import('./config-paths')
  dingtalkConfig = await import('./dingtalk-config')
})

beforeEach(() => {
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

describe('钉钉 Bot 配置迁移', () => {
  test('Given 相同 Client ID When 生成 Bot ID Then 返回稳定值', () => {
    const first = createStableDingTalkBotId('ding-app-key')
    const second = createStableDingTalkBotId('  ding-app-key  ')

    expect(first).toBe(second)
    expect(first).toStartWith('dingtalk-bot-')
  })

  test('Given v2 配置仍使用旧随机 Bot ID When 读取配置 Then 稳定 Bot ID 并迁移绑定文件', () => {
    const legacyBotId = 'legacy-random-bot-id'
    const clientId = 'ding-app-key'
    const stableBotId = createStableDingTalkBotId(clientId)!
    const bindings = [
      {
        chatId: 'ding-conversation-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        channelId: 'channel-1',
      },
    ]

    writeFileSync(configPaths.getDingTalkConfigPath(), JSON.stringify({
      version: 2,
      bots: [
        {
          id: legacyBotId,
          name: '钉钉助手',
          enabled: true,
          clientId,
          clientSecret: 'secret',
          defaultWorkspaceId: 'workspace-1',
        },
      ],
    }, null, 2), 'utf-8')
    writeFileSync(configPaths.getDingTalkBotBindingsPath(legacyBotId), JSON.stringify(bindings, null, 2), 'utf-8')

    const config = dingtalkConfig.getDingTalkMultiBotConfig()

    expect(config.bots[0]?.id).toBe(stableBotId)
    expect(existsSync(configPaths.getDingTalkBotBindingsPath(legacyBotId))).toBe(false)
    expect(JSON.parse(readFileSync(configPaths.getDingTalkBotBindingsPath(stableBotId), 'utf-8'))).toEqual(bindings)
  })
})
