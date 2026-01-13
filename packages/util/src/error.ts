/**
 * ============================================================================
 * 文件名：error.ts
 * 所属包：packages/util
 * ============================================================================
 *
 * 文件作用：
 * 提供带类型定义的结构化错误类系统。
 * 这个模块创建一个特殊的错误基类，可以动态创建带 Zod schema 验证的错误类。
 * 每个错误类型都有名称、数据结构定义，可以序列化为对象。
 *
 * 主要功能：
 * - 动态错误类型创建：使用 NamedError.create() 创建新的错误类
 * - 自动 schema 生成：每个错误类自动关联 Zod schema
 * - 类型安全：使用 Zod 确保错误数据的结构正确
 * - 序列化支持：错误可以转换为普通对象便于传输
 * - 实例检查：提供静态方法检查错误实例
 *
 * 依赖关系：
 * - zod：用于定义错误数据的 schema 和运行时验证
 *
 * 导出内容：
 * - NamedError：抽象错误基类，包含创建自定义错误类的静态方法
 *
 * 使用场景：
 * - 定义业务特定的错误类型
 * - API 错误响应
 * - 错误数据验证和序列化
 * - 类型安全的错误处理
 *
 * @package util
 * @module error
 */

// 从 zod 导入类型验证工具
import z from "zod"

/**
 * NamedError 抽象基类
 *
 * 所有使用此系统创建的自定义错误类都继承自这个基类。
 * 它提供了创建新错误类型的工厂方法和必要的抽象方法定义。
 *
 * 抽象方法（子类必须实现）：
 * - schema()：返回此错误类型的 Zod schema
 * - toObject()：将错误实例转换为普通对象
 *
 * 静态方法：
 * - create()：工厂方法，创建新的错误类
 * - Unknown：预定义的通用未知错误类
 *
 * 使用场景：
 * - 创建业务特定的错误类型
 * - 带结构化数据的错误
 * - 需要序列化传输的错误
 */
export abstract class NamedError extends Error {
  /**
   * 抽象方法：返回此错误类型的 Zod schema
   *
   * 每个子类必须实现此方法，返回用于验证错误数据的 schema。
   * 这个 schema 通常在 create() 工厂方法中定义。
   *
   * @returns Zod schema 对象，定义此错误的数据结构
   */
  abstract schema(): z.core.$ZodType

  /**
   * 抽象方法：将错误实例转换为普通对象
   *
   * 每个子类必须实现此方法，返回一个包含错误名称和数据的对象。
   * 这使得错误可以序列化为 JSON 并通过网络传输。
   *
   * @returns 包含 name 和 data 属性的对象
   */
  abstract toObject(): { name: string; data: any }

  /**
   * 静态工厂方法：创建新的错误类
   *
   * 这是 NamedError 的核心方法，用于动态创建新的错误类型。
   * 创建的错误类继承自 NamedError，并自动附加必要的属性和方法。
   *
   * @template Name - 错误名称的字面量类型（如 "FileNotFound"）
   * @template Data - Zod schema 类型，定义错误数据的结构
   * @param name - 错误的名称，用于标识错误类型
   * @param data - Zod schema，定义此错误携带的数据结构
   * @returns 新创建的错误类，包含静态方法 schema 和 isInstance
   *
   * 创建过程：
   * 1. 使用 z.object() 创建 schema，包含 name 字面量和 data schema
   * 2. 添加元数据 ref，使用 name 作为引用标识
   * 3. 创建继承自 NamedError 的新类：
   *    a. 添加静态 schema 属性
   *    b. 设置 name 属性为传入的字面量名称
   *    c. 定义构造函数，接收 data 和 options
   *    d. 添加静态 isInstance 方法，用于类型检查
   *    e. 实现 schema() 方法，返回创建的 schema
   *    f. 实现 toObject() 方法，返回错误的对象表示
   * 4. 设置类的 name 属性为传入的名称
   * 5. 返回新创建的类
   *
   * 使用场景：
   * - 定义 API 错误类型
   * - 创建业务逻辑错误
   * - 需要序列化的错误对象
   *
   * @example
   * ```typescript
   * import { z } from "zod"
   * import { NamedError } from "./error"
   *
   * // 定义错误数据的 schema
   * const FileNotFoundData = z.object({
   *   path: z.string(),
   *   searched: z.array(z.string()),
   * })
   *
   * // 创建错误类
   * const FileNotFound = NamedError.create("FileNotFound", FileNotFoundData)
   *
   * // 使用错误类
   * throw new FileNotFound({
   *   path: "/etc/config.json",
   *   searched: ["/home/user/config.json", "./config.json"]
   * })
   *
   * // 检查错误类型
   * try {
   *   // 某些操作
   * } catch (error) {
   *   if (FileNotFound.isInstance(error)) {
   *     console.log("File not found:", error.data.path)
   *   }
   * }
   *
   * // 访问 schema
   * const parsed = FileNotFound.Schema.parse({
   *   name: "FileNotFound",
   *   data: { path: "test", searched: [] }
   * })
   * ```
   */
  static create<Name extends string, Data extends z.core.$ZodType>(
    name: Name,      // 错误名称，必须是字符串字面量类型
    data: Data       // Zod schema，定义错误数据的结构
  ) {
    // 创建 Zod schema，定义错误的完整结构
    // 这个 schema 包含两个部分：
    // 1. name：使用 z.literal() 确保名称必须是特定的字面值
    // 2. data：使用传入的 schema 定义数据的结构
    const schema = z
      .object({
        // name 字段必须是特定的字面量值
        name: z.literal(name),

        // data 字段使用传入的 schema 验证
        data,
      })
      // 添加元数据，使用 name 作为引用标识
      // 这可以帮助在错误处理时识别错误类型
      .meta({
        ref: name,
      })

    // 创建新的错误类
    const result = class extends NamedError {
      // 静态属性：存储此错误类型的 schema
      // 使用大写的 Schema 是常见的命名约定
      public static readonly Schema = schema

      // 实例属性：错误名称，使用类型断言确保类型正确
      // override 关键字表示这是对父类属性的重写
      public override readonly name = name as Name

      /**
       * 构造函数
       *
       * @param data - 错误数据，符合传入的 schema 定义
       * @param options - ErrorOptions，用于设置 cause 等标准 Error 属性
       */
      constructor(
        // public 修饰符使 data 成为实例属性
        // z.input<Data> 是 schema 的输入类型（允许原始类型）
        public readonly data: z.input<Data>,

        // 可选的 ErrorOptions，用于设置 cause 等
        options?: ErrorOptions,
      ) {
        // 调用父类 Error 的构造函数
        // 传递错误名称和可选的选项
        super(name, options)

        // 确保 name 属性被正确设置
        // JavaScript/TypeScript 的 Error 类可能不会自动设置 name
        this.name = name
      }

      /**
       * 静态方法：检查输入是否为此错误类型的实例
       *
       * 这是一个类型守卫（type guard），可以用于运行时类型检查。
       *
       * @param input - 任意值，可能是错误实例
       * @returns 如果是此错误类型的实例返回 true
       *
       * 检查逻辑：
       * 1. 检查输入是否为对象类型
       * 2. 检查对象是否有 name 属性
       * 3. 检查 name 属性是否等于此错误类型的名称
       */
      static isInstance(input: any): input is InstanceType<typeof result> {
        // 确保输入是对象且包含 name 属性
        return typeof input === "object" && "name" in input && input.name === name
      }

      /**
       * 实例方法：返回此错误类型的 schema
       *
       * 实现抽象方法，返回创建错误时定义的 schema。
       */
      schema() {
        return schema
      }

      /**
       * 实例方法：将错误转换为普通对象
       *
       * 实现抽象方法，返回包含错误名称和数据的对象。
       * 这使得错误可以序列化为 JSON 传输。
       */
      toObject() {
        return {
          // 返回错误的名称
          name: name,

          // 返回错误携带的数据
          data: this.data,
        }
      }
    }

    // 设置类的 name 属性
    // defineProperty 是必要的，因为类的 name 属性是只读的
    // 这使得类的名称在调试和错误消息中正确显示
    Object.defineProperty(result, "name", { value: name })

    // 返回新创建的错误类
    return result
  }

  /**
   * 预定义的通用未知错误类
   *
   * 这是一个默认的错误类型，用于无法分类的错误。
   *
   * 数据结构：
   * - message: string - 错误消息
   *
   * 使用场景：
   * - 捕获无法预料的错误
   * - 包装第三方库的错误
   * - 作为默认的错误回退
   *
   * @example
   * ```typescript
   * try {
   *   // 某些可能失败的操作
   * } catch (error) {
   *   throw new NamedError.Unknown({
   *     message: error instanceof Error ? error.message : String(error)
   *   })
   * }
   * ```
   */
  public static readonly Unknown = NamedError.create(
    // 错误名称
    "UnknownError",

    // 错误数据的 schema
    z.object({
      // 错误消息，字符串类型
      message: z.string(),
    }),
  )
}
