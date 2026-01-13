/**
 * ============================================================================
 * 文件名：actor.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * Actor（执行者/主体）上下文管理模块。
 * 管理系统中不同类型的执行者（账户、用户、系统）及其权限。
 *
 * 主要功能：
 * - 定义 Actor 类型及其属性
 * - 提供 Actor 上下文的设置和获取
 * - 提供 Actor 类型的断言和验证
 * - 提供便捷的属性访问函数
 *
 * 依赖关系：
 * - ./context：异步上下文管理
 * - ./schema/user.sql：用户角色定义
 * - ./util/log：日志记录
 *
 * 导出内容：
 * - Actor.Info：Actor 类型联合
 * - Actor.use：获取当前 Actor
 * - Actor.provide：设置 Actor 上下文
 * - Actor.assert：断言 Actor 类型
 * - Actor.assertAdmin：断言管理员权限
 * - Actor.workspace：获取工作区 ID
 * - Actor.account：获取账户 ID
 * - Actor.userID：获取用户 ID
 * - Actor.userRole：获取用户角色
 *
 * 使用场景：
 * - API 请求处理时设置执行者上下文
 * - 权限验证
 * - 审计日志记录
 *
 * @package console.core
 * @module actor
 */

// 导入上下文管理模块
import { Context } from "./context"

// 导入用户角色枚举
import { UserRole } from "./schema/user.sql"

// 导入日志工具
import { Log } from "./util/log"

/**
 * Actor 命名空间
 *
 * 包含所有 Actor 相关的类型定义和操作函数。
 */
export namespace Actor {
  /**
   * Account Actor 接口
   *
   * 表示全局账户级别的执行者。
   * 跨工作区存在，不绑定特定工作区。
   */
  interface Account {
    // Actor 类型标识
    type: "account"
    // 账户属性
    properties: {
      // 账户 ID
      accountID: string
      // 账户邮箱
      email: string
    }
  }

  /**
   * Public Actor 接口
   *
   * 表示未认证的公开访问者。
   * 没有任何属性，表示匿名访问。
   */
  interface Public {
    // Actor 类型标识
    type: "public"
    // 公开访问者没有属性
    properties: {}
  }

  /**
   * User Actor 接口
   *
   * 表示特定工作区中的用户执行者。
   * 绑定到账户和工作区，具有特定角色。
   */
  interface User {
    // Actor 类型标识
    type: "user"
    // 用户属性
    properties: {
      // 用户 ID
      userID: string
      // 工作区 ID
      workspaceID: string
      // 所属账户 ID
      accountID: string
      // 用户角色
      role: (typeof UserRole)[number]
    }
  }

  /**
   * System Actor 接口
   *
   * 表示系统级别的执行者。
   * 用于系统内部操作，不受用户权限限制。
   */
  interface System {
    // Actor 类型标识
    type: "system"
    // 系统属性
    properties: {
      // 操作的工作区 ID
      workspaceID: string
    }
  }

  /**
   * Actor 类型联合
   *
   * 所有可能的 Actor 类型。
   */
  export type Info = Account | Public | User | System

  // 创建 Actor 上下文存储
  const ctx = Context.create<Info>()

  /**
   * 获取当前 Actor
   *
   * 从上下文中获取当前的执行者信息。
   * 如果没有设置 Actor，会抛出 NotFound 错误。
   *
   * @returns 当前 Actor 信息
   * @throws {Context.NotFound} 如果 Actor 未设置
   *
   * @example
   * ```typescript
   * const actor = Actor.use()
   * console.log(actor.type) // "user" | "account" | "public" | "system"
   * ```
   */
  export const use = ctx.use

  // 创建 Actor 专用日志记录器
  // 用于记录 Actor 相关的操作
  const log = Log.create().tag("namespace", "actor")

  /**
   * 设置 Actor 上下文并执行函数
   *
   * 在指定的 Actor 上下文中执行函数。
   * 同时设置日志上下文，记录 Actor 属性。
   *
   * @template R - 返回值类型
   * @template T - Actor 类型
   * @param type - Actor 类型
   * @param properties - Actor 属性（根据类型不同而不同）
   * @param cb - 要执行的函数
   * @returns 函数的返回值
   *
   * @example
   * ```typescript
   * // 设置账户 Actor
   * await Actor.provide("account", { accountID: "acc_123", email: "user@example.com" }, async () => {
   *   // 在这个上下文中执行操作
   * })
   *
   * // 设置用户 Actor
   * await Actor.provide("user", { userID: "usr_123", workspaceID: "wrk_123", accountID: "acc_123", role: "admin" }, async () => {
   *   // 在这个上下文中执行操作
   * })
   * ```
   */
  export function provide<R, T extends Info["type"]>(
    type: T,
    properties: Extract<Info, { type: T }>["properties"],
    cb: () => R,
  ) {
    return ctx.provide(
      // 构建 Actor 对象
      {
        type,
        properties,
      } as any,
      // 包装执行函数
      () => {
        // 同时设置日志上下文，将 Actor 属性添加到日志中
        return Log.provide({ ...properties }, () => {
          // 记录 Actor 提供事件
          log.info("provided")
          // 执行回调函数
          return cb()
        })
      },
    )
  }

  /**
   * 断言 Actor 类型
   *
   * 验证当前 Actor 是否为指定类型。
   * 如果类型不匹配，抛出错误。
   *
   * @template T - 期望的 Actor 类型
   * @param type - 期望的 Actor 类型
   * @returns 当前 Actor（类型被窄化到指定类型）
   * @throws 如果 Actor 类型不匹配
   *
   * @example
   * ```typescript
   * // 断言当前是用户 Actor
   * const user = Actor.assert("user")
   * // user 的类型被推断为 User
   * console.log(user.properties.userID)
   * ```
   */
  export function assert<T extends Info["type"]>(type: T) {
    // 获取当前 Actor
    const actor = use()

    // 检查类型是否匹配
    if (actor.type !== type) {
      throw new Error(`Expected actor type ${type}, got ${actor.type}`)
    }

    // 类型断言，返回窄化后的 Actor
    return actor as Extract<Info, { type: T }>
  }

  /**
   * 断言管理员权限
   *
   * 验证当前用户是否为管理员。
   * 如果不是管理员，抛出错误。
   *
   * @throws 如果当前用户不是管理员
   *
   * @example
   * ```typescript
   * // 只允许管理员执行的操作
   * Actor.assertAdmin()
   * await doSomethingRestricted()
   * ```
   */
  export const assertAdmin = () => {
    // 获取用户角色
    if (userRole() === "admin") return

    // 不是管理员，抛出友好的错误信息
    throw new Error(`Action not allowed. Ask your workspace admin to perform this action.`)
  }

  /**
   * 获取工作区 ID
   *
   * 从当前 Actor 中获取工作区 ID。
   * 只有 User 和 System Actor 有工作区 ID。
   *
   * @returns 工作区 ID
   * @throws 如果 Actor 类型没有工作区 ID
   *
   * @example
   * ```typescript
   * const workspaceID = Actor.workspace()
   * ```
   */
  export function workspace() {
    // 获取当前 Actor
    const actor = use()

    // 检查是否有 workspaceID 属性
    if ("workspaceID" in actor.properties) {
      return actor.properties.workspaceID
    }

    // Actor 类型没有工作区 ID
    throw new Error(`actor of type "${actor.type}" is not associated with a workspace`)
  }

  /**
   * 获取账户 ID
   *
   * 从当前 Actor 中获取账户 ID。
   * 只有 Account 和 User Actor 有账户 ID。
   *
   * @returns 账户 ID
   * @throws 如果 Actor 类型没有账户 ID
   *
   * @example
   * ```typescript
   * const accountID = Actor.account()
   * ```
   */
  export function account() {
    // 获取当前 Actor
    const actor = use()

    // 检查是否有 accountID 属性
    if ("accountID" in actor.properties) {
      return actor.properties.accountID
    }

    // Actor 类型没有账户 ID
    throw new Error(`actor of type "${actor.type}" is not associated with an account`)
  }

  /**
   * 获取用户 ID
   *
   * 获取当前 User Actor 的用户 ID。
   * 会断言当前 Actor 必须是 User 类型。
   *
   * @returns 用户 ID
   * @throws 如果当前 Actor 不是 User 类型
   *
   * @example
   * ```typescript
   * const userID = Actor.userID()
   * ```
   */
  export function userID() {
    // 断言是 User 类型并返回 userID
    return Actor.assert("user").properties.userID
  }

  /**
   * 获取用户角色
   *
   * 获取当前 User Actor 的角色。
   * 会断言当前 Actor 必须是 User 类型。
   *
   * @returns 用户角色
   * @throws 如果当前 Actor 不是 User 类型
   *
   * @example
   * ```typescript
   * const role = Actor.userRole()
   * if (role === "admin") {
   *   // 执行管理员操作
   * }
   * ```
   */
  export function userRole() {
    // 断言是 User 类型并返回 role
    return Actor.assert("user").properties.role
  }
}
