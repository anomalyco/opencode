/**
 * ============================================================================
 * 文件名：context.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 异步上下文管理模块。基于 Node.js AsyncLocalStorage 实现请求作用域的上下文存储。
 *
 * 主要功能：
 * - 创建命名上下文存储
 * - 提供上下文值的设置和获取
 * - 支持异步调用链中的上下文传递
 * - 类型安全的上下文访问
 *
 * 依赖关系：
 * - async_hooks：Node.js 异步钩子 API
 *
 * 导出内容：
 * - Context namespace：上下文管理命名空间
 *   - NotFound：上下文未找到错误类
 *   - create(name)：创建新的上下文存储
 *
 * 使用场景：
 * - 请求作用域的配置和状态
 * - 分布式追踪的 trace ID 传递
 * - 用户会话信息在异步调用链中传递
 * - 日志标签自动附加
 *
 * 使用示例：
 * ```typescript
 * // 创建上下文
 * const UserContext = Context.create<{ id: string; name: string }>("user")
 *
 * // 在请求处理中设置上下文
 * async function handleRequest(userId: string) {
 *   const user = await fetchUser(userId)
 *
 *   // 在整个异步调用链中提供上下文
 *   return UserContext.provide(user, () => {
 *     return processRequest()
 *   })
 * }
 *
 * // 在深层函数中访问上下文
 * async function processRequest() {
 *   // 获取当前上下文
 *   const user = UserContext.use()
 *   console.log(`Processing for ${user.name}`)
 *
 *   // 即使经过多次异步调用，上下文仍然可用
 *   await nestedFunction()
 * }
 *
 * async function nestedFunction() {
 *   const user = UserContext.use()
 *   console.log(`Nested: ${user.id}`)
 * }
 *
 * // 上下文不存在时抛出 NotFound 错误
 * try {
 *   UserContext.use()
 * } catch (e) {
 *   if (e instanceof Context.NotFound) {
 *     console.error("用户上下文未设置")
 *   }
 * }
 * ```
 *
 * 工作原理：
 * - 使用 Node.js 的 AsyncLocalStorage 实现
 * - 上下文在异步调用链中自动传递
 * - 每个异步操作都有独立的存储副本
 * - provide() 创建新的作用域
 * - use() 从当前作用域读取值
 *
 * @package opencode
 * @module util/context
 */

// 导入 Node.js 异步本地存储
// 用于在异步调用链中传递上下文
import { AsyncLocalStorage } from "async_hooks"

/**
 * 上下文管理命名空间
 *
 * 提供创建和使用异步本地上下文的工具函数。
 */
export namespace Context {
  /**
   * 上下文未找到错误
   *
   * 当尝试访问未设置的上下文时抛出。
   */
  export class NotFound extends Error {
    /**
     * 创建上下文未找到错误
     * @param name - 上下文名称
     */
    constructor(public override readonly name: string) {
      // 错误消息包含上下文名称
      super(`No context found for ${name}`)
    }
  }

  /**
   * 创建命名的上下文存储
   *
   * 创建一个新的上下文存储实例，提供 use() 和 provide() 方法。
   *
   * @param name - 上下文名称，用于错误消息
   * @returns 上下文对象，包含 use() 和 provide() 方法
   *
   * @template T - 上下文值的类型
   */
  export function create<T>(name: string) {
    // 创建 AsyncLocalStorage 实例
    // 这是 Node.js 提供的异步本地存储 API
    const storage = new AsyncLocalStorage<T>()

    return {
      /**
       * 获取当前上下文值
       *
       * 从当前异步作用域中读取上下文值。
       * 如果上下文未设置，抛出 NotFound 错误。
       *
       * @returns 当前上下文值
       * @throws {NotFound} 如果上下文未设置
       */
      use() {
        // 从 AsyncLocalStorage 获取当前存储值
        const result = storage.getStore()

        // 如果值不存在，抛出 NotFound 错误
        if (!result) {
          throw new NotFound(name)
        }

        return result
      },

      /**
       * 在上下文中运行函数
   *
       * 设置上下文值并执行函数，函数返回后清理上下文。
       * 在函数执行期间（包括所有异步调用），上下文值可用。
       *
       * @param value - 要设置的上下文值
       * @param fn - 在上下文中执行的函数
       * @returns 函数的返回值
       *
       * @template R - 函数返回值类型
       */
      provide<R>(value: T, fn: () => R) {
        // AsyncLocalStorage.run() 创建新的存储实例
        // value 在此异步调用链及其所有子调用中可用
        return storage.run(value, fn)
      },
    }
  }
}
