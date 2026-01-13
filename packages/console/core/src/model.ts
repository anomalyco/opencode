/**
 * ============================================================================
 * 文件名：model.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * AI 模型配置管理模块。提供模型列表、模型启用/禁用、模型成本配置等功能。
 *
 * 主要功能：
 * - 获取可用的 AI 模型列表及其配置
 * - 启用/禁用工作区的特定模型
 * - 查询已禁用的模型列表
 * - 检查模型是否被禁用
 * - 验证模型配置数据
 *
 * ZenData 说明：
 * ZenData 包含 AI 模型的元数据配置，包括：
 * - 模型名称和提供商信息
 * - 成本配置（输入/输出/缓存读写成本）
 * - 速率限制
 * - BYOK（自带密钥）支持
 * - 试验配置
 * - 提供商权重分配
 *
 * 依赖关系：
 * - zod：运行时类型验证
 * - drizzle-orm：数据库 ORM
 * - ./drizzle：数据库连接
 * - ./schema/model.sql：模型数据表模型
 * - ./identifier：ID 生成工具
 * - ./util/fn：函数包装工具
 * - ./actor：Actor 上下文管理
 * - @opencode-ai/console-resource：模型配置资源
 *
 * 导出内容：
 * - ZenData.validate：验证模型配置数据
 * - ZenData.list：获取所有可用模型配置
 * - ZenData.Format：模型格式类型
 * - ZenData.Trial：试验配置类型
 * - Model.enable：启用模型
 * - Model.disable：禁用模型
 * - Model.listDisabled：列出已禁用的模型
 * - Model.isDisabled：检查模型是否被禁用
 *
 * 使用场景：
 * - 模型管理界面
 * - AI 提供商路由
 * - 成本计算
 * - 模型可用性检查
 *
 * @package console.core
 * @module model
 */

// 导入 Zod 类型验证库
import { z } from "zod"

// 导入 Drizzle ORM 操作符
import { eq, and } from "drizzle-orm"

// 导入数据库连接
import { Database } from "./drizzle"

// 导入模型数据表模型
import { ModelTable } from "./schema/model.sql"

// 导入标识符生成工具
import { Identifier } from "./identifier"

// 导入函数包装工具
import { fn } from "./util/fn"

// 导入 Actor 上下文管理
import { Actor } from "./actor"

// 导入资源管理模块（包含模型配置）
import { Resource } from "@opencode-ai/console-resource"

/**
 * ZenData 命名空间
 *
 * 包含所有模型元数据配置相关的操作函数和类型定义。
 */
export namespace ZenData {
  /**
   * 模型格式枚举
   *
   * 定义支持的 AI 提供商 API 格式。
   * - anthropic：Anthropic Claude API 格式
   * - google：Google Gemini API 格式
   * - openai：OpenAI Chat Completions API 格式
   * - oa-compat：OpenAI 兼容格式
   */
  const FormatSchema = z.enum(["anthropic", "google", "openai", "oa-compat"])

  /**
   * 试验配置模式
   *
   * 定义模型试验限制配置。
   */
  const TrialSchema = z.object({
    // 提供商名称
    provider: z.string(),
    // 限制列表
    limits: z.array(
      z.object({
        // 限制值
        limit: z.number(),
        // 客户端类型（cli 或 desktop）
        client: z.enum(["cli", "desktop"]).optional(),
      }),
    ),
  })

  /**
   * 模型格式类型
   *
   * 从 FormatSchema 推断出的 TypeScript 类型。
   */
  export type Format = z.infer<typeof FormatSchema>

  /**
   * 试验配置类型
   *
   * 从 TrialSchema 推断出的 TypeScript 类型。
   */
  export type Trial = z.infer<typeof TrialSchema>

  /**
   * 模型成本模式
   *
   * 定义模型的计费配置。
   * 所有成本单位为：每 1M tokens 的美元价格。
   */
  const ModelCostSchema = z.object({
    // 输入 tokens 成本
    input: z.number(),
    // 输出 tokens 成本
    output: z.number(),
    // 缓存读取成本（可选）
    cacheRead: z.number().optional(),
    // 缓存写入成本（5 分钟缓存，可选）
    cacheWrite5m: z.number().optional(),
    // 缓存写入成本（1 小时缓存，可选）
    cacheWrite1h: z.number().optional(),
  })

  /**
   * 模型配置模式
   *
   * 定义单个模型的完整配置。
   */
  const ModelSchema = z.object({
    // 模型显示名称
    name: z.string(),
    // 默认成本配置
    cost: ModelCostSchema,
    // 200K 上下文成本配置（可选）
    cost200K: ModelCostSchema.optional(),
    // 是否允许匿名使用（可选）
    allowAnonymous: z.boolean().optional(),
    // BYOK 支持的提供商（可选）
    byokProvider: z.enum(["openai", "anthropic", "google"]).optional(),
    // 是否使用粘性提供商（可选）
    stickyProvider: z.boolean().optional(),
    // 试验配置（可选）
    trial: TrialSchema.optional(),
    // 速率限制（可选）
    rateLimit: z.number().optional(),
    // 后备提供商（可选）
    fallbackProvider: z.string().optional(),
    // 提供商列表（用于负载均衡）
    providers: z.array(
      z.object({
        // 提供商 ID
        id: z.string(),
        // 提供商模型名称
        model: z.string(),
        // 权重（用于负载均衡，可选）
        weight: z.number().optional(),
        // 是否禁用（可选）
        disabled: z.boolean().optional(),
        // 存储模型名称（可选）
        storeModel: z.string().optional(),
      }),
    ),
  })

  /**
   * 提供商配置模式
   *
   * 定义 AI 提供商的 API 配置。
   */
  const ProviderSchema = z.object({
    // API 端点
    api: z.string(),
    // API 密钥
    apiKey: z.string(),
    // API 格式
    format: FormatSchema,
    // HTTP 头映射（可选）
    headerMappings: z.record(z.string(), z.string()).optional(),
  })

  /**
   * 模型列表配置模式
   *
   * 定义所有模型和提供商的完整配置。
   */
  const ModelsSchema = z.object({
    // 模型配置映射
    // 键为模型 ID，值为模型配置或模型配置数组
    models: z.record(
      z.string(),
      z.union([
        ModelSchema,
        z.array(ModelSchema.extend({
          // 格式过滤器（用于数组变体）
          formatFilter: FormatSchema
        })),
      ]),
    ),
    // 提供商配置映射
    providers: z.record(z.string(), ProviderSchema),
  })

  /**
   * 验证模型配置数据
   *
   * 验证传入的数据是否符合模型配置的模式。
   *
   * @param input - 要验证的模型配置数据
   * @returns 验证通过的数据
   *
   * @example
   * ```typescript
   * const validated = await ZenData.validate({
   *   models: { "claude-3-opus": { ... } },
   *   providers: { "anthropic": { ... } },
   * })
   * ```
   */
  export const validate = fn(ModelsSchema, (input) => {
    // 返回验证后的数据
    return input
  })

  /**
   * 获取所有可用模型配置
   *
   * 从资源中获取并拼接完整的模型配置。
   * 配置被分割成多个部分以适应环境变量限制。
   *
   * @returns 模型配置对象
   *
   * @example
   * ```typescript
   * const modelsConfig = await ZenData.list()
   * console.log(Object.keys(modelsConfig.models)) // 所有模型 ID
   * console.log(modelsConfig.providers)          // 所有提供商配置
   * ```
   */
  export const list = fn(z.void(), () => {
    // 拼接所有模型配置资源（分割为 7 个部分）
    const json = JSON.parse(
      Resource.ZEN_MODELS1.value +
        Resource.ZEN_MODELS2.value +
        Resource.ZEN_MODELS3.value +
        Resource.ZEN_MODELS4.value +
        Resource.ZEN_MODELS5.value +
        Resource.ZEN_MODELS6.value +
        Resource.ZEN_MODELS7.value,
    )
    // 验证并返回解析后的配置
    return ModelsSchema.parse(json)
  })
}

/**
 * Model 命名空间
 *
 * 包含所有工作区模型管理相关的操作函数。
 */
export namespace Model {
  /**
   * 启用模型
   *
   * 从工作区的禁用模型列表中移除指定模型。
   * 只有管理员可以执行此操作。
   *
   * @param input.model - 要启用的模型 ID
   * @returns 操作结果
   *
   * @example
   * ```typescript
   * await Model.enable({ model: "claude-3-opus" })
   * ```
   */
  export const enable = fn(z.object({ model: z.string() }), ({ model }) => {
    // 只有管理员可以启用模型
    Actor.assertAdmin()
    // 从数据库中删除该模型的禁用记录
    return Database.use((db) =>
      db.delete(ModelTable).where(and(eq(ModelTable.workspaceID, Actor.workspace()), eq(ModelTable.model, model))),
    )
  })

  /**
   * 禁用模型
   *
   * 将指定模型添加到工作区的禁用列表。
   * 只有管理员可以执行此操作。
   *
   * @param input.model - 要禁用的模型 ID
   * @returns 操作结果
   *
   * @example
   * ```typescript
   * await Model.disable({ model: "claude-3-opus" })
   * ```
   */
  export const disable = fn(z.object({ model: z.string() }), ({ model }) => {
    // 只有管理员可以禁用模型
    Actor.assertAdmin()
    // 在数据库中插入或更新模型的禁用记录
    return Database.use((db) =>
      db
        .insert(ModelTable)
        .values({
          // 生成模型配置 ID
          id: Identifier.create("model"),
          // 当前工作区
          workspaceID: Actor.workspace(),
          // 要禁用的模型 ID
          model: model,
        })
        // 如果记录已存在（软删除），恢复禁用状态
        .onDuplicateKeyUpdate({
          set: {
            // 清除删除时间，表示禁用
            timeDeleted: null,
          },
        }),
    )
  })

  /**
   * 列出已禁用的模型
   *
   * 获取当前工作区所有被禁用的模型列表。
   *
   * @returns 已禁用的模型 ID 数组
   *
   * @example
   * ```typescript
   * const disabled = await Model.listDisabled()
   * // 返回: ["claude-3-opus", "gpt-4"]
   * ```
   */
  export const listDisabled = fn(z.void(), () => {
    return Database.use((db) =>
      db
        .select({ model: ModelTable.model })
        .from(ModelTable)
        // 筛选当前工作区的禁用模型
        .where(eq(ModelTable.workspaceID, Actor.workspace()))
        // 提取模型 ID
        .then((rows) => rows.map((row) => row.model)),
    )
  })

  /**
   * 检查模型是否被禁用
   *
   * 查询指定模型是否在当前工作区的禁用列表中。
   *
   * @param input.model - 要检查的模型 ID
   * @returns 如果模型被禁用返回 true，否则返回 false
   *
   * @example
   * ```typescript
   * const isDisabled = await Model.isDisabled({ model: "claude-3-opus" })
   * if (isDisabled) {
   *   console.log("此模型已被禁用")
   * }
   * ```
   */
  export const isDisabled = fn(
    z.object({
      model: z.string(),
    }),
    ({ model }) => {
      return Database.use(async (db) => {
        // 查询模型的禁用记录
        const result = await db
          .select()
          .from(ModelTable)
          // 筛选条件：当前工作区、指定模型
          .where(and(eq(ModelTable.workspaceID, Actor.workspace()), eq(ModelTable.model, model)))
          // 最多返回一条记录
          .limit(1)

        // 如果有记录则模型被禁用
        return result.length > 0
      })
    },
  )
}
