/**
 * ============================================================================
 * 文件名：wildcard.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 通配符匹配模块。提供 shell 风格的通配符模式匹配功能。
 *
 * 主要功能：
 * - 支持 *（匹配任意字符）
 * - 支持 ?（匹配单个字符）
 * - 支持 " *" 结尾模式（使尾部可选）
 * - all()：返回第一个匹配的值
 * - allStructured()：结构化命令匹配
 *
 * 依赖关系：
 * - remeda：函数式工具库（sortBy, pipe）
 *
 * 导出内容：
 * - Wildcard namespace：通配符匹配命名空间
 *   - match(str, pattern)：测试字符串是否匹配模式
 *   - all(input, patterns)：返回第一个匹配的值
 *   - allStructured(input, patterns)：结构化匹配
 *
 * 通配符语法：
 * - *：匹配任意字符序列
 * - ?：匹配单个字符
 * - " *"（空格+星号）：使尾部部分可选
 *
 * 使用场景：
 * - 命令行参数匹配
 * - 文件路径过滤
 * - 命令模式识别
 * - 权限规则匹配
 *
 * 使用示例：
 * ```typescript
 * // 基本匹配
 * Wildcard.match("hello", "he*")       // true
 * Wildcard.match("hello", "h?llo")      // true
 * Wildcard.match("hello", "he??o")     // true
 * Wildcard.match("hello", "world")     // false
 *
 * // 可选尾部
 * Wildcard.match("ls", "ls *")         // true（尾部可选）
 * Wildcard.match("ls -la", "ls *")     // true
 *
 * // all()：返回第一个匹配的值
 * const patterns = {
 *   "git *": "git command",
 *   "git push": "git push specific",
 * }
 * Wildcard.all("git push", patterns)    // "git command"
 * // 按长度排序，更具体的模式先匹配
 *
 * // allStructured()：结构化命令匹配
 * const patterns = {
 *   "ls *": "list files",
 *   "ls -la": "list all files",
 * }
 * Wildcard.allStructured(
 *   { head: "ls", tail: ["-la"] },
 *   patterns
 * )  // "list all files"
 * ```
 *
 * 匹配优先级：
 * 1. 按模式长度排序（短的优先）
 * 2. 按字母顺序排序
 * 3. 返回第一个匹配的值
 *
 * @package opencode
 * @module util/wildcard
 */

// 导入 remeda 函数式工具库
import { sortBy, pipe } from "remeda"

/**
 * 通配符匹配命名空间
 *
 * 提供通配符模式匹配功能。
 */
export namespace Wildcard {
  /**
   * 测试字符串是否匹配通配符模式
   *
   * 将通配符模式转换为正则表达式并测试匹配。
   *
   * @param str - 要测试的字符串
   * @param pattern - 通配符模式
   * @returns 是否匹配
   *
   * 转换规则：
   * - * → .*（匹配任意字符序列）
   * - ? → .（匹配单个字符）
   * - 其他特殊正则字符被转义
   * - " *" 结尾 → ( .*)?（使尾部可选）
   *
   * 注意：使用 's' 标志，使 . 匹配包括换行符的任意字符
   */
  export function match(str: string, pattern: string) {
    // 转义特殊正则字符
    let escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")  // 转义特殊字符
      .replace(/\*/g, ".*")                   // * 变成 .*（任意字符）
      .replace(/\?/g, ".")                    // ? 变成 .（单个字符）

    /**
     * 特殊处理：" *" 结尾
     *
     * 如果模式以 " *"（空格 + 通配符）结尾，
     * 使尾部部分变为可选。
     *
     * 例如："ls *" 可以匹配 "ls" 和 "ls -la"
     */
    if (escaped.endsWith(" .*")) {
      // 移除 " .*" 并添加 "( .*)?"（可选的空格 + 任意字符）
      escaped = escaped.slice(0, -3) + "( .*)?"
    }

    // 创建正则表达式并测试
    // ^...$ 确保整个字符串匹配
    // 's' 标志使 . 匹配包括换行符的任意字符
    return new RegExp("^" + escaped + "$", "s").test(str)
  }

  /**
   * 返回第一个匹配模式的值
   *
   * 按特定顺序遍历模式，返回第一个匹配的值。
   *
   * @param input - 要匹配的输入字符串
   * @param patterns - 模式到值的映射对象
   * @returns 第一个匹配的值，如果没有匹配返回 undefined
   *
   * 排序规则：
   * 1. 按模式长度升序（短的模式优先）
   * 2. 按字母顺序升序
   *
   * 这确保更具体的模式优先匹配。
   *
   * @example
   * ```typescript
   * const patterns = {
   *   "*": "default",
   *   "git *": "git command",
   *   "git push": "git push specific",
   * }
   *
   * Wildcard.all("git push", patterns)
   * // 按长度排序："*"(1), "git *"(6), "git push"(8)
   * // "*" 先匹配，但 continue 继续查找更具体的匹配
   * // 最终返回 "git command"
   * ```
   */
  export function all(input: string, patterns: Record<string, any>) {
    // 排序模式：先按长度，再按字母
    const sorted = pipe(
      patterns,
      Object.entries,  // 转换为 [key, value] 数组
      sortBy(
        [([key]) => key.length, "asc"],  // 按长度升序
        [([key]) => key, "asc"],          // 按字母升序
      ),
    )

    // 查找第一个匹配的模式
    let result = undefined
    for (const [pattern, value] of sorted) {
      if (match(input, pattern)) {
        // 保存匹配结果
        result = value
        // 继续查找更具体的匹配（可能覆盖当前结果）
        continue
      }
    }

    return result
  }

  /**
   * 结构化命令匹配
   *
   * 匹配具有头部和尾部参数的命令结构。
   * 支持更复杂的模式匹配，包括参数顺序。
   *
   * @param input - 结构化输入 { head: 命令头部, tail: 参数数组 }
   * @param patterns - 模式到值的映射对象
   * @returns 第一个匹配的值，如果没有匹配返回 undefined
   *
   * 匹配规则：
   * - 模式按空格分割为多个部分
   * - 第一部分必须匹配 head
   * - 其余部分按顺序匹配 tail
   * - 支持通配符 *（匹配任意数量的参数）
   *
   * @example
   * ```typescript
   * const patterns = {
   *   "ls": "list current",
   *   "ls *": "list with args",
   *   "ls -la": "list all",
   * }
   *
   * Wildcard.allStructured(
   *   { head: "ls", tail: [] },
   *   patterns
   * )  // "list current"
   *
   * Wildcard.allStructured(
   *   { head: "ls", tail: ["-la"] },
   *   patterns
   * )  // "list all"
   * ```
   */
  export function allStructured(input: { head: string; tail: string[] }, patterns: Record<string, any>) {
    // 按长度和字母排序模式
    const sorted = pipe(
      patterns,
      Object.entries,
      sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]),
    )

    // 查找第一个匹配的模式
    let result = undefined
    for (const [pattern, value] of sorted) {
      // 按空格分割模式为多个部分
      const parts = pattern.split(/\s+/)

      // 第一部分必须匹配命令头部
      if (!match(input.head, parts[0])) continue

      /**
       * 检查参数是否匹配
       *
       * - 如果只有一个部分，立即匹配
       * - 否则检查 tail 是否匹配剩余模式
       */
      if (parts.length === 1 || matchSequence(input.tail, parts.slice(1))) {
        result = value
        continue
      }
    }

    return result
  }

  /**
   * 递归匹配参数序列
   *
   * 检查参数数组是否按顺序匹配模式数组。
   * 支持 * 通配符，可以匹配任意数量的参数。
   *
   * @param items - 参数数组
   * @param patterns - 模式数组
   * @returns 是否匹配
   *
   * 匹配逻辑：
   * - 如果没有更多模式，匹配成功
   * - 如果当前模式是 *，跳过（匹配任意数量）
   * - 否则，查找匹配当前模式的参数，然后递归匹配剩余
   *
   * @example
   * ```typescript
   * matchSequence(["-la", "/home"], ["-la", "*"])  // true
   * matchSequence(["-la"], ["-la", "*"])           // true
   * matchSequence(["-la"], ["-lb", "*"])           // false
   * ```
   */
  function matchSequence(items: string[], patterns: string[]): boolean {
    // 如果没有更多模式，匹配成功
    if (patterns.length === 0) return true

    // 取出第一个模式
    const [pattern, ...rest] = patterns

    /**
     * 处理 * 通配符
     *
     * * 可以匹配任意数量的参数（包括零个）。
     * 直接跳到下一个模式继续匹配。
     */
    if (pattern === "*") return matchSequence(items, rest)

    // 尝试每个参数作为当前模式的匹配
    for (let i = 0; i < items.length; i++) {
      // 如果当前参数匹配当前模式
      // 且剩余参数匹配剩余模式，则成功
      if (match(items[i], pattern) && matchSequence(items.slice(i + 1), rest)) {
        return true
      }
    }

    // 没有找到匹配
    return false
  }
}
