/**
 * ============================================================================
 * 文件名：account.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * 账户管理模块。提供账户的创建和查询功能。
 *
 * 主要功能：
 * - 创建新账户
 * - 根据 ID 查询账户
 *
 * 依赖关系：
 * - zod：运行时类型验证
 * - drizzle-orm：数据库 ORM
 * - ./util/fn：函数包装工具
 * - ./drizzle：数据库连接
 * - ./identifier：ID 生成工具
 * - ./schema/account.sql：账户数据表模型
 *
 * 导出内容：
 * - Account.create：创建账户函数
 * - Account.fromID：根据 ID 查询账户函数
 *
 * 使用场景：
 * - 用户注册时创建账户
 * - 认证流程中查询账户
 *
 * @package console.core
 * @module account
 */

// 导入 Zod 类型验证库
import { z } from "zod"

// 导入 Drizzle ORM 的 eq 操作符
// 用于构建相等条件的 WHERE 子句
import { eq } from "drizzle-orm"

// 导入函数包装工具
// fn 用于包装函数，提供类型验证和错误处理
import { fn } from "./util/fn"

// 导入数据库连接模块
import { Database } from "./drizzle"

// 导入标识符生成工具
import { Identifier } from "./identifier"

// 导入账户数据表模型
import { AccountTable } from "./schema/account.sql"

/**
 * Account 命名空间
 *
 * 包含所有账户相关的操作函数。
 */
export namespace Account {
  /**
   * 创建账户函数
   *
   * 在数据库中创建一个新的账户记录。
   *
   * @param input.id - 可选的账户 ID，如果不提供则自动生成
   * @returns 创建的账户 ID
   *
   * @example
   * ```typescript
   * const accountID = await Account.create({})
   * const customID = await Account.create({ id: "acc_custom" })
   * ```
   */
  export const create = fn(
    // 定义输入参数的验证 schema
    z.object({
      // 可选的账户 ID
      id: z.string().optional(),
    }),
    // 实现函数
    async (input) =>
      Database.use(async (tx) => {
        // 使用提供的 ID 或生成新的 ID
        const id = input.id ?? Identifier.create("account")

        // 向数据库插入账户记录
        await tx.insert(AccountTable).values({
          id,
        })

        // 返回账户 ID
        return id
      }),
  )

  /**
   * 根据 ID 查询账户函数
   *
   * 从数据库中获取指定 ID 的账户信息。
   *
   * @param id - 账户 ID
   * @returns 账户记录，如果不存在则返回 undefined
   *
   * @example
   * ```typescript
   * const account = await Account.fromID("acc_123")
   * if (account) {
   *   console.log(account.id)
   * }
   * ```
   */
  export const fromID = fn(
    // 输入参数：字符串类型的账户 ID
    z.string(),
    // 实现函数
    async (id) =>
      Database.use((tx) =>
        tx
          // 查询账户表
          .select()
          .from(AccountTable)
          // 根据 ID 筛选
          .where(eq(AccountTable.id, id))
          // 取第一条记录（如果存在）
          .then((rows) => rows[0]),
      ),
  )
}
