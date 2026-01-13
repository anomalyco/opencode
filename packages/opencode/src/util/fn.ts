/**
 * ============================================================================
 * 文件名：fn.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 函数封装工具模块。提供类型安全的函数封装功能，支持 Zod schema 验证。
 *
 * 主要功能：
 * - 创建带有 Zod schema 验证的函数
 * - 自动验证输入参数
 * - 支持 force 方法跳过验证
 * - 附加 schema 到函数对象
 *
 * 依赖关系：
 * - zod：运行时类型验证
 *
 * 导出内容：
 * - fn(schema, cb)：创建带验证的函数
 *
 * 使用示例：
 * ```typescript
 * const myFunc = fn(
 *   z.object({ name: z.string(), age: z.number() }),
 *   (input) => `Hello ${input.name}, you are ${input.age}`
 * )
 *
 * // 正常调用（带验证）
 * myFunc({ name: "Alice", age: 30 })  // OK
 * myFunc({ name: "Bob" })              // ZodError: age is required
 *
 * // 强制调用（跳过验证）
 * myFunc.force({ name: "Charlie" })    // OK (跳过验证)
 *
 * // 访问 schema
 * myFunc.schema  // 返回原始的 Zod schema
 * ```
 *
 * @package opencode
 * @module util/fn
 */

// 导入 Zod 类型验证库
import { z } from "zod"

/**
 * 创建带类型验证的函数
 *
 * 封装一个回调函数，在调用前自动使用 Zod schema 验证输入。
 * 返回的函数对象包含额外的属性和方法。
 *
 * @param schema - Zod schema，用于验证输入
 * @param cb - 处理验证后输入的回调函数
 * @returns 带验证的函数，包含 force 方法和 schema 属性
 *
 * 返回值类型：
 * - 函数本身：正常调用时执行验证
 * - .force()：跳过验证直接调用
 * - .schema：附加的原始 schema
 */
export function fn<T extends z.ZodType, Result>(
  schema: T,  // Zod 类型定义
  cb: (input: z.infer<T>) => Result  // 处理函数
) {
  /**
   * 带验证的函数实现
   *
   * 每次调用时：
   * 1. 使用 schema.parse() 验证输入
   * 2. 如果验证失败，抛出 ZodError
   * 3. 如果验证成功，调用原始回调
   */
  const result = (input: z.infer<T>) => {
    // 验证输入参数
    const parsed = schema.parse(input)
    // 调用原始回调处理验证后的数据
    return cb(parsed)
  }

  /**
   * 强制调用方法
   *
   * 跳过 Zod 验证，直接将输入传递给回调函数。
   * 用于在确信数据有效时提升性能。
   */
  result.force = (input: z.infer<T>) => cb(input)

  /**
   * 附加原始 schema
   *
   * 允许外部访问函数的类型定义。
   * 可用于生成文档或运行时类型检查。
   */
  result.schema = schema

  return result
}
