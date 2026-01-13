/**
 * ============================================================================
 * 文件名：fn.ts
 * 所属包：packages/util
 * ============================================================================
 *
 * 文件作用：
 * 提供带 schema 验证的函数包装器。
 * 这个模块创建一个特殊的函数对象，它会在调用时自动验证输入参数，
 * 符合 Zod schema 定义。这提供了类型安全和运行时验证的双重保障。
 *
 * 主要功能：
 * - 自动验证：函数调用时自动使用 Zod schema 验证输入
 * - 强制调用：提供 force 方法跳过验证直接调用
 * - Schema 访问：将 schema 附加到函数对象上便于访问
 *
 * 依赖关系：
 * - zod：用于运行时类型验证和 schema 定义
 *
 * 导出内容：
 * - fn：创建带验证的函数包装器
 *
 * 使用场景：
 * - API 输入验证
 * - 配置对象验证
 * - 需要运行时类型安全的函数
 * - 与 Zod 集成的数据验证
 *
 * @package util
 * @module fn
 */

// 从 zod 导入必要的类型验证工具
import { z } from "zod"

/**
 * 创建带 schema 验证的函数包装器
 *
 * 此函数创建一个特殊的函数对象，它会在调用时自动验证输入参数。
 * 验证通过后，输入会被解析为正确的类型，然后传递给回调函数。
 *
 * @template T - Zod schema 类型，定义输入的结构和验证规则
 * @template Result - 回调函数的返回值类型
 * @param schema - Zod schema 对象，用于验证和解析输入
 * @param cb - 回调函数，接收验证后的输入并返回结果
 * @returns 增强的函数对象，包含：
 *          - 函数本身：调用时验证输入
 *          - .force()：跳过验证直接调用
 *          - .schema：附加的 schema 对象
 *
 * 工作原理：
 * 1. 创建一个函数 result，它接收输入参数
 * 2. 在 result 函数内部：
 *    a. 使用 schema.parse() 验证和解析输入
 *    b. 如果验证失败，抛出 Zod 错误
 *    c. 如果验证成功，将解析后的数据传递给回调函数
 *    d. 返回回调函数的结果
 * 3. 在 result 函数上添加两个额外属性：
 *    a. .force()：跳过验证，直接将原始输入传递给回调函数
 *    b. .schema：保存原始 schema 供外部访问
 *
 * 使用场景：
 * - 创建需要运行时验证的 API 端点
 * - 验证用户输入
 * - 配置文件解析和验证
 * - 任何需要类型安全的数据处理
 *
 * @example
 * ```typescript
 * import { z } from "zod"
 * import { fn } from "./fn"
 *
 * // 定义输入的 schema
 * const userInputSchema = z.object({
 *   name: z.string().min(1),
 *   age: z.number().int().positive(),
 * })
 *
 * // 创建带验证的函数
 * const processUser = fn(userInputSchema, (input) => {
 *   // 这里的 input 已经是验证后的类型，TypeScript 知道它的结构
 *   console.log(`Processing ${input.name}, age ${input.age}`)
 *   return `User ${input.name} processed`
 * })
 *
 * // 正常调用 - 会验证输入
 * const result1 = processUser({ name: "Alice", age: 30 })
 * // 输出: "Processing Alice, age 30"
 * // 返回: "User Alice processed"
 *
 * // 无效输入 - 会抛出 Zod 错误
 * try {
 *   processUser({ name: "", age: -1 })
 * } catch (error) {
 *   console.error("Validation failed:", error)
 * }
 *
 * // 使用 .force() 跳过验证 - 危险！
 * const result2 = processUser.force({ name: "Bob", age: 25 } as any)
 * // 直接调用，不进行验证
 * ```
 *
 * 注意事项：
 * - .force() 方法会跳过验证，使用时需要确保数据已经有效
 * - schema.parse() 在验证失败时会抛出 ZodError
 * - 返回的函数对象可以像普通函数一样调用
 */
export function fn<T extends z.ZodType, Result>(
  schema: T,                              // Zod schema，定义输入的结构和验证规则
  cb: (input: z.infer<T>) => Result       // 回调函数，接收验证后的输入
) {
  // 创建验证函数
  // 这个函数会在每次调用时验证输入
  const result = (input: z.infer<T>) => {
    // 使用 Zod schema 验证和解析输入
    // schema.parse() 会：
    // 1. 验证输入是否符合 schema 定义
    // 2. 如果验证失败，抛出 ZodError
    // 3. 如果验证成功，返回解析后的数据（类型被正确推断）
    const parsed = schema.parse(input)

    // 将验证后的数据传递给回调函数
    // parsed 的类型是 z.infer<T>，TypeScript 可以正确推断
    return cb(parsed)
  }

  // 添加 force 方法到函数对象
  // 这个方法会跳过验证，直接将原始输入传递给回调函数
  // 使用场景：当数据已经预先验证过，或者需要特殊处理时
  result.force = (input: z.infer<T>) => cb(input)

  // 将 schema 附加到函数对象上
  // 这样外部代码可以访问 schema，用于类型检查或其他用途
  result.schema = schema

  // 返回增强后的函数对象
  // 这是一个函数，但有额外的属性（.force 和 .schema）
  return result
}
