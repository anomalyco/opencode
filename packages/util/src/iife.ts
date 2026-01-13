/**
 * ============================================================================
 * 文件名：iife.ts
 * 所属包：packages/util
 * ============================================================================
 *
 * 文件作用：
 * 提供 IIFE（Immediately Invoked Function Expression，立即调用函数表达式）工具函数。
 * 这是一个简单的工具函数，用于立即执行传入的函数并返回其结果。
 *
 * 主要功能：
 * - 立即执行：接收一个函数并立即执行它
 * - 结果返回：返回函数的执行结果
 * - 作用域隔离：为函数创建独立的作用域
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - iife：立即执行函数表达式的工具函数
 *
 * 使用场景：
 * - 创建临时作用域
 * - 执行初始化代码
 * - 变量隔离（避免污染外部作用域）
 * - 简化单次调用的语法
 *
 * @package util
 * @module iife
 */

/**
 * IIFE（立即调用函数表达式）工具函数
 *
 * 立即执行传入的函数并返回其结果。
 * IIFE 是 JavaScript 中常见的模式，用于创建独立的作用域。
 *
 * @template T - 函数的返回值类型
 * @param fn - 需要立即执行的函数
 * @returns 函数的执行结果
 *
 * 工作原理：
 * 1. 接收一个函数作为参数
 * 2. 立即调用这个函数（没有延迟）
 * 3. 返回函数的执行结果
 *
 * 使用场景：
 * - 创建临时作用域，避免变量泄漏到外部
 * - 执行一次性初始化代码
 * - 简化需要返回值的复杂表达式
 * - 在表达式中使用多条语句
 *
 * 与直接调用的区别：
 * - 直接调用：const result = (() => { ... })()
 * - 使用 iife：const result = iife(() => { ... })
 * - 两者功能相同，iife 提供了更清晰的语义
 *
 * @example
 * ```typescript
 * // 基本用法
 * const result = iife(() => {
 *   const temp = calculateSomething()
 *   return temp * 2
 * })
 *
 * // 用于创建临时作用域
 * const value = iife(() => {
 *   // 这些变量不会泄漏到外部作用域
 *   let sum = 0
 *   for (let i = 0; i < 10; i++) {
 *     sum += i
 *   }
 *   return sum
 * })
 * // sum 在这里不可访问，只有 value 可访问
 *
 * // 简化复杂初始化
 * const config = iife(() => {
 *   const base = getDefaultConfig()
 *   if (process.env.NODE_ENV === "production") {
 *     return { ...base, debug: false }
 *   }
 *   return { ...base, debug: true }
 * })
 * ```
 *
 * 注意事项：
 * - 函数是同步执行的，不支持异步函数
 * - 如果需要异步执行，应该使用 async/await 模式
 * - 此函数主要用于代码组织和作用域管理
 */
export function iife<T>(fn: () => T) {
  // 立即执行传入的函数并返回其结果
  // fn() 是函数调用，执行函数体中的代码
  // return 将函数的返回值返回给调用者
  return fn()
}
