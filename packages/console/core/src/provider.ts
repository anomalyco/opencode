/**
 * ============================================================================
 * 文件名：provider.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * AI 提供商管理模块。提供工作区级别的 AI 提供商配置管理。
 *
 * 主要功能：
 * - 列出工作区的 AI 提供商配置
 * - 添加或更新 AI 提供商凭证
 * - 删除 AI 提供商配置
 *
 * 依赖关系：
 * - zod：运行时类型验证
 * - ./util/fn：函数包装工具
 * - ./actor：Actor 上下文管理
 * - ./drizzle：数据库连接
 * - ./identifier：ID 生成工具
 * - ./schema/provider.sql：提供商数据表模型
 *
 * 导出内容：
 * - Provider.list：列出 AI 提供商
 * - Provider.create：创建或更新提供商
 * - Provider.remove：删除提供商
 *
 * 使用场景：
 * - 配置 OpenAI、Anthropic 等 AI 提供商
 * - 管理工作区的 API 密钥
 *
 * @package console.core
 * @module provider
 */

// 导入 Zod 类型验证库
import { z } from "zod"

// 导入函数包装工具
import { fn } from "./util/fn"

// 导入 Actor 上下文管理
import { Actor } from "./actor"

// 导入 Drizzle ORM 操作符和数据库
import { and, Database, eq, isNull } from "./drizzle"

// 导入标识符生成工具
import { Identifier } from "./identifier"

// 导入提供商数据表模型
import { ProviderTable } from "./schema/provider.sql"

/**
 * Provider 命名空间
 *
 * 包含所有 AI 提供商配置相关的操作函数。
 */
export namespace Provider {
  /**
   * 列出 AI 提供商
   *
   * 获取当前工作区配置的所有 AI 提供商。
   *
   * @returns 提供商配置列表
   *
   * @example
   * ```typescript
   * const providers = await Provider.list()
   * // 返回数组，包含所有未删除的提供商配置
   * ```
   */
  export const list = fn(z.void(), () =>
    Database.use((tx) =>
      tx
        .select()
        .from(ProviderTable)
        // 筛选条件：当前工作区且未删除
        .where(and(eq(ProviderTable.workspaceID, Actor.workspace()), isNull(ProviderTable.timeDeleted))),
    ),
  )

  /**
   * 创建或更新 AI 提供商
   *
   * 添加新的 AI 提供商配置，或更新现有提供商的凭证。
   * 如果提供商已存在（软删除），则恢复并更新凭证。
   * 只有管理员可以执行此操作。
   *
   * @param input.provider - 提供商名称（如 "openai", "anthropic"）
   * @param input.credentials - 提供商凭证（API 密钥等）
   * @returns 操作结果
   *
   * @example
   * ```typescript
   * await Provider.create({
   *   provider: "openai",
   *   credentials: "sk-...",
   * })
   * ```
   */
  export const create = fn(
    z.object({
      // 提供商名称，1-64 个字符
      provider: z.string().min(1).max(64),
      // 提供商凭证（加密存储）
      credentials: z.string(),
    }),
    async ({ provider, credentials }) => {
      // 只有管理员可以配置提供商
      Actor.assertAdmin()

      // 插入或更新提供商配置
      return Database.use((tx) =>
        tx
          .insert(ProviderTable)
          .values({
            // 生成提供商配置 ID
            id: Identifier.create("provider"),
            // 当前工作区
            workspaceID: Actor.workspace(),
            // 提供商名称
            provider,
            // 提供商凭证
            credentials,
          })
          // 如果记录已存在（软删除），更新并恢复
          .onDuplicateKeyUpdate({
            set: {
              // 更新凭证
              credentials,
              // 清除删除时间，恢复配置
              timeDeleted: null,
            },
          }),
      )
    },
  )

  /**
   * 删除 AI 提供商
   *
   * 删除指定提供商的配置。
   * 只有管理员可以执行此操作。
   *
   * @param input.provider - 要删除的提供商名称
   * @returns 删除结果
   *
   * @example
   * ```typescript
   * await Provider.remove({
   *   provider: "openai",
   * })
   * ```
   */
  export const remove = fn(
    z.object({
      // 提供商名称
      provider: z.string(),
    }),
    async ({ provider }) => {
      // 只有管理员可以删除提供商
      Actor.assertAdmin()

      // 执行删除
      return Database.use((tx) =>
        tx
          .delete(ProviderTable)
          // 筛选条件：当前工作区、指定提供商
          .where(and(eq(ProviderTable.provider, provider), eq(ProviderTable.workspaceID, Actor.workspace()))),
      )
    },
  )
}
