/**
 * ============================================================================
 * 文件名：models.ts
 * 所属包：packages/opencode/src/provider
 * ============================================================================
 *
 * 文件作用：
 * Models.dev API 集成模块。从 models.dev 获取最新的 AI 提供商和模型信息。
 *
 * 主要功能：
 * - Model Schema：模型数据结构定义
 * - Provider Schema：提供商数据结构定义
 * - get()：获取提供商数据（优先使用缓存）
 * - refresh()：从 models.dev API 刷新数据
 *
 * 依赖关系：
 * - ../global：全局路径配置
 * - ../util/log：日志记录
 * - ../flag/flag：功能标志
 * - ../installation：安装信息（User-Agent）
 *
 * 导出内容：
 * - ModelsDev namespace：Models.dev API 集成命名空间
 *   - Model Schema：模型定义
 *   - Provider Schema：提供商定义
 *   - get()：获取提供商数据
 *   - refresh()：刷新远程数据
 *
 * 数据来源：
 * - models.dev API：https://models.dev/api.json
 * - 内置数据：从 models-macro.ts 加载的编译时数据
 * - 本地缓存：缓存目录中的 models.json
 *
 * 刷新机制：
 * - 每 60 分钟自动刷新一次
 * - 请求超时 10 秒
 * - 失败时静默处理，使用缓存或内置数据
 *
 * 使用示例：
 * ```typescript
 * // 获取提供商数据
 * const providers = await ModelsDev.get()
 * // {
 * //   "anthropic": {
 * //     id: "anthropic",
 * //     name: "Anthropic",
 * //     api: "https://api.anthropic.com",
 * //     models: { ... }
 * //   }
 * // }
 *
 * // 手动刷新数据
 * await ModelsDev.refresh()
 * ```
 *
 * @package opencode
 * @module provider/models
 */

// 导入全局路径配置
import { Global } from "../global"

// 导入日志工具
import { Log } from "../util/log"

// 导入路径模块
import path from "path"

// 导入 Zod 用于运行时类型验证
import z from "zod"

// 导入编译时宏数据，包含内置的模型数据
import { data } from "./models-macro" with { type: "macro" }

// 导入安装管理模块，用于获取 User-Agent
import { Installation } from "../installation"

// 导入功能标志
import { Flag } from "../flag/flag"

/**
 * Models.dev API 集成命名空间
 *
 * 从 models.dev 获取最新的 AI 提供商和模型信息。
 */
export namespace ModelsDev {
  // 创建日志记录器
  const log = Log.create({ service: "models.dev" })

  // 缓存文件路径
  const filepath = path.join(Global.Path.cache, "models.json")

  /**
   * 模型 Schema
   *
   * 定义从 models.dev 返回的模型数据结构。
   */
  export const Model = z.object({
    // 模型唯一标识符
    id: z.string(),
    // 模型显示名称
    name: z.string(),
    // 模型系列（如 claude, gpt）
    family: z.string().optional(),
    // 发布日期（ISO 8601 格式）
    release_date: z.string(),
    // 是否支持文件附件
    attachment: z.boolean(),
    // 是否支持推理模式
    reasoning: z.boolean(),
    // 是否支持温度参数
    temperature: z.boolean(),
    // 是否支持工具调用
    tool_call: z.boolean(),
    // 交错的推理内容配置
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            // 字段名称
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    // 成本信息
    cost: z
      .object({
        // 输入成本（每 1M tokens）
        input: z.number(),
        // 输出成本（每 1M tokens）
        output: z.number(),
        // 缓存读取成本
        cache_read: z.number().optional(),
        // 缓存写入成本
        cache_write: z.number().optional(),
        // 200K+ 上下文的成本
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    // 模型限制
    limit: z.object({
      // 上下文窗口大小（tokens）
      context: z.number(),
      // 最大输出 tokens
      output: z.number(),
    }),
    // 支持的模态（输入/输出类型）
    modalities: z
      .object({
        // 输入模态
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        // 输出模态
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    // 是否为实验性功能
    experimental: z.boolean().optional(),
    // 模型状态
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    // 额外的模型选项
    options: z.record(z.string(), z.any()),
    // 自定义请求头
    headers: z.record(z.string(), z.string()).optional(),
    // 提供商信息（优先于提供商级别的配置）
    provider: z.object({ npm: z.string() }).optional(),
    // 模型变体
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  /**
   * 提供商 Schema
   *
   * 定义从 models.dev 返回的提供商数据结构。
   */
  export const Provider = z.object({
    // API 端点 URL
    api: z.string().optional(),
    // 提供商显示名称
    name: z.string(),
    // 需要的环境变量列表
    env: z.array(z.string()),
    // 提供商唯一标识符
    id: z.string(),
    // npm 包名（用于动态加载）
    npm: z.string().optional(),
    // 模型列表
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  /**
   * 获取提供商数据
   *
   * 从缓存或内置数据获取提供商信息。
   * 优先使用缓存，然后是内置数据。
   *
   * @returns Promise，解析为提供商 ID 到提供商信息的映射
   *
   * 获取顺序：
   * 1. 尝试刷新远程数据（异步，不阻塞）
   * 2. 读取缓存文件
   * 3. 如果缓存不存在，使用内置数据
   *
   * @example
   * ```typescript
   * const providers = await ModelsDev.get()
   * console.log(Object.keys(providers))
   * // ["anthropic", "openai", "google", ...]
   * ```
   */
  export async function get() {
    // 尝试刷新远程数据（不阻塞）
    refresh()
    // 尝试读取缓存文件
    const file = Bun.file(filepath)
    const result = await file.json().catch(() => {})
    if (result) return result as Record<string, Provider>
    // 如果缓存不存在，使用内置数据
    const json = await data()
    return JSON.parse(json) as Record<string, Provider>
  }

  /**
   * 刷新远程数据
   *
   * 从 models.dev API 获取最新的提供商和模型信息。
   *
   * @returns Promise，完成时数据已更新到缓存
   *
   * 处理流程：
   * 1. 检查是否禁用了模型获取
   * 2. 发起 HTTP GET 请求到 models.dev API
   * 3. 设置 10 秒超时
   * 4. 如果成功，写入缓存文件
   * 5. 如果失败，记录错误但不抛出异常
   *
   * 错误处理：
   * - 网络错误：静默处理，使用缓存或内置数据
   * - 超时：10 秒后自动取消请求
   *
   * @example
   * ```typescript
   * // 手动刷新数据
   * await ModelsDev.refresh()
   * ```
   */
  export async function refresh() {
    // 如果禁用了模型获取，直接返回
    if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return
    const file = Bun.file(filepath)
    log.info("refreshing", {
      file,
    })
    // 发起 HTTP 请求获取最新数据
    const result = await fetch("https://models.dev/api.json", {
      headers: {
        // 设置 User-Agent 用于统计
        "User-Agent": Installation.USER_AGENT,
      },
      // 10 秒超时
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      // 请求失败，记录错误但不抛出
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    // 如果请求成功，写入缓存文件
    if (result && result.ok) await Bun.write(file, await result.text())
  }
}

// 每 60 分钟自动刷新一次数据
// unref() 允许进程在计时器活动时退出
setInterval(() => ModelsDev.refresh(), 60 * 1000 * 60).unref()
