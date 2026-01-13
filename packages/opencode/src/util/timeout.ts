/**
 * ============================================================================
 * 文件名：timeout.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * Promise 超时工具模块。为 Promise 添加超时功能。
 *
 * 主要功能：
 * - 为 Promise 添加超时限制
 * - 超时后自动拒绝 Promise
 * - 原始 Promise 完成时取消超时
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - withTimeout(promise, ms)：添加超时的 Promise
 *
 * 使用场景：
 * - API 请求超时
 * - 文件操作超时
 * - 长时间运行的任务超时
 * - 防止资源泄漏
 *
 * 使用示例：
 * ```typescript
 * // 基本使用
 * const result = await withTimeout(
 *   fetch("https://api.example.com"),
 *   5000  // 5 秒超时
 * )
 *
 * // 处理超时错误
 * try {
 *   await withTimeout(slowOperation(), 1000)
 * } catch (error) {
 *   if (error.message.includes("timed out")) {
 *     console.log("操作超时")
 *   }
 * }
 *
 * // 与 async/await 配合
 * async function fetchWithTimeout(url: string) {
 *   return await withTimeout(fetch(url), 3000)
 * }
 *
 * // 用于任何 Promise
 * const timeoutPromise = withTimeout(
 *   new Promise((resolve) => {
 *     setTimeout(() => resolve("done"), 10000)
 *   }),
 *   1000
 * )
 * // 1 秒后超时，抛出错误
 * ```
 *
 * 实现细节：
 * - 使用 Promise.race() 竞争原始 Promise 和超时 Promise
 * - 原始 Promise 完成时清除超时
 * - 超时 Promise 不会被清除（但原始 Promise 继续执行）
 *
 * 注意事项：
 * - 超时不会取消原始操作（只是忽略结果）
 * - 超时后原始 Promise 可能仍在后台执行
 * - 如果需要取消操作，需要使用 AbortController
 *
 * @package opencode
 * @module util/timeout
 */

/**
 * 为 Promise 添加超时限制
 *
 * 创建一个新 Promise，如果原始 Promise 在指定时间内未完成，
 * 则拒绝并返回超时错误。
 *
 * @param promise - 要添加超时的 Promise
 * @param ms - 超时时间（毫秒）
 * @returns 带超时的 Promise
 *
 * @template T - Promise 返回值类型
 *
 * @throws {Error} 超时时抛出错误，消息包含超时时间
 *
 * 实现原理：
 * 1. 使用 Promise.race() 竞争原始 Promise 和超时 Promise
 * 2. 先完成的决定结果
 * 3. 如果原始 Promise 先完成，清除超时定时器
 * 4. 如果超时 Promise 先完成，拒绝并返回错误
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // 超时定时器引用
  let timeout: NodeJS.Timeout

  // 使用 Promise.race 竞争两个 Promise
  return Promise.race([
    // 原始 Promise：完成后清除超时
    promise.then((result) => {
      // 清除超时定时器（防止内存泄漏）
      clearTimeout(timeout)
      // 返回原始结果
      return result
    }),

    // 超时 Promise：指定时间后拒绝
    new Promise<never>((_, reject) => {
      // 创建超时定时器
      timeout = setTimeout(() => {
        // 拒绝并返回超时错误
        reject(new Error(`Operation timed out after ${ms}ms`))
      }, ms)
    }),
  ])
}
