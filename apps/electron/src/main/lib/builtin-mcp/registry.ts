/**
 * Proma 内置 MCP 注册中心
 *
 * Orchestrator 只调用这里的统一入口；各内置 MCP 的可用性、注入条件和错误隔离
 * 都收敛在本模块，避免主编排流程继续膨胀。
 */

import { injectNanoBananaMcpServer } from '../chat-tools/nano-banana-mcp'
import { injectMemoryMcpServer } from './memory'

export interface BuiltinMcpInjectContext {
  sdk: typeof import('@anthropic-ai/claude-agent-sdk')
  mcpServers: Record<string, Record<string, unknown>>
  sessionId: string
  agentCwd?: string
}

async function injectBuiltinSafely(name: string, task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (error) {
    console.error(`[Agent 编排] 注入内置 MCP 失败 (${name}):`, error)
  }
}

export async function injectBuiltinMcpServers(ctx: BuiltinMcpInjectContext): Promise<void> {
  await injectBuiltinSafely('mem', () => injectMemoryMcpServer(ctx.sdk, ctx.mcpServers))

  await injectBuiltinSafely('nano-banana', () => injectNanoBananaMcpServer(
    ctx.sdk,
    ctx.mcpServers,
    ctx.sessionId,
    ctx.agentCwd,
  ))
}
