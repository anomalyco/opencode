/**
 * ============================================================================
 * 文件名：shell.ts
 * 所属包：packages/plugin/src
 * ============================================================================
 *
 * 文件作用：
 * 提供插件系统中 Shell 命令执行的类型定义。
 * 这些类型与 Bun 的 Shell API 兼容，允许插件执行 shell 命令。
 *
 * 主要功能：
 * - 定义 Shell 函数类型
 * - 定义 Shell 表达式类型
 * - 定义 BunShell 接口（Shell 配置和执行）
 * - 定义 BunShellPromise 接口（异步 Shell 执行结果）
 * - 定义 BunShellOutput 接口（Shell 输出结果）
 *
 * 依赖关系：
 * - 无外部依赖，仅使用 Web 标准 API
 *
 * 导出内容：
 * - ShellFunction：Shell 函数类型
 * - ShellExpression：Shell 表达式类型
 * - BunShell：Shell 接口
 * - BunShellPromise：Shell Promise 接口
 * - BunShellOutput：Shell 输出接口
 * - BunShellError：Shell 错误类型
 *
 * 使用场景：
 * - 在插件中执行 shell 命令
 * - 运行脚本和工具
 * - 与系统 shell 交互
 *
 * @package plugin
 * @module shell
 */

/**
 * Shell 函数类型
 *
 * 定义 Shell 函数的签名，接收二进制输入，返回二进制输出。
 * 这是底层 Shell 执行函数的类型。
 */
export type ShellFunction = (input: Uint8Array) => Uint8Array

/**
 * Shell 表达式类型
 *
 * 定义可以作为 Shell 命令参数的表达式类型。
 * 支持多种类型，方便构建灵活的命令。
 */
export type ShellExpression =
  // 可转换为字符串的对象（调用 toString()）
  | { toString(): string }

  // 表达式数组（命令参数列表）
  | Array<ShellExpression>

  // 字符串（最常用的类型）
  | string

  // 原始字符串（不进行转义）
  | { raw: string }

  // 可读流（用于管道输入）
  | ReadableStream

/**
 * BunShell 接口
 *
 * 定义 Shell 配置和执行接口。这是一个可调用接口，
 * 可以像函数一样使用来执行 shell 命令。
 */
export interface BunShell {
  // 调用签名：执行 shell 命令
  // 支持模板字符串语法，类似 JavaScript 模板字符串
  (strings: TemplateStringsArray, ...expressions: ShellExpression[]): BunShellPromise

  /**
   * 花括号扩展
   *
   * 对模式执行 bash 风格的花括号扩展。
   * 例如："{a,b}{c,d}" -> ["ac", "ad", "bc", "bd"]
   *
   * @param pattern - 要扩展的花括号模式
   * @returns 扩展后的字符串数组
   *
   * @example
   * ```typescript
   * $.braces("file.{txt,md}")  // ["file.txt", "file.md"]
   * $.braces("src/{core,util}/*.ts")  // ["src/core/*.ts", "src/util/*.ts"]
   * ```
   */
  braces(pattern: string): string[]

  /**
   * 转义字符串
   *
   * 转义字符串以便安全地输入到 shell 命令中。
   * 防止注入攻击和参数解析错误。
   *
   * @param input - 需要转义的字符串
   * @returns 转义后的字符串
   *
   * @example
   * ```typescript
   * $.escape("hello world")  // "hello\\ world"
   * $.escape("user's file")   // "user'\\''s file"
   * ```
   */
  escape(input: string): string

  /**
   * 设置环境变量
   *
   * 更改由此 Shell 实例创建的 shell 的默认环境变量。
   *
   * @param newEnv - 新的环境变量对象
   *                   值为 undefined 表示删除该变量
   * @returns 配置了新环境变量的 Shell 实例
   *
   * @example
   * ```typescript
   * const shell = $.env({ NODE_ENV: "production" })
   * const shell2 = $.env({ PATH: undefined })  // 删除 PATH
   * ```
   */
  env(newEnv?: Record<string, string | undefined>): BunShell

  /**
   * 设置工作目录
   *
   * 设置由此 Shell 实例创建的 shell 的默认工作目录。
   *
   * @param newCwd - 新的工作目录路径
   * @returns 配置了新工作目录的 Shell 实例
   *
   * @example
   * ```typescript
   * const shell = $.cwd("/home/user/project")
   * await shell`ls`  // 在 /home/user/project 目录执行
   * ```
   */
  cwd(newCwd?: string): BunShell

  /**
   * 禁用异常抛出
   *
   * 配置 shell 在非零退出码时不抛出异常。
   * 默认情况下，非零退出码会抛出异常。
   *
   * @returns 配置为不抛出异常的 Shell 实例
   *
   * @example
   * ```typescript
   * const shell = $.nothrow()
   * const result = await shell`false`  // 不会抛出异常
   * console.log(result.exitCode)  // 1
   * ```
   */
  nothrow(): BunShell

  /**
   * 设置异常抛出行为
   *
   * 配置 shell 是否在非零退出码时抛出异常。
   *
   * @param shouldThrow - 是否抛出异常，true 表示抛出
   * @returns 配置了指定行为的 Shell 实例
   *
   * @example
   * ```typescript
   * const shell1 = $.throws(true)
   * const shell2 = $.throws(false)  // 等同于 nothrow()
   * ```
   */
  throws(shouldThrow: boolean): BunShell
}

/**
 * BunShellPromise 接口
 *
 * 扩展 Promise 接口，提供 Shell 命令执行的高级功能。
 *
 * 继承 Promise<BunShellOutput>，所以可以使用 await 或 .then() 等标准 Promise 方法。
 */
export interface BunShellPromise extends Promise<BunShellOutput> {
  // 标准输入流
  // 用于向命令写入输入数据
  readonly stdin: WritableStream

  /**
   * 设置工作目录
   *
   * 更改 shell 的当前工作目录。
   *
   * @param newCwd - 新的工作目录路径
   * @returns this 返回自身，支持链式调用
   *
   * @example
   * ```typescript
   * await $`ls`.cwd("/tmp")
   * ```
   */
  cwd(newCwd: string): this

  /**
   * 设置环境变量
   *
   * 为 shell 设置环境变量。
   *
   * @param newEnv - 环境变量对象
   *                 值为 undefined 表示删除该变量
   * @returns this 返回自身，支持链式调用
   *
   * @example
   * ```typescript
   * await $`echo $FOO`.env({ FOO: "bar" })
   * ```
   */
  env(newEnv: Record<string, string> | undefined): this

  /**
   * 静默模式
   *
   * 配置 shell 只缓冲输出，不回显到当前进程的 stdout/stderr。
   * 默认情况下，shell 会同时回显和缓冲输出。
   *
   * @returns this 返回自身，支持链式调用
   *
   * @example
   * ```typescript
   * const output = await $`ls`.quiet()
   * // 不会在终端显示 ls 的输出
   * console.log(output.text())
   * ```
   */
  quiet(): this

  /**
   * 按行读取输出
   *
   * 从 stdout 逐行读取，返回异步可迭代对象。
   * 自动调用 quiet() 禁用回显。
   *
   * @returns 异步可迭代对象，每次迭代返回一行文本
   *
   * @example
   * ```typescript
   * for await (const line of await $`ls`.lines()) {
   *   console.log(line)
   * }
   * ```
   */
  lines(): AsyncIterable<string>

  /**
   * 读取为文本
   *
   * 从 stdout 读取全部内容作为字符串。
   * 自动调用 quiet() 禁用回显。
   *
   * @param encoding - 字符编码，默认为 utf8
   * @returns Promise<string> 包含全部输出的字符串
   *
   * @example
   * ```typescript
   * const text = await $`echo "hello"`.text()
   * console.log(text)  // "hello\n"
   * ```
   */
  text(encoding?: BufferEncoding): Promise<string>

  /**
   * 读取为 JSON
   *
   * 从 stdout 读取并解析为 JSON 对象。
   * 自动调用 quiet() 禁用回显。
   *
   * @returns Promise<any> 解析后的 JSON 对象
   * @throws 如果输出不是有效的 JSON
   *
   * @example
   * ```typescript
   * const data = await $`echo '{"name":"test"}'`.json()
   * console.log(data.name)  // "test"
   * ```
   */
  json(): Promise<any>

  /**
   * 读取为 ArrayBuffer
   *
   * 从 stdout 读取全部内容作为 ArrayBuffer。
   * 自动调用 quiet() 禁用回显。
   *
   * @returns Promise<ArrayBuffer> 包含全部输出的 ArrayBuffer
   *
   * @example
   * ```typescript
   * const buffer = await $`cat file.bin`.arrayBuffer()
   * ```
   */
  arrayBuffer(): Promise<ArrayBuffer>

  /**
   * 读取为 Blob
   *
   * 从 stdout 读取全部内容作为 Blob。
   * 自动调用 quiet() 禁用回显。
   *
   * @returns Promise<Blob> 包含全部输出的 Blob 对象
   *
   * @example
   * ```typescript
   * const blob = await $`cat file.png`.blob()
   * ```
   */
  blob(): Promise<Blob>

  /**
   * 禁用异常抛出
   *
   * 配置 shell 在非零退出码时不抛出异常。
   *
   * @returns this 返回自身，支持链式调用
   *
   * @example
   * ```typescript
   * const result = await $`false`.nothrow()
   * console.log(result.exitCode)  // 1
   * ```
   */
  nothrow(): this

  /**
   * 设置异常抛出行为
   *
   * 配置 shell 是否在非零退出码时抛出异常。
   *
   * @param shouldThrow - 是否抛出异常
   * @returns this 返回自身，支持链式调用
   *
   * @example
   * ```typescript
   * await $`ls`.throws(false)
   * ```
   */
  throws(shouldThrow: boolean): this
}

/**
 * BunShellOutput 接口
 *
 * 定义 Shell 命令的执行结果。
 * 包含 stdout、stderr 和退出码，并提供多种读取输出的方法。
 */
export interface BunShellOutput {
  // 标准输出的 Buffer
  readonly stdout: Buffer

  // 标准错误的 Buffer
  readonly stderr: Buffer

  // 退出码（0 表示成功，非零表示失败）
  readonly exitCode: number

  /**
   * 读取 stdout 为文本
   *
   * 将 stdout Buffer 解码为字符串。
   *
   * @param encoding - 字符编码，默认为 utf8
   * @returns stdout 的字符串内容
   *
   * @example
   * ```typescript
   * const result = await $`echo "hello"`
   * console.log(result.text())  // "hello\n"
   * ```
   */
  text(encoding?: BufferEncoding): string

  /**
   * 读取 stdout 为 JSON
   *
   * 将 stdout 解码并解析为 JSON 对象。
   *
   * @returns 解析后的 JSON 对象
   * @throws 如果 stdout 不是有效的 JSON
   *
   * @example
   * ```typescript
   * const result = await $`echo '{"name":"test"}'`
   * console.log(result.json().name)  // "test"
   * ```
   */
  json(): any

  /**
   * 读取 stdout 为 ArrayBuffer
   *
   * 将 stdout Buffer 转换为 ArrayBuffer。
   *
   * @returns stdout 的 ArrayBuffer 表示
   *
   * @example
   * ```typescript
   * const result = await $`cat file.bin`
   * const buffer = result.arrayBuffer()
   * ```
   */
  arrayBuffer(): ArrayBuffer

  /**
   * 读取 stdout 为 Uint8Array
   *
   * 将 stdout Buffer 转换为 Uint8Array。
   *
   * @returns stdout 的 Uint8Array 表示
   *
   * @example
   * ```typescript
   * const result = await $`cat file.bin`
   * const bytes = result.bytes()
   * ```
   */
  bytes(): Uint8Array

  /**
   * 读取 stdout 为 Blob
   *
   * 将 stdout Buffer 转换为 Blob。
   *
   * @returns stdout 的 Blob 表示
   *
   * @example
   * ```typescript
   * const result = await $`cat file.png`
   * const blob = result.blob()
   * ```
   */
  blob(): Blob
}

/**
 * BunShellError 类型
 *
 * Shell 命令执行失败时的错误类型。
 * 继承自 Error，同时包含 Shell 输出信息。
 */
export type BunShellError = Error & BunShellOutput
