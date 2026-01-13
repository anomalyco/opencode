/**
 * ============================================================================
 * 文件名：lazy.ts
 * 所属包：packages/util
 * ============================================================================
 *
 * 文件作用：
 * 提供懒加载（Lazy Evaluation）工具函数。
 * 懒加载是一种延迟计算模式，只在第一次需要值时才执行计算，
 * 之后缓存结果供后续使用。这可以避免不必要的计算开销。
 *
 * 主要功能：
 * - 延迟执行：只在第一次调用时执行计算函数
 * - 结果缓存：后续调用直接返回缓存的结果
 * - 性能优化：避免重复执行昂贵的计算
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - lazy：创建懒加载值的函数
 *
 * 使用场景：
 * - 初始化开销大的对象
 * - 条件性初始化（可能不需要的值）
 * - 单例模式实现
 * - 循环依赖解决
 *
 * @package util
 * @module lazy
 */

/**
 * 懒加载工具函数
 *
 * 创建一个懒加载的值，只在第一次访问时执行计算，
 * 后续访问直接返回缓存的结果。
 *
 * @template T - 值的类型
 * @param fn - 用于计算值的函数，只在第一次调用时执行
 * @returns 一个获取值的函数，第一次调用执行计算，后续返回缓存
 *
 * 工作原理：
 * 1. 创建闭包，存储计算结果和加载状态
 * 2. 返回一个 getter 函数
 * 3. 首次调用 getter 时：
 *    a. 执行计算函数 fn
 *    b. 缓存计算结果
 *    c. 标记已加载
 *    d. 返回计算结果
 * 4. 后续调用 getter 时：
 *    a. 直接返回缓存的结果
 *    b. 不再执行计算函数
 *
 * 性能优势：
 * - 避免不必要的计算（如果值从未被使用）
 * - 只计算一次（后续使用直接返回缓存）
 * - 适合初始化开销大的对象
 *
 * 使用场景：
 * - 初始化大型数据结构
 * - 创建可能不需要的昂贵对象
 * - 实现单例模式
 * - 解决模块循环依赖
 *
 * @example
 * ```typescript
 * // 创建懒加载的配置对象
 * const getConfig = lazy(() => {
 *   // 这个初始化只在第一次访问时执行
 *   console.log("Loading config...")
 *   return loadConfigFromFile()
 * })
 *
 * // 第一次调用：执行计算
 * const config1 = getConfig()  // 输出: "Loading config..."
 *
 * // 第二次调用：返回缓存，不执行计算
 * const config2 = getConfig()  // 无输出
 *
 * // config1 和 config2 是同一个对象
 * console.log(config1 === config2)  // 输出: true
 *
 * // 使用场景：条件性初始化
 * const expensiveObject = lazy(() => new ExpensiveClass())
 *
 * function process(data) {
 *   if (data.needsExpensiveProcessing) {
 *     // 只在需要时才创建 ExpensiveClass 实例
 *     const obj = expensiveObject()
 *     obj.process(data)
 *   }
 *   // 如果不需要昂贵处理，ExpensiveClass 永远不会被创建
 * }
 * ```
 *
 * 注意事项：
 * - 计算函数只执行一次，即使返回 undefined
 * - 如果计算可能抛出异常，异常不会被缓存，再次调用会重试
 * - 不适合需要重新计算的场景（考虑使用其他模式）
 * - 闭包会持有对计算结果的引用，注意内存管理
 */
export function lazy<T>(fn: () => T) {
  // 存储计算结果的变量
  // 使用泛型 T，可以存储任何类型的值
  // 初始值为 undefined，表示尚未计算
  let value: T | undefined

  // 加载状态标志
  // false 表示尚未执行计算
  // true 表示已经计算并缓存了结果
  let loaded = false

  // 返回一个 getter 函数
  // 这个函数负责在首次调用时执行计算，
  // 后续调用直接返回缓存的结果
  return (): T => {
    // 检查是否已经加载过
    if (loaded) {
      // 已经加载过，直接返回缓存的结果
      // 使用类型断言 "as T"，因为我们知道 value 已经被设置
      return value as T
    }

    // 首次调用，标记为已加载
    // 必须在执行计算前设置，避免计算过程中递归调用导致问题
    loaded = true

    // 执行计算函数并缓存结果
    // fn() 是传入的计算函数，执行它获得结果
    value = fn()

    // 返回计算结果
    // 第一次返回时 value 一定有值（因为 fn 返回 T 类型）
    return value as T
  }
}
