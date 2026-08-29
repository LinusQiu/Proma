import { describe, expect, test } from 'bun:test'
import {
  assertTerminalProfileSupported,
  getTerminalProfilesForPlatform,
  isTerminalProfile,
  parseTerminalProfile,
} from './terminal'

describe('终端 profile 解析', () => {
  test('Given 省略或空串 When 解析 Then 回退到 default', () => {
    expect(parseTerminalProfile(undefined)).toBe('default')
    expect(parseTerminalProfile(null)).toBe('default')
    expect(parseTerminalProfile('')).toBe('default')
  })

  test('Given 每个合法 profile When 解析 Then 原样返回', () => {
    const profiles = ['default', 'zsh', 'bash', 'pwsh', 'powershell', 'cmd', 'git-bash', 'wsl'] as const
    for (const profile of profiles) {
      expect(parseTerminalProfile(profile)).toBe(profile)
      expect(isTerminalProfile(profile)).toBe(true)
    }
  })

  test('Given 未知值 When 解析 Then 显式抛错而非静默回退', () => {
    expect(() => parseTerminalProfile('pwsh7')).toThrow()
    expect(() => parseTerminalProfile('PowerShell')).toThrow()
    expect(() => parseTerminalProfile(123)).toThrow()
    expect(() => parseTerminalProfile({})).toThrow()
  })

  test('Given 非法值 When 解析 Then 错误信息列出全部可选值', () => {
    try {
      parseTerminalProfile('fish')
      expect.unreachable()
    } catch (error) {
      expect(String(error)).toContain('git-bash')
      expect(String(error)).toContain('wsl')
    }
  })

  test('Given 不同平台 When 获取支持列表 Then 仅返回该平台允许的 profile', () => {
    expect(getTerminalProfilesForPlatform('darwin')).toEqual(['default', 'zsh', 'bash'])
    expect(getTerminalProfilesForPlatform('linux')).toEqual(['default', 'zsh', 'bash'])
    expect(getTerminalProfilesForPlatform('win32')).toEqual(['default', 'pwsh', 'powershell', 'cmd', 'git-bash', 'wsl'])
  })

  test('Given 不支持当前平台的合法 profile When 校验 Then 显式抛错', () => {
    expect(() => assertTerminalProfileSupported('pwsh', 'darwin')).toThrow('不支持当前平台 darwin')
    expect(() => assertTerminalProfileSupported('git-bash', 'linux')).toThrow('不支持当前平台 linux')
    expect(() => assertTerminalProfileSupported('zsh', 'win32')).toThrow('不支持当前平台 win32')
    expect(assertTerminalProfileSupported('bash', 'darwin')).toBe('bash')
    expect(assertTerminalProfileSupported('wsl', 'win32')).toBe('wsl')
  })
})
