/**
 * ============================================================================
 * 文件名：key.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * API 密钥管理模块。提供 API 密钥的创建、列表和删除功能。
 *
 * 主要功能：
 * - 列出工作区的 API 密钥
 * - 创建新的 API 密钥
 * - 删除 API 密钥
 * - 生成安全的随机密钥
 * - 权限控制（管理员可管理所有密钥，普通用户只能管理自己的）
 *
 * 依赖关系：
 * - zod：运行时类型验证
 * - ./util/fn：函数包装工具
 * - ./actor：Actor 上下文管理
 * - ./drizzle：数据库连接
 * - ./identifier：ID 生成工具
 * - ./schema/key.sql：密钥数据表模型
 * - ./schema/user.sql：用户数据表模型
 * - ./schema/auth.sql：认证数据表模型
 *
 * 导出内容：
 * - Key.list：列出 API 密钥
 * - Key.create：创建 API 密钥
 * - Key.remove：删除 API 密钥
 *
 * 使用场景：
 * - API 认证
 * - 密钥管理界面
 *
 * 密钥格式说明：
 * 格式：sk-{64位随机字符}
 * 示例：sk-AbCdEf123456...
 *
 * @package console.core
 * @module key
 */

// 导入 Zod 类型验证库
import { z } from "zod"

// 导入函数包装工具
import { fn } from "./util/fn"

// 导入 Actor 上下文管理
import { Actor } from "./actor"

// 导入 Drizzle ORM 操作符和数据库
import { and, Database, eq, isNull, sql } from "./drizzle"

// 导入标识符生成工具
import { Identifier } from "./identifier"

// 导入数据表模型
import { KeyTable } from "./schema/key.sql"
import { UserTable } from "./schema/user.sql"
import { AuthTable } from "./schema/auth.sql"

/**
 * Key 命名空间
 *
 * 包含所有 API 密钥相关的操作函数。
 */
export namespace Key {
  /**
   * 列出 API 密钥
   *
   * 获取当前工作区的所有 API 密钥。
   * 管理员可以看到所有密钥，普通用户只能看到自己的密钥。
   * 完整的密钥值只对密钥所有者可见，其他用户只能看到部分显示。
   *
   * @returns 密钥列表
   *
   * @example
   * ```typescript
   * const keys = await Key.list()
   * // 返回数组，每个密钥包含：
   * // - id: 密钥 ID
   * // - name: 密钥名称
   * // - key: 完整密钥（仅对所有者可见）
   * // - keyDisplay: 部分显示的密钥（sk-abcd...wxyz）
   * // - userID: 所属用户 ID
   * // - email: 所属用户邮箱
   * ```
   */
  export const list = fn(z.void(), async () => {
    const keys = await Database.use((tx) =>
      tx
        .select({
          // 密钥表字段
          id: KeyTable.id,
          name: KeyTable.name,
          key: KeyTable.key,
          timeUsed: KeyTable.timeUsed,
          userID: KeyTable.userID,
          // 关联用户邮箱
          email: AuthTable.subject,
        })
        .from(KeyTable)
        // 关联用户表
        .innerJoin(UserTable, and(eq(KeyTable.userID, UserTable.id), eq(KeyTable.workspaceID, UserTable.workspaceID)))
        // 关联认证表获取邮箱
        .innerJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
        // 筛选条件
        .where(
          and(
            ...[
              // 当前工作区的密钥
              eq(KeyTable.workspaceID, Actor.workspace()),
              // 未删除的密钥
              isNull(KeyTable.timeDeleted),
              // 管理员可以看到所有密钥，普通用户只能看到自己的
              ...(Actor.userRole() === "admin" ? [] : [eq(KeyTable.userID, Actor.userID())]),
            ],
          ),
        )
        // 按名称降序排序
        .orderBy(sql`${KeyTable.name} DESC`),
    )

    // 处理密钥显示
    // 只向密钥所有者返回完整密钥，其他用户返回 undefined
    return keys.map((key) => ({
      ...key,
      // 只对密钥所有者显示完整密钥
      key: key.userID === Actor.userID() ? key.key : undefined,
      // 部分显示的密钥（前 7 位 + ... + 后 4 位）
      keyDisplay: `${key.key.slice(0, 7)}...${key.key.slice(-4)}`,
    }))
  })

  /**
   * 创建 API 密钥
   *
   * 为指定用户创建新的 API 密钥。
   * 密钥格式为 sk- 加上 64 位随机字符。
   *
   * @param input.userID - 用户 ID
   * @param input.name - 密钥名称（1-255 个字符）
   * @returns 创建的密钥 ID
   *
   * @example
   * ```typescript
   * const keyID = await Key.create({
   *   userID: "usr_123",
   *   name: "Production Key",
   * })
   * // 返回类似 "key_01ARZ3NDEKTSV4RRFFQ69G5FAV"
   * ```
   */
  export const create = fn(
    z.object({
      // 用户 ID
      userID: z.string(),
      // 密钥名称，1-255 个字符
      name: z.string().min(1).max(255),
    }),
    async (input) => {
      const { name } = input

      // 生成密钥字符集（大写字母、小写字母、数字）
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

      // 密钥前缀
      let secretKey = "sk-"

      // 创建随机数组
      const array = new Uint32Array(64)

      // 填充加密随机值
      crypto.getRandomValues(array)

      // 为每个位置选择一个随机字符
      for (let i = 0, l = array.length; i < l; i++) {
        secretKey += chars[array[i] % chars.length]
      }

      // 生成密钥 ID
      const keyID = Identifier.create("key")

      // 插入密钥记录
      await Database.use((tx) =>
        tx.insert(KeyTable).values({
          id: keyID,
          // 当前工作区
          workspaceID: Actor.workspace(),
          // 所属用户
          userID: input.userID,
          // 密钥名称
          name,
          // 完整密钥
          key: secretKey,
          // 尚未使用
          timeUsed: null,
        }),
      )

      // 返回密钥 ID
      return keyID
    },
  )

  /**
   * 删除 API 密钥
   *
   * 软删除指定的 API 密钥。
   * 管理员可以删除任何密钥，普通用户只能删除自己的密钥。
   *
   * @param input.id - 要删除的密钥 ID
   * @returns 删除结果
   *
   * @example
   * ```typescript
   * await Key.remove({ id: "key_123" })
   * ```
   */
  export const remove = fn(z.object({ id: z.string() }), async (input) => {
    // 执行软删除
    await Database.use((tx) =>
      tx
        .update(KeyTable)
        .set({
          // 设置删除时间为当前时间
          timeDeleted: sql`now()`,
        })
        // 筛选条件
        .where(
          and(
            ...[
              // 指定密钥 ID
              eq(KeyTable.id, input.id),
              // 当前工作区的密钥
              eq(KeyTable.workspaceID, Actor.workspace()),
              // 管理员可以删除任何密钥，普通用户只能删除自己的
              ...(Actor.userRole() === "admin" ? [] : [eq(KeyTable.userID, Actor.userID())]),
            ],
          ),
        ),
    )
  })
}
