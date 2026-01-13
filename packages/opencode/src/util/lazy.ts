/**
 * ============================================================================
 * 文件名：lazy.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 延迟求值工具模块。提供一次性计算和缓存功能。
 *
 * 主要功能：
 * - 延迟执行初始化函数
 * - 缓存计算结果
 * - 支持重置缓存
 * - 线程安全的单次执行
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - lazy(fn)：创建延迟求值函数
 *
 * 使用场景：
 * - 昂贵的初始化操作
 * - 单例模式
 * - 条件性加载资源
 * - 循环依赖的解决
 *
 * 使用示例：
 * ```typescript
 * // 创建延迟求值
 * const getConfig = lazy(() => {
 *   console.log("加载配置...")
 *   return fs.readFileSync("config.json")
 * })
 *
 * // 第一次调用：执行函数
 * const config1 = getConfig()  // 输出: "加载配置..."
 *
 * // 第二次调用：返回缓存值
 * const config2 = getConfig()  // 无输出，返回相同值
 *
 * // 重置缓存
 * getConfig.reset()
 *
 * // 下次调用会重新执行
 * const config3 = getConfig()  // 输出: "加载配置..."
 *
 * // 实际应用：单例模式
 * const database = lazy(() => new Database())
 * function getDB() {
 *   return database()  // 只创建一次
 * }
 * ```
 *
 * 注意事项：
 * - 不是线程安全的（但在 Node.js 单线程模型中不是问题）
 * - reset() 会清除缓存，下次调用重新执行
 * - 如果初始化函数抛出错误，每次调用都会重新尝试
 *
 * @package opencode
 * @module util/lazy
 */

/**
 * 创建延迟求值函数
 *
 * 返回一个函数，首次调用时执行初始化并缓存结果，
 * 后续调用直接返回缓存值。
 *
 * @param fn - 要延迟执行的初始化函数
 * @returns 带缓存和 reset 功能的函数
 *
 * @template T - 返回值类型
 *
 * 返回的函数附加了 reset() 方法：
 * - reset(): 清除缓存，下次调用会重新执行 fn
 */
export function lazy<T>(fn: () => T) {
  // 缓存的值
  let value: T | undefined

  // 是否已加载
  let loaded = false

  /**
   * 延迟求值函数
   *
   * 首次调用时执行 fn 并缓存结果，
   * 后续调用直接返回缓存值。
   *
   * @returns 缓存的值或新计算的值
   */
  const result = (): T => {
    // 如果已加载，直接返回缓存值
    if (loaded) return value as T

    // 标记为已加载
    loaded = true

    // 执行初始化函数并缓存结果
    value = fn()
    return value as T
  }

  /**
   * 重置缓存
   *
   * 清除缓存的值，下次调用 result() 会重新执行 fn。
   * 用于需要重新计算的场景。
   */
  result.reset = () => {
    loaded = false
    value = undefined
  }

  return result
}
