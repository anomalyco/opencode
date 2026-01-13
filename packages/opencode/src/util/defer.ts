/**
 * ============================================================================
 * 文件名：defer.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 延迟执行工具模块。提供 using 声明支持的延迟清理功能。
 *
 * 主要功能：
 * - 创建延迟执行清理函数的对象
 * - 支持 Symbol.dispose（同步 using）
 * - 支持 Symbol.asyncDispose（异步 await using）
 * - 自动类型推断返回的 dispose 方法
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - defer(fn)：创建延迟执行对象
 *
 * 使用场景：
 * - 资源清理（文件、连接、锁等）
 * - using/await using 声明的资源管理
 * - 确保代码块结束时执行清理
 *
 * 使用示例：
 * ```typescript
 * // 同步清理
 * {
 *   using cleanup = defer(() => {
 *     console.log("清理资源")
 *   })
 *   // ... 执行操作
 * }  // 自动调用 cleanup[Symbol.dispose]()
 *
 * // 异步清理
 * {
 *   await using cleanup = defer(async () => {
 *     await fs.unlink(tempFile)
 *   })
 *   // ... 执行操作
 * }  // 自动调用 cleanup[Symbol.asyncDispose]()
 *
 * // 手动调用（不推荐，应使用 using）
 * const d = defer(() => console.log("done"))
 * d[Symbol.dispose]()  // 手动清理
 * ```
 *
 * @package opencode
 * @module util/defer
 */

/**
 * 创建延迟执行对象
 *
 * 返回一个支持 using/await using 声明的对象。
 * 对象离开作用域时会自动调用传入的函数。
 *
 * @param fn - 要延迟执行的清理函数
 * @returns 支持 Symbol.dispose 和 Symbol.asyncDispose 的对象
 *
 * 类型说明：
 * - 如果 fn 返回 Promise，返回 Symbol.asyncDispose
 * - 如果 fn 返回 void，返回 Symbol.dispose
 *
 * @template T - 函数类型，推断返回类型
 */
export function defer<T extends () => void | Promise<void>>(
  fn: T,
): T extends () => Promise<void>
  ? { [Symbol.asyncDispose]: () => Promise<void> }
  : { [Symbol.dispose]: () => void } {
  // 返回同时支持同步和异步 dispose 的对象
  // TypeScript 会根据 fn 的返回类型自动选择正确的 dispose 方法
  return {
    /**
     * 同步 dispose 方法
     * 用于 using 声明
     */
    [Symbol.dispose]() {
      fn()
    },

    /**
     * 异步 dispose 方法
     * 用于 await using 声明
     * 将同步函数包装为 Promise
     */
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn())
    },
  } as any  // 使用 as any 因为我 TypeScript 会根据 T 选择正确的类型
}
