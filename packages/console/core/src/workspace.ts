/**
 * ============================================================================
 * 文件名：workspace.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * 工作区管理模块。提供工作区的创建、更新和删除功能。
 *
 * 主要功能：
 * - 创建新工作区
 * - 更新工作区名称
 * - 删除（软删除）工作区
 * - 自动创建管理员用户
 * - 自动创建账单记录
 * - 自动创建默认 API 密钥
 *
 * 依赖关系：
 * - zod：运行时类型验证
 * - ./util/fn：函数包装工具
 * - ./actor：Actor 上下文管理
 * - ./drizzle：数据库连接
 * - ./identifier：ID 生成工具
 * - ./key：API 密钥管理
 * - ./schema/user.sql：用户数据表模型
 * - ./schema/billing.sql：账单数据表模型
 * - ./schema/workspace.sql：工作区数据表模型
 *
 * 导出内容：
 * - Workspace.create：创建工作区
 * - Workspace.update：更新工作区名称
 * - Workspace.remove：删除工作区
 *
 * 使用场景：
 * - 用户注册后创建默认工作区
 * - 工作区管理界面
 *
 * @package console.core
 * @module workspace
 */

// 导入 Zod 类型验证库
import { z } from "zod"

// 导入函数包装工具
import { fn } from "./util/fn"

// 导入 Actor 上下文管理
import { Actor } from "./actor"

// 导入数据库连接
import { Database } from "./drizzle"

// 导入标识符生成工具
import { Identifier } from "./identifier"

// 导入数据表模型
import { UserTable } from "./schema/user.sql"
import { BillingTable } from "./schema/billing.sql"
import { WorkspaceTable } from "./schema/workspace.sql"

// 导入 API 密钥管理
import { Key } from "./key"

// 导入 Drizzle ORM 操作符
import { eq, sql } from "drizzle-orm"

/**
 * Workspace 命名空间
 *
 * 包含所有工作区相关的操作函数。
 */
export namespace Workspace {
  /**
   * 创建工作区
   *
   * 创建一个新的工作区，并自动设置：
   * - 当前账户的管理员用户
   * - 初始账单记录
   * - 默认 API 密钥
   *
   * @param input.name - 工作区名称（非空字符串）
   * @returns 创建的工作区 ID
   *
   * @example
   * ```typescript
   * const workspaceID = await Workspace.create({
   *   name: "My Workspace",
   * })
   * ```
   */
  export const create = fn(
    z.object({
      // 工作区名称，至少 1 个字符
      name: z.string().min(1),
    }),
    async ({ name }) => {
      // 断言当前是账户级别的 Actor
      const account = Actor.assert("account")

      // 生成工作区 ID
      const workspaceID = Identifier.create("workspace")

      // 生成用户 ID
      const userID = Identifier.create("user")

      // 使用事务创建工作区、用户和账单记录
      await Database.transaction(async (tx) => {
        // 插入工作区记录
        await tx.insert(WorkspaceTable).values({
          id: workspaceID,
          name,
        })

        // 插入用户记录（创建者为管理员）
        await tx.insert(UserTable).values({
          workspaceID,
          id: userID,
          accountID: account.properties.accountID,
          name: "",
          role: "admin",
        })

        // 插入账单记录（初始余额为 0）
        await tx.insert(BillingTable).values({
          workspaceID,
          id: Identifier.create("billing"),
          balance: 0,
        })
      })

      // 在系统上下文中创建默认 API 密钥
      await Actor.provide(
        "system",
        {
          workspaceID,
        },
        () => Key.create({ userID, name: "Default API Key" }),
      )

      // 返回工作区 ID
      return workspaceID
    },
  )

  /**
   * 更新工作区名称
   *
   * 更新当前工作区的名称。
   * 只有管理员可以执行此操作。
   *
   * @param input.name - 新的工作区名称（1-255 个字符）
   * @returns 更新结果
   *
   * @example
   * ```typescript
   * await Workspace.update({
   *   name: "Updated Workspace Name",
   * })
   * ```
   */
  export const update = fn(
    z.object({
      // 工作区名称，1-255 个字符
      name: z.string().min(1).max(255),
    }),
    async ({ name }) => {
      // 只有管理员可以更新工作区
      Actor.assertAdmin()

      // 获取当前工作区 ID
      const workspaceID = Actor.workspace()

      // 执行更新
      return await Database.use((tx) =>
        tx
          .update(WorkspaceTable)
          .set({
            name,
          })
          // 筛选条件：当前工作区
          .where(eq(WorkspaceTable.id, workspaceID)),
      )
    },
  )

  /**
   * 删除工作区
   *
   * 软删除当前工作区（设置删除时间戳）。
   * 注意：此操作会删除整个工作区，包括所有用户和数据。
   *
   * @returns 删除结果
   *
   * @example
   * ```typescript
   * await Workspace.remove()
   * ```
   */
  export const remove = fn(z.void(), async () => {
    // 执行软删除
    await Database.use((tx) =>
      tx
        .update(WorkspaceTable)
        .set({
          // 设置删除时间为当前时间
          timeDeleted: sql`now()`,
        })
        // 筛选条件：当前工作区
        .where(eq(WorkspaceTable.id, Actor.workspace())),
    )
  })
}
