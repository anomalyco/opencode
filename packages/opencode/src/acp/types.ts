/**
 * ============================================================================
 * 文件名：types.ts
 * 所属包：packages/opencode/src/acp
 * ============================================================================
 *
 * 文件作用：
 * ACP（Agent Client Protocol）类型定义模块。
 * 定义 ACP 会话状态和配置的类型。
 *
 * 主要功能：
 * - ACPSessionState：ACP 会话状态接口
 * - ACPConfig：ACP 配置接口
 *
 * 依赖关系：
 * - @agentclientprotocol/sdk：ACP SDK 的 MCP 服务器类型
 * - @opencode-ai/sdk/v2：OpenCode SDK 客户端类型
 *
 * 导出内容：
 * - ACPSessionState：会话状态接口
 * - ACPConfig：配置接口
 *
 * @package opencode
 * @module acp/types
 */

// 导入 ACP SDK 的 MCP 服务器类型
import type { McpServer } from "@agentclientprotocol/sdk"

// 导入 OpenCode SDK 客户端类型
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

/**
 * ACP 会话状态接口
 *
 * 表示一个 ACP 会话的完整状态。
 */
export interface ACPSessionState {
  // 会话 ID
  id: string
  // 当前工作目录
  cwd: string
  // 关联的 MCP 服务器列表
  mcpServers: McpServer[]
  // 会话创建时间
  createdAt: Date
  // 可选：模型配置
  model?: {
    // 提供商 ID
    providerID: string
    // 模型 ID
    modelID: string
  }
  // 可选：模式 ID（Agent 模式）
  modeId?: string
}

/**
 * ACP 配置接口
 *
 * 表示 ACP 的配置选项。
 */
export interface ACPConfig {
  // OpenCode SDK 客户端实例
  sdk: OpencodeClient
  // 可选：默认模型配置
  defaultModel?: {
    // 提供商 ID
    providerID: string
    // 模型 ID
    modelID: string
  }
}
