/**
 * ============================================================================
 * 文件名：user.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * 用户管理模块。提供工作区用户的创建、查询、邀请、更新和删除功能。
 *
 * 主要功能：
 * - 列出工作区用户
 * - 根据 ID 查询用户
 * - 邀请用户加入工作区
 * - 加入被邀请的工作区
 * - 更新用户角色和限额
 * - 删除（软删除）用户
 * - 发送邀请邮件
 *
 * 依赖关系：
 * - zod：运行时类型验证
 * - drizzle-orm：数据库 ORM
 * - ./util/fn：函数包装工具
 * - ./drizzle：数据库连接
 * - ./schema/user.sql：用户数据表模型
 * - ./actor：Actor 上下文管理
 * - ./identifier：ID 生成工具
 * - @jsx-email/render：邮件渲染
 * - ./aws：AWS 服务集成
 * - ./key：API 密钥管理
 *
 * 导出内容：
 * - User.list：列出工作区用户
 * - User.fromID：根据 ID 查询用户
 * - User.getAuthEmail：获取用户认证邮箱
 * - User.invite：邀请用户加入工作区
 * - User.joinInvitedWorkspaces：加入被邀请的工作区
 * - User.update：更新用户信息
 * - User.remove：删除用户
 *
 * 使用场景：
 * - 用户管理界面
 * - 工作区成员管理
 * - 权限控制
 *
 * @package console.core
 * @module user
 */

// 导入 Zod 类型验证库
import { z } from "zod"

// 导入 Drizzle ORM 操作符
import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm"

// 导入函数包装工具
import { fn } from "./util/fn"

// 导入数据库连接
import { Database } from "./drizzle"

// 导入用户数据表模型和角色枚举
import { UserRole, UserTable } from "./schema/user.sql"

// 导入 Actor 上下文管理
import { Actor } from "./actor"

// 导入标识符生成工具
import { Identifier } from "./identifier"

// 导入邮件渲染工具
import { render } from "@jsx-email/render"

// 导入 AWS 服务模块
import { AWS } from "./aws"

// 导入 API 密钥管理
import { Key } from "./key"

// 导入数据表模型
import { KeyTable } from "./schema/key.sql"
import { WorkspaceTable } from "./schema/workspace.sql"
import { AuthTable } from "./schema/auth.sql"

/**
 * User 命名空间
 *
 * 包含所有用户相关的操作函数。
 */
export namespace User {
  /**
   * 断言不是自己
   *
   * 防止用户对自己执行某些操作（如删除、降级）。
   *
   * @param id - 要检查的用户 ID
   * @throws 如果 ID 是当前用户自己的 ID
   */
  const assertNotSelf = (id: string) => {
    // 获取当前用户的 ID
    if (Actor.userID() !== id) return

    // 是自己，抛出错误
    throw new Error(`Expected not self actor, got self actor`)
  }

  /**
   * 列出工作区用户
   *
   * 获取当前工作区的所有用户列表。
   * 包含用户信息和对应的认证邮箱。
   *
   * @returns 用户列表
   *
   * @example
   * ```typescript
   * const users = await User.list()
   * // 返回数组，包含所有未删除的用户
   * ```
   */
  export const list = fn(z.void(), () =>
    Database.use((tx) =>
      tx
        // 选择用户表的所有列
        .select({
          ...getTableColumns(UserTable),
          // 关联认证邮箱
          authEmail: AuthTable.subject,
        })
        .from(UserTable)
        // 左连接认证表（通过邮箱提供商）
        .leftJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
        // 筛选条件：当前工作区且未删除
        .where(and(eq(UserTable.workspaceID, Actor.workspace()), isNull(UserTable.timeDeleted))),
    ),
  )

  /**
   * 根据 ID 查询用户
   *
   * 获取指定 ID 的用户信息。
   *
   * @param id - 用户 ID
   * @returns 用户记录，如果不存在则返回 undefined
   *
   * @example
   * ```typescript
   * const user = await User.fromID("usr_123")
   * if (user) {
   *   console.log(user.name)
   * }
   * ```
   */
  export const fromID = fn(z.string(), (id) =>
    Database.use((tx) =>
      tx
        .select()
        .from(UserTable)
        // 筛选条件：当前工作区、指定 ID、未删除
        .where(and(eq(UserTable.workspaceID, Actor.workspace()), eq(UserTable.id, id), isNull(UserTable.timeDeleted)))
        // 取第一条记录
        .then((rows) => rows[0]),
    ),
  )

  /**
   * 获取用户认证邮箱
   *
   * 获取用户关联的认证邮箱地址。
   *
   * @param id - 用户 ID
   * @returns 邮箱地址，如果不存在则返回 undefined
   *
   * @example
   * ```typescript
   * const email = await User.getAuthEmail("usr_123")
   * console.log(email) // "user@example.com"
   * ```
   */
  export const getAuthEmail = fn(z.string(), (id) =>
    Database.use((tx) =>
      tx
        .select({
          email: AuthTable.subject,
        })
        .from(UserTable)
        // 左连接认证表（通过邮箱提供商）
        .leftJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
        // 筛选条件：当前工作区、指定 ID
        .where(and(eq(UserTable.workspaceID, Actor.workspace()), eq(UserTable.id, id)))
        // 取第一条记录的邮箱
        .then((rows) => rows[0]?.email),
    ),
  )

  /**
   * 邀请用户加入工作区
   *
   * 邀请指定邮箱的用户加入当前工作区。
   * 如果用户已存在，则更新其角色和限额。
   * 发送邀请邮件通知用户。
   *
   * @param input.email - 要邀请的用户邮箱
   * @param input.role - 用户角色
   * @param input.monthlyLimit - 月度消费限额（可选）
   *
   * @example
   * ```typescript
   * await User.invite({
   *   email: "user@example.com",
   *   role: "member",
   *   monthlyLimit: 100,
   * })
   * ```
   */
  export const invite = fn(
    z.object({
      // 用户邮箱
      email: z.string(),
      // 用户角色（枚举值）
      role: z.enum(UserRole),
      // 月度消费限额（可为 null）
      monthlyLimit: z.number().nullable().optional(),
    }),
    async ({ email, role, monthlyLimit }) => {
      // 只有管理员可以邀请用户
      Actor.assertAdmin()

      // 获取当前工作区 ID
      const workspaceID = Actor.workspace()

      // 查找邮箱对应的账户 ID
      const accountID = await Database.use((tx) =>
        tx
          .select({
            accountID: AuthTable.accountID,
          })
          .from(AuthTable)
          // 匹配邮箱提供商和邮箱地址
          .where(and(eq(AuthTable.provider, "email"), eq(AuthTable.subject, email)))
          // 取第一条记录的账户 ID
          .then((rows) => rows[0]?.accountID),
      )

      // 创建或更新用户记录
      await Database.use((tx) =>
        tx
          .insert(UserTable)
          .values({
            // 生成新的用户 ID
            id: Identifier.create("user"),
            // 默认空名称
            name: "",
            // 根据是否有账户 ID 设置不同字段
            ...(accountID
              ? {
                  // 已有账户，关联账户 ID
                  accountID,
                }
              : {
                  // 新用户，保存邮箱用于后续匹配
                  email,
                }),
            // 工作区 ID
            workspaceID,
            // 用户角色
            role,
            // 月度限额
            monthlyLimit,
          })
          // 如果记录已存在（软删除），更新并恢复
          .onDuplicateKeyUpdate({
            set: {
              role,
              monthlyLimit,
              // 清除删除时间，恢复用户
              timeDeleted: null,
            },
          }),
      )

      // 为已注册用户创建默认 API 密钥
      if (accountID) {
        await Database.use(async (tx) => {
          // 查找工作区中该账户对应的用户
          const user = await tx
            .select()
            .from(UserTable)
            .where(and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.accountID, accountID)))
            .then((rows) => rows[0])

          // 查找用户是否已有 API 密钥
          const key = await tx
            .select()
            .from(KeyTable)
            .where(and(eq(KeyTable.workspaceID, workspaceID), eq(KeyTable.userID, user.id)))
            .then((rows) => rows[0])

          // 如果已有密钥，跳过
          if (key) return

          // 创建默认 API 密钥
          await Key.create({ userID: user.id, name: "Default API Key" })
        })
      }

      // 发送邀请邮件（忽略错误）
      try {
        // 查询邀请者信息和工作区名称
        const emailInfo = await Database.use((tx) =>
          tx
            .select({
              inviterEmail: AuthTable.subject,
              workspaceName: WorkspaceTable.name,
            })
            .from(UserTable)
            // 关联认证表获取邀请者邮箱
            .innerJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
            // 关联工作区表获取工作区名称
            .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, workspaceID))
            // 筛选当前用户
            .where(
              and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.id, Actor.assert("user").properties.userID)),
            )
            .then((rows) => rows[0]),
        )

        // 动态导入邮件模板
        const { InviteEmail } = await import("@opencode-ai/console-mail/InviteEmail.jsx")

        // 发送邮件
        await AWS.sendEmail({
          // 收件人
          to: email,
          // 邮件主题
          subject: `You've been invited to join the ${emailInfo.workspaceName} workspace on OpenCode`,
          // 邮件内容（渲染 JSX 邮件模板）
          body: render(
            // @ts-ignore - JSX Email 类型不完整
            InviteEmail({
              // 邀请者邮箱
              inviter: emailInfo.inviterEmail,
              // 静态资源 URL
              assetsUrl: `https://opencode.ai/email`,
              // 工作区 ID
              workspaceID: workspaceID,
              // 工作区名称
              workspaceName: emailInfo.workspaceName,
            }),
          ),
        })
      } catch (e) {
        // 邮件发送失败不影响邀请流程
        console.error(e)
      }
    },
  )

  /**
   * 加入被邀请的工作区
   *
   * 当用户登录时，查找所有以该邮箱邀请的工作区并自动加入。
   * 为每个工作区创建默认 API 密钥。
   *
   * @example
   * ```typescript
   * // 用户登录后调用
   * await User.joinInvitedWorkspaces()
   * ```
   */
  export const joinInvitedWorkspaces = fn(z.void(), async () => {
    // 断言当前是账户级别的 Actor
    const account = Actor.assert("account")

    // 查找所有以该邮箱邀请的工作区
    const invitations = await Database.use(async (tx) => {
      // 查询所有未加入的邀请
      const invitations = await tx
        .select({
          id: UserTable.id,
          workspaceID: UserTable.workspaceID,
        })
        .from(UserTable)
        // 匹配邮箱
        .where(eq(UserTable.email, account.properties.email))

      // 更新邀请记录，关联账户
      await tx
        .update(UserTable)
        .set({
          // 设置账户 ID
          accountID: account.properties.accountID,
          // 清除邮箱，表示已加入
          email: null,
        })
        .where(eq(UserTable.email, account.properties.email))

      // 返回邀请列表
      return invitations
    })

    // 为每个工作区创建默认 API 密钥
    await Promise.all(
      invitations.map((invite) =>
        // 在系统上下文中执行（不受权限限制）
        Actor.provide(
          "system",
          {
            workspaceID: invite.workspaceID,
          },
          // 创建默认 API 密钥
          () => Key.create({ userID: invite.id, name: "Default API Key" }),
        ),
      ),
    )
  })

  /**
   * 更新用户信息
   *
   * 更新用户的角色和月度限额。
   * 管理员不能将自己的角色降级为 member。
   *
   * @param input.id - 要更新的用户 ID
   * @param input.role - 新角色
   * @param input.monthlyLimit - 新的月度限额
   * @returns 更新结果
   *
   * @example
   * ```typescript
   * await User.update({
   *   id: "usr_123",
   *   role: "admin",
   *   monthlyLimit: 200,
   * })
   * ```
   */
  export const update = fn(
    z.object({
      id: z.string(),
      role: z.enum(UserRole),
      monthlyLimit: z.number().nullable(),
    }),
    async ({ id, role, monthlyLimit }) => {
      // 只有管理员可以更新用户
      Actor.assertAdmin()

      // 不能将自己降级为 member
      if (role === "member") assertNotSelf(id)

      // 执行更新
      return await Database.use((tx) =>
        tx
          .update(UserTable)
          .set({ role, monthlyLimit })
          // 筛选条件：当前工作区、指定用户 ID
          .where(and(eq(UserTable.id, id), eq(UserTable.workspaceID, Actor.workspace()))),
      )
    },
  )

  /**
   * 删除用户
   *
   * 软删除用户（设置删除时间戳）。
   * 不能删除自己。
   *
   * @param id - 要删除的用户 ID
   * @returns 删除结果
   *
   * @example
   * ```typescript
   * await User.remove("usr_123")
   * ```
   */
  export const remove = fn(z.string(), async (id) => {
    // 只有管理员可以删除用户
    Actor.assertAdmin()

    // 不能删除自己
    assertNotSelf(id)

    // 执行软删除
    return await Database.use((tx) =>
      tx
        .update(UserTable)
        .set({
          // 设置删除时间为当前时间
          timeDeleted: sql`now()`,
        })
        // 筛选条件：当前工作区、指定用户 ID
        .where(and(eq(UserTable.id, id), eq(UserTable.workspaceID, Actor.workspace()))),
    )
  })
}
