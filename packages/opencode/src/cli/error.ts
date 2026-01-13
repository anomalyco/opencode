/**
 * ============================================================================
 * 文件名：error.ts
 * 所属包：packages/opencode/src/cli
 * ============================================================================
 *
 * 文件作用：
 * CLI 错误格式化模块。提供统一的错误信息格式化功能。
 *
 * 主要功能：
 * - FormatError()：格式化已知的错误类型
 * - FormatUnknownError()：格式化未知的错误类型
 * - 支持多种错误类型的友好显示
 *
 * 依赖关系：
 * - ../config/markdown：配置 Markdown 处理
 * - ../config/config：配置管理
 * - ../mcp：MCP 集成
 * - ../provider/provider：提供商管理
 * - ./ui：UI 工具
 *
 * 导出内容：
 * - FormatError()：格式化已知错误
 * - FormatUnknownError()：格式化未知错误
 *
 * 支持的错误类型：
 * - MCP.Failed：MCP 服务器失败
 * - Provider.ModelNotFoundError：模型未找到
 * - Provider.InitError：提供商初始化失败
 * - Config.JsonError：JSON 配置错误
 * - Config.ConfigDirectoryTypoError：配置目录拼写错误
 * - ConfigMarkdown.FrontmatterError：Frontmatter 解析错误
 * - Config.InvalidError：配置验证失败
 * - UI.CancelledError：用户取消操作
 *
 * @package opencode
 * @module cli/error
 */

// 导入配置 Markdown 处理
import { ConfigMarkdown } from "@/config/markdown"

// 导入配置管理
import { Config } from "../config/config"

// 导入 MCP 集成
import { MCP } from "../mcp"

// 导入提供商管理
import { Provider } from "../provider/provider"

// 导入 UI 工具
import { UI } from "./ui"

/**
 * 格式化已知的错误类型
 *
 * 根据错误类型返回友好的错误消息。
 * 对于某些错误（如 UI.CancelledError），返回空字符串表示无需显示。
 *
 * @param input - 要格式化的错误对象
 * @returns 格式化后的错误消息，或空字符串（对于取消操作）
 *
 * 错误类型处理：
 * 1. MCP.Failed：MCP 服务器失败（提示不支持认证）
 * 2. Provider.ModelNotFoundError：模型未找到（提供建议）
 * 3. Provider.InitError：提供商初始化失败
 * 4. Config.JsonError：JSON 配置解析错误
 * 5. Config.ConfigDirectoryTypoError：目录名拼写错误
 * 6. ConfigMarkdown.FrontmatterError：Frontmatter 解析错误
 * 7. Config.InvalidError：配置验证失败（带问题列表）
 * 8. UI.CancelledError：用户取消操作（返回空字符串）
 */
export function FormatError(input: unknown) {
  // 检查是否为 MCP 服务器失败错误
  if (MCP.Failed.isInstance(input))
    return `MCP server "${input.data.name}" failed. Note, opencode does not support MCP authentication yet.`

  // 检查是否为模型未找到错误
  if (Provider.ModelNotFoundError.isInstance(input)) {
    // 解构错误数据
    const { providerID, modelID, suggestions } = input.data
    // 构建错误消息，包含建议的模型名称
    return [
      `Model not found: ${providerID}/${modelID}`,
      // 如果有建议，添加到错误消息中
      ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
      // 提示用户查看可用模型
      `Try: \`opencode models\` to list available models`,
      // 提示用户检查配置文件
      `Or check your config (opencode.json) provider/model names`,
    ].join("\n")
  }

  // 检查是否为提供商初始化错误
  if (Provider.InitError.isInstance(input)) {
    return `Failed to initialize provider "${input.data.providerID}". Check credentials and configuration.`
  }

  // 检查是否为 JSON 配置错误
  if (Config.JsonError.isInstance(input)) {
    return (
      `Config file at ${input.data.path} is not valid JSON(C)` +
      // 如果有详细错误消息，附加到后面
      (input.data.message ? `: ${input.data.message}` : "")
    )
  }

  // 检查是否为配置目录拼写错误
  if (Config.ConfigDirectoryTypoError.isInstance(input)) {
    return `Directory "${input.data.dir}" in ${input.data.path} is not valid. Rename the directory to "${input.data.suggestion}" or remove it. This is a common typo.`
  }

  // 检查是否为 Frontmatter 解析错误
  if (ConfigMarkdown.FrontmatterError.isInstance(input)) {
    return `Failed to parse frontmatter in ${input.data.path}:\n${input.data.message}`
  }

  // 检查是否为配置验证错误
  if (Config.InvalidError.isInstance(input))
    return [
      // 基本错误消息，包含路径（如果有）
      `Configuration is invalid${input.data.path && input.data.path !== "config" ? ` at ${input.data.path}` : ""}` +
        // 如果有详细消息，附加到后面
        (input.data.message ? `: ${input.data.message}` : ""),
      // 映射所有验证问题，每行一个问题及其路径
      ...(input.data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
    ].join("\n")

  // 检查是否为用户取消操作
  // 返回空字符串表示无需显示错误
  if (UI.CancelledError.isInstance(input)) return ""
}

/**
 * 格式化未知的错误类型
 *
 * 处理不是系统已知错误的其他错误类型。
 *
 * @param input - 要格式化的错误对象
 * @returns 格式化后的错误消息字符串
 *
 * 处理逻辑：
 * 1. Error 对象：返回堆栈跟踪，或名称+消息
 * 2. 普通对象：尝试 JSON 序列化
 * 3. 其他类型：转换为字符串
 */
export function FormatUnknownError(input: unknown): string {
  // 如果是 Error 对象
  if (input instanceof Error) {
    // 优先返回堆栈跟踪，否则返回名称和消息
    return input.stack ?? `${input.name}: ${input.message}`
  }

  // 如果是普通对象（非 null）
  if (typeof input === "object" && input !== null) {
    try {
      // 尝试 JSON 序列化
      return JSON.stringify(input, null, 2)
    } catch {
      // 序列化失败，返回提示
      return "Unexpected error (unserializable)"
    }
  }

  // 其他类型直接转换为字符串
  return String(input)
}
