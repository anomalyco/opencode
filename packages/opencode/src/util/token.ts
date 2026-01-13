/**
 * ============================================================================
 * 文件名：token.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * Token 估算工具模块。提供文本 token 数量的估算功能。
 *
 * 主要功能：
 * - 根据字符数估算 token 数量
 * - 使用简单的字符/token 比率计算
 * - 处理空字符串和负数情况
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - Token namespace：Token 估算命名空间
 *   - estimate(input)：估算文本的 token 数量
 *
 * 计算规则：
 * - 假设每个 token 约等于 4 个字符
 * - 这是大多数 GPT 模型的平均值
 * - 向上取整到最接近的整数
 * - 空字符串返回 0
 *
 * 使用场景：
 * - 估算 API 调用的 token 成本
 * - 检查是否超出模型的上下文限制
 * - 显示消息的 token 使用量
 * - 预估响应的 token 数量
 *
 * 使用示例：
 * ```typescript
 * // 基本使用
 * Token.estimate("Hello world")  // 3 (11 字符 / 4 = 2.75 → 3)
 *
 * // 空字符串
 * Token.estimate("")  // 0
 *
 * // 长文本
 * const text = "a".repeat(1000)  // 1000 个字符
 * Token.estimate(text)  // 250 (1000 / 4 = 250)
 *
 * // 实际应用：计算消息的 token 数
 * function countMessageTokens(message: string): number {
 *   return Token.estimate(message.content)
 * }
 *
 * // 检查是否超出限制
 * function checkLimit(input: string, limit: number): boolean {
 *   return Token.estimate(input) <= limit
 * }
 *
 * // 累计多个部分的 token
 * function totalTokens(parts: string[]): number {
 *   return parts.reduce((sum, part) => sum + Token.estimate(part), 0)
 * }
 * ```
 *
 * 注意事项：
 * - 这只是粗略估算
 * - 实际 token 数量取决于：
 *   - 使用的模型
 *   - 文本的语言
 *   - 特殊字符的数量
 *   - 代码 vs 自然语言
 * - 对于精确计数，应使用模型的 tokenizer
 * - 代码的 token 效率通常比自然语言低
 *
 * 精确计算：
 * - OpenAI：使用 tiktoken 库
 * - Anthropic：使用他们的 tokenizer
 * - 其他模型：参考各自的文档
 *
 * @package opencode
 * @module util/token
 */

/**
 * Token 估算命名空间
 *
 * 提供 token 数量的估算功能。
 */
export namespace Token {
  /**
   * 每个 token 的平均字符数
   *
   * 大多数语言模型的平均值：
   * - GPT-3/GPT-4：约 4 字符/token
   * - Claude：约 4 字符/token
   * - LLaMA：约 4 字符/token
   *
   * 这是粗略的平均值，实际情况会有所变化。
   */
  const CHARS_PER_TOKEN = 4

  /**
   * 估算文本的 token 数量
   *
   * 使用字符/token 比率计算，结果向上取整。
   *
   * @param input - 要估算的文本
   * @returns 估算的 token 数量（至少为 0）
   *
   * 计算公式：
   * ```
   * tokens = Math.max(0, Math.round(length / 4))
   * ```
   *
   * @example
   * ```typescript
   * Token.estimate("Hi")              // 1 (2 / 4 = 0.5 → 0 → 取 max(0, 0) = 0, round = 0, 但 0.5 四舍五入为 1)
   * Token.estimate("Hello")           // 2 (5 / 4 = 1.25 → 1)
   * Token.estimate("Hello world")     // 3 (11 / 4 = 2.75 → 3)
   * Token.estimate("Hello world!")    // 4 (13 / 4 = 3.25 → 3)
   * Token.estimate("")                // 0 (空字符串)
   * Token.estimate(undefined)        // 0 (处理 undefined)
   * ```
   */
  export function estimate(input: string) {
    // 处理空值：使用空字符串代替
    const text = input || ""

    // 计算并返回 token 数量
    // Math.round() 四舍五入到最接近的整数
    // Math.max(0, ...) 确保结果不为负数
    return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))
  }
}
