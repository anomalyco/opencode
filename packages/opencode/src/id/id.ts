/**
 * ============================================================================
 * 文件名：id.ts
 * 所属包：packages/opencode/src/id
 * ============================================================================
 *
 * 文件作用：
 * 唯一标识符生成模块。提供带前缀的、单调递增/递减的唯一 ID 生成功能。
 *
 * 主要功能：
 * - 生成带类型前缀的唯一 ID
 * - 支持按时间戳单调排序
 * - 支持递增和递减排序
 * - 使用 base62 编码减少 ID 长度
 * - 从 ID 提取时间戳
 * - Zod schema 验证
 *
 * 依赖关系：
 * - zod：类型验证
 * - crypto：随机数生成
 *
 * 导出内容：
 * - Identifier namespace：标识符管理命名空间
 *   - prefixes：ID 前缀常量
 *   - schema(prefix)：创建 Zod 验证 schema
 *   - create(prefix, descending, timestamp?)：生成新 ID
 *   - ascending(prefix, given?)：生成或验证递增 ID
 *   - descending(prefix, given?)：生成或验证递减 ID
 *   - timestamp(id)：从 ID 提取时间戳
 *
 * ID 格式：
 * {prefix}_{timestamp}{random}
 * - prefix：3 字母前缀（如 ses_）
 * - timestamp：12 字符十六进制（48 位时间戳 + 计数器）
 * - random：14 字符 base62 随机字符串
 * - 总长度：3 + 1 + 12 + 14 = 30 字符
 *
 * 支持的实体类型：
 * - session (ses_)：会话 ID
 * - message (msg_)：消息 ID
 * - permission (per_)：权限 ID
 * - question (que_)：问题 ID
 * - user (usr_)：用户 ID
 * - part (prt_)：部分 ID
 * - pty (pty_)：PTY ID
 * - tool (tool_)：工具 ID
 *
 * 排序特性：
 * - ascending：按时间戳递增排序（新 ID 更大）
 * - descending：按时间戳递减排序（新 ID 更小）
 * - 同一毫秒内的 ID 按计数器递增
 *
 * @package opencode
 * @module id
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入加密模块的随机字节生成函数
import { randomBytes } from "crypto"

/**
 * 标识符命名空间
 *
 * 包含所有 ID 生成和验证相关的功能。
 */
export namespace Identifier {
  /**
   * ID 前缀常量
   *
   * 每种实体类型都有唯一的前缀，用于快速识别 ID 类型。
   * 前缀使用 3 字母缩写，后面跟下划线。
   */
  const prefixes = {
    /** 会话 ID 前缀 */
    session: "ses",
    /** 消息 ID 前缀 */
    message: "msg",
    /** 权限 ID 前缀 */
    permission: "per",
    /** 问题 ID 前缀 */
    question: "que",
    /** 用户 ID 前缀 */
    user: "usr",
    /** 部分 ID 前缀 */
    part: "prt",
    /** PTY（伪终端）ID 前缀 */
    pty: "pty",
    /** 工具 ID 前缀 */
    tool: "tool",
  } as const

  /**
   * 创建 ID 验证 schema
   *
   * 返回一个 Zod schema，验证字符串是否以指定前缀开头。
   * 用于运行时类型验证。
   *
   * @param prefix - 前缀名称（prefixes 的键）
   * @returns Zod string schema
   *
   * 使用示例：
   * ```typescript
   * const SessionID = Identifier.schema("session")
   * SessionID.parse("ses_abc123")  // OK
   * SessionID.parse("msg_xyz789")  // ZodError
   * ```
   */
  export function schema(prefix: keyof typeof prefixes) {
    return z.string().startsWith(prefixes[prefix])
  }

  /**
   * ID 随机部分长度
   *
   * 除时间戳外的随机字符数（base62 编码）。
   * 总 ID 长度 = 前缀(3) + 下划线(1) + 时间戳(12) + 随机(26) = 42
   */
  const LENGTH = 26

  /**
   * 单调 ID 生成状态
   *
   * 用于确保同一毫秒内的 ID 单调递增。
   * - lastTimestamp：上次生成 ID 的时间戳
   * - counter：同一毫秒内的计数器
   */
  // 上次生成 ID 的时间戳（毫秒）
  let lastTimestamp = 0
  // 当前时间戳的计数器
  let counter = 0

  /**
   * 生成或验证递增 ID
   *
   * 如果提供了 given，验证它是否是有效 ID 并返回。
   * 否则生成新的递增 ID（按时间戳从小到大）。
   *
   * @param prefix - ID 前缀类型
   * @param given - 可选的现有 ID
   * @returns 验证后的 ID 或新生成的递增 ID
   */
  export function ascending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, false, given)
  }

  /**
   * 生成或验证递减 ID
   *
   * 如果提供了 given，验证它是否是有效 ID 并返回。
   * 否则生成新的递减 ID（按时间戳从大到小）。
   *
   * @param prefix - ID 前缀类型
   * @param given - 可选的现有 ID
   * @returns 验证后的 ID 或新生成的递减 ID
   */
  export function descending(prefix: keyof typeof prefixes, given?: string) {
    return generateID(prefix, true, given)
  }

  /**
   * 生成或验证 ID
   *
   * 内部实现，处理 ID 验证和生成的通用逻辑。
   *
   * @param prefix - ID 前缀类型
   * @param descending - 是否递减排序
   * @param given - 可选的现有 ID
   * @returns 验证后的 ID 或新生成的 ID
   * @throws {Error} 如果 given 不以正确前缀开头
   */
  function generateID(prefix: keyof typeof prefixes, descending: boolean, given?: string): string {
    // 如果没有提供 ID，生成新的
    if (!given) {
      return create(prefix, descending)
    }

    // 验证提供的 ID 是否以正确前缀开头
    if (!given.startsWith(prefixes[prefix])) {
      throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
    }

    // 验证通过，返回原 ID
    return given
  }

  /**
   * 生成随机 base62 字符串
   *
   * 使用加密安全的随机字节生成 base62 编码的字符串。
   * base62 字符集：0-9, A-Z, a-z（62 个字符）
   *
   * @param length - 要生成的字符数
   * @returns base62 编码的随机字符串
   */
  function randomBase62(length: number): string {
    // base62 字符集
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    let result = ""

    // 生成加密安全的随机字节
    const bytes = randomBytes(length)

    // 将每个字节映射到 base62 字符
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % 62]
    }

    return result
  }

  /**
   * 创建新的唯一 ID
   *
   * 生成包含时间戳和随机部分的唯一 ID。
   * 支持递增或递减排序。
   *
   * ID 结构：
   * - 前缀：3 字符（如 "ses_"）
   * - 时间戳：12 字符十六进制（48 位）
   *   - 高 36 位：毫秒时间戳
   *   - 低 12 位：计数器（同一毫秒内的递增）
   * - 随机部分：14 字符 base62
   *
   * @param prefix - ID 前缀类型
   * @param descending - 是否递减排序（true）或递增排序（false）
   * @param timestamp - 可选的自定义时间戳（用于测试）
   * @returns 新生成的唯一 ID
   */
  export function create(prefix: keyof typeof prefixes, descending: boolean, timestamp?: number): string {
    // 使用提供的时间戳或当前时间
    const currentTimestamp = timestamp ?? Date.now()

    // 如果时间戳变化，重置计数器
    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }

    // 递增计数器（确保同一毫秒内的 ID 唯一且单调）
    counter++

    /**
     * 编码时间戳和计数器为 48 位整数
     *
     * 布局：
     * - 位 47-12：毫秒时间戳
     * - 位 11-0：计数器
     *
     * 乘以 0x1000（4096）相当于左移 12 位，
     * 为计数器留出 12 位空间。
     */
    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    // 如果是递减排序，按位取反
    // 这样新 ID 会小于旧 ID
    now = descending ? ~now : now

    // 将 48 位整数转换为 6 字节
    const timeBytes = Buffer.alloc(6)
    for (let i = 0; i < 6; i++) {
      // 从高字节到低字节提取每个字节
      timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
    }

    /**
     * 组合最终 ID
     *
     * 格式：{prefix}_{timestamp_hex}{random_base62}
     * - prefix：3 字符前缀
     * - _：分隔符
     * - timestamp_hex：12 字符十六进制（6 字节）
     * - random_base62：14 字符 base62 随机字符串
     */
    return prefixes[prefix] + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - 12)
  }

  /**
   * 从递增 ID 提取时间戳
   *
   * 解析 ID 的时间戳部分并返回原始毫秒时间戳。
   *
   * 注意：此函数仅适用于递增 ID（descending = false）。
   * 对于递减 ID，由于使用了按位取反，结果不正确。
   *
   * @param id - 要解析的 ID
   * @returns 提取的毫秒时间戳
   *
   * @example
   * ```typescript
   * const id = Identifier.create("session", false)
   * const ts = Identifier.timestamp(id)
   * console.log(ts)  // 输出 ID 生成时的时间戳
   * ```
   */
  export function timestamp(id: string): number {
    // 提取前缀部分（第一个下划线之前）
    const prefix = id.split("_")[0]

    // 提取时间戳十六进制部分（前缀后 12 字符）
    const hex = id.slice(prefix.length + 1, prefix.length + 13)

    // 将十六进制转换回 BigInt
    const encoded = BigInt("0x" + hex)

    // 除以 0x1000（右移 12 位），移除计数器部分
    // 返回原始毫秒时间戳
    return Number(encoded / BigInt(0x1000))
  }
}
