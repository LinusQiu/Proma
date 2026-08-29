import { describe, expect, test } from 'bun:test'
import { resolveTerminalShell } from './terminal-shell-resolver'

const existing = new Set(['/bin/zsh', '/bin/bash', '/opt/homebrew/bin/fish'])
const canExecute = (path: string): boolean => existing.has(path) || path.endsWith('powershell.exe')

describe('终端 shell 跨平台解析', () => {
  test('Given macOS default When 用户 SHELL 可执行 Then 保持用户现有 shell', () => {
    const shell = resolveTerminalShell('default', {
      platform: 'darwin',
      env: { SHELL: '/opt/homebrew/bin/fish' },
      canExecute,
    })
    expect(shell.file).toBe('/opt/homebrew/bin/fish')
  })

  test('Given macOS explicit zsh/bash When 解析 Then 使用指定 shell 而非用户 SHELL', () => {
    const options = { platform: 'darwin', env: { SHELL: '/opt/homebrew/bin/fish' }, canExecute }
    expect(resolveTerminalShell('zsh', options).file).toBe('/bin/zsh')
    expect(resolveTerminalShell('bash', options).file).toBe('/bin/bash')
  })

  test('Given macOS default When 用户 SHELL 不可执行 Then 回退到 zsh', () => {
    const shell = resolveTerminalShell('default', {
      platform: 'darwin',
      env: { SHELL: '/missing/fish' },
      canExecute,
    })
    expect(shell.file).toBe('/bin/zsh')
  })

  test('Given macOS Windows-only profile When 解析 Then 显式拒绝而不静默降级', () => {
    expect(() => resolveTerminalShell('pwsh', { platform: 'darwin', canExecute })).toThrow('不支持当前平台 darwin')
    expect(() => resolveTerminalShell('wsl', { platform: 'darwin', canExecute })).toThrow('不支持当前平台 darwin')
  })

  test('Given Windows profile When 解析 Then 保持既有 Windows 映射', () => {
    const options = {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', ComSpec: 'cmd.exe' },
      canExecute,
    }
    expect(resolveTerminalShell('pwsh', options).file).toBe('pwsh.exe')
    expect(resolveTerminalShell('powershell', options).file).toBe('pwsh.exe')
    expect(resolveTerminalShell('default', options).file).toContain('powershell.exe')
  })
})
