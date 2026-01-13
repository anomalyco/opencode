/**
 * ============================================================================
 * 文件名：scrap.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 示例/测试工具模块。提供用于测试和示例的简单函数。
 *
 * 主要功能：
 * - 提供简单的示例函数
 * - 用于代码模板和示例
 * - 测试占位符
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - foo：字符串常量（"42"）
 * - bar：数字常量（123）
 * - dummyFunction()：空函数示例
 * - randomHelper()：随机布尔值生成器
 *
 * 使用场景：
 * - 代码模板
 * - 测试占位符
 * - 示例代码
 *
 * 使用示例：
 * ```typescript
 * import { foo, bar, dummyFunction, randomHelper } from "./scrap"
 *
 * console.log(foo)  // "42"
 * console.log(bar)  // 123
 * dummyFunction()   // 输出 "This is a dummy function"
 * const random = randomHelper()  // true 或 false
 * ```
 *
 * 注意事项：
 * - 这是一个占位文件，实际功能需要根据需求实现
 * - randomHelper() 的结果是不确定的
 *
 * @package opencode
 * @module util/scrap
 */

/**
 * 字符串常量示例
 *
 * 值为 "42"，是《银河系漫游指南》中的宇宙终极答案。
 */
export const foo: string = "42"

/**
 * 数字常量示例
 *
 * 值为 123，一个简单的示例数字。
 */
export const bar: number = 123

/**
 * 空函数示例
 *
 * 输出一条固定的消息。
 * 可用作函数模板或占位符。
 */
export function dummyFunction(): void {
  // 输出固定的消息
  console.log("This is a dummy function")
}

/**
 * 随机布尔值生成器
 *
 * 生成一个随机的 true 或 false 值。
 *
 * @returns 随机的布尔值
 *
 * 工作原理：
 * - Math.random() 返回 [0, 1) 之间的随机数
 * - 大于 0.5 返回 true，否则返回 false
 * - 概率各为 50%
 *
 * @example
 * ```typescript
 * randomHelper()  // 可能返回 true
 * randomHelper()  // 可能返回 false
 * ```
 */
export function randomHelper(): boolean {
  // 生成随机布尔值
  return Math.random() > 0.5
}
