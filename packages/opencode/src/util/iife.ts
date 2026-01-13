/**
 * ============================================================================
 * 文件名：iife.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * IIFE（立即调用函数表达式）工具模块。提供立即执行函数的简化语法。
 *
 * 主要功能：
 * - iife()：立即执行传入的函数并返回结果
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - iife(fn)：立即执行函数
 *
 * 使用场景：
 * - 创建临时的作用域
 * - 简化复杂的初始化逻辑
 * - 使用 let/const 的场景中需要立即计算值
 * - 避免声明临时变量
 *
 * 使用示例：
 * ```typescript
 * // 基本使用
 * const result = iife(() => {
 *   const temp = calculateSomething()
 *   return temp * 2
 * })
 *
 * // 用于 const 初始化
 * const config = iife(() => {
 *   if (process.env.NODE_ENV === "production") {
 *     return prodConfig
 *   }
 *   return devConfig
 * })
 *
 * // 创建临时作用域
 * const value = iife(() => {
 *   const x = 10
 *   const y = 20
 *   const result = x + y
 *   // 这些变量不会泄漏到外部作用域
 *   return result
 * })
 *
 * // 避免声明临时变量
 * const isValid = iife(() => {
 *   const trimmed = input.trim()
 *   const normalized = trimmed.toLowerCase()
 *   return normalized.length > 0
 * })
 * ```
 *
 * 与立即执行函数的对比：
 * ```typescript
 * // 传统方式
 * const result = (() => {
 *   const temp = calculate()
 *   return temp * 2
 * })()
 *
 * // 使用 iife
 * const result = iife(() => {
 *   const temp = calculate()
 *   return temp * 2
 * })
 * ```
 *
 * 注意事项：
 * - 这是纯语法糖，运行时无额外开销
 * - 函数会被立即执行，不是延迟执行
 * - 类型推断完全保留
 *
 * @package opencode
 * @module util/iife
 */

/**
 * 立即调用函数表达式
 *
 * 执行传入的函数并返回其结果。
 *
 * @param fn - 要执行的函数
 * @returns 函数的返回值
 *
 * @template T - 函数的返回值类型
 *
 * 工作原理：
 * 1. 接收一个函数作为参数
 * 2. 立即调用该函数
 * 3. 返回函数的结果
 *
 * 类型推断：
 * - TypeScript 会自动推断返回值类型
 * - 不需要手动指定泛型参数
 *
 * @example
 * ```typescript
 * // 简单计算
 * const doubled = iife(() => 10 * 2)  // 20
 *
 * // 复杂初始化
 * const config = iife(() => {
 *   const env = process.env.NODE_ENV
 *   if (env === "production") {
 *     return { debug: false, apiUrl: "https://api.example.com" }
 *   }
 *   return { debug: true, apiUrl: "http://localhost:3000" }
 * })
 *
 * // 临时变量隔离
 * const result = iife(() => {
 *   const data = fetchData()
 *   const processed = process(data)
 *   const validated = validate(processed)
 *   return validated
 * })
 * ```
 */
export function iife<T>(fn: () => T) {
  // 立即执行函数并返回结果
  return fn()
}
