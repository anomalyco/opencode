/**
 * ============================================================================
 * 文件名：signal.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 信号同步工具模块。提供简单的手动触发信号机制，用于异步协调。
 *
 * 主要功能：
 * - 创建可手动触发的 Promise
 * - 支持多方等待同一事件
 * - 简单的发布-订阅模式
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - signal()：创建新的信号对象
 *
 * 使用场景：
 * - 等待异步事件完成
 * - 跨线程/进程的同步（配合 IPC）
 * - 测试中的事件模拟
 *
 * 使用示例：
 * ```typescript
 * const sig = signal()
 *
 * // 在一个地方等待
 * async function waiter() {
 *   await sig.wait()
 *   console.log("信号已触发")
 * }
 *
 * // 在另一个地方触发
 * async function triggerer() {
 *   setTimeout(() => {
 *     sig.trigger()
 *   }, 1000)
 * }
 *
 * // 可以多次等待
 * await Promise.all([sig.wait(), sig.wait()])
 * // 所有等待者都会在触发后完成
 * ```
 *
 * 注意事项：
 * - 信号只能触发一次
 * - 多次调用 trigger() 不会产生错误
 * - 可以多次调用 wait()，所有调用都会等待同一个触发
 *
 * @package opencode
 * @module util/signal
 */

/**
 * 创建信号对象
 *
 * 返回一个可手动触发和等待的 Promise 信号。
 * 类似于一个手动控制的 Promise。
 *
 * @returns 信号对象，包含 trigger() 和 wait() 方法
 *
 * 返回值说明：
 * - trigger()：触发信号，所有等待的 Promise 都会 resolve
 * - wait()：返回 Promise，在信号触发时 resolve
 */
export function signal() {
  // resolve 函数的引用
  // 在 Promise 构造函数中被赋值
  let resolve: any

  // 创建未完成的 Promise
  // 构造函数中保存 resolve 函数到外部变量
  const promise = new Promise((r) => (resolve = r))

  return {
    /**
     * 触发信号
     *
     * 调用后，所有通过 wait() 获取的 Promise 都会 resolve。
     * 可以多次调用（后续调用无效果）。
     */
    trigger() {
      return resolve()
    },

    /**
     * 等待信号
     *
     * 返回 Promise，在 trigger() 被调用时 resolve。
     * 可以多次调用，返回的 Promise 都等待同一个触发。
     *
     * @returns Promise，在信号触发时 resolve
     */
    wait() {
      return promise
    },
  }
}
