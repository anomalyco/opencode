/**
 * ============================================================================
 * 文件名：context.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * 异步上下文管理模块。提供跨调用栈传递数据的机制。
 *
 * 主要功能：
 * - 创建类型安全的异步上下文
 * - 在异步调用链中传递数据
 * - 提供上下文的获取和设置接口
 *
 * 依赖关系：
 * - node:async_hooks：Node.js 异步钩子 API
 *
 * 导出内容：
 * - Context.create：创建上下文对象
 * - Context.NotFound：上下文未找到错误类
 *
 * 使用场景：
 * - 传递用户认证信息
 * - 传递请求 ID 等元数据
 * - 实现异步本地存储
 *
 * @package console.core
 * @module context
 */

// 导入 Node.js 的异步本地存储
// AsyncLocalStorage 允许在异步调用链中存储和获取数据
// 每个异步调用链都有独立的存储，不会相互干扰
import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Context 命名空间
 *
 * 提供异步上下文管理功能。
 */
export namespace Context {
  /**
   * NotFound 错误类
   *
   * 当尝试获取不存在的上下文时抛出。
   */
  export class NotFound extends Error {}

  /**
   * 创建上下文对象
   *
   * 创建一个类型安全的异步上下文存储。
   *
   * @template T - 上下文存储的数据类型
   * @returns 上下文对象，包含 use 和 provide 方法
   *
   * @example
   * ```typescript
   * // 创建上下文
   * const ctx = Context.create<{ userID: string }>()
   *
   * // 设置上下文
   * ctx.provide({ userID: "123" }, () => {
   *   // 在这个回调中可以获取上下文
   *   const user = ctx.use() // { userID: "123" }
   * })
   *
   * // 在没有设置的地方获取会抛出 NotFound
   * ctx.use() // throws NotFound
   * ```
   */
  export function create<T>() {
    // 创建 AsyncLocalStorage 实例
    // 这是一个异步本地存储，可以在整个异步调用链中保持数据
    const storage = new AsyncLocalStorage<T>()

    // 返回上下文操作对象
    return {
      /**
       * 获取当前上下文
       *
       * 获取当前异步调用链中的上下文数据。
       * 如果没有设置上下文，抛出 NotFound 错误。
       *
       * @returns 当前上下文数据
       * @throws {NotFound} 如果上下文不存在
       */
      use() {
        // 获取当前存储的值
        const result = storage.getStore()

        // 如果没有值，抛出错误
        if (!result) {
          throw new NotFound()
        }

        // 返回上下文数据
        return result
      },

      /**
       * 设置上下文并执行函数
       *
       * 在指定的上下文中执行函数，函数内的所有异步调用都可以访问这个上下文。
       *
       * @param value - 要设置的上下文数据
       * @param fn - 要执行的函数
       * @returns 函数的返回值
       *
       * @example
       * ```typescript
       * ctx.provide({ userID: "123" }, async () => {
       *   // 这里可以访问上下文
       *   console.log(ctx.use().userID) // "123"
       *   await someAsyncFunction()
       *   // 即使在异步函数中，上下文仍然可用
       * })
       * ```
       */
      provide<R>(value: T, fn: () => R) {
        // 使用 AsyncLocalStorage 的 run 方法
        // 在这个上下文中运行函数
        return storage.run(value, fn)
      },
    }
  }
}
