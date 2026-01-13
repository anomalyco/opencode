/**
 * ============================================================================
 * 文件名：identifier.ts
 * 所属包：packages/util
 * ============================================================================
 *
 * 文件作用：
 * 提供唯一标识符（ID）生成功能。
 * 生成的 ID 包含时间戳信息，可以按时间排序（升序或降序），
 * 同时包含随机部分确保唯一性。
 *
 * 主要功能：
 * - 时间戳 ID：生成包含时间戳的可排序 ID
 * - 升序 ID：生成按时间升序排列的 ID
 * - 降序 ID：生成按时间降序排列的 ID
 * - 单调性保证：同一毫秒内生成的 ID 保持单调递增
 *
 * 依赖关系：
 * - crypto：Node.js 内置的加密模块，用于生成随机字节
 *
 * 导出内容：
 * - Identifier.ascending：生成升序排列的 ID
 * - Identifier.descending：生成降序排列的 ID
 * - Identifier.create：生成指定排序方向的 ID
 *
 * 使用场景：
 * - 数据库记录 ID
 * - 分布式系统中的唯一标识
 * - 需要按时间排序的记录
 * - 日志条目标识
 *
 * @package util
 * @module identifier
 */

// 从 Node.js crypto 模块导入随机字节生成函数
import { randomBytes } from "crypto"

/**
 * Identifier 命名空间
 *
 * 包含生成唯一标识符的函数。
 * 生成的 ID 格式：[时间戳部分（12 字符）][随机部分（14 字符）]
 * - 时间戳部分：6 字节编码为 12 个十六进制字符
 * - 随机部分：使用 Base62 编码的随机字符串
 * - 总长度：26 个字符
 */
export namespace Identifier {
  // ID 的随机部分长度（字符数）
  // 时间戳部分占 12 个字符（6 字节的十六进制）
  // 所以随机部分是 26 - 12 = 14 个字符
  const LENGTH = 26

  // 单调 ID 生成的状态变量
  // 这些变量用于确保同一毫秒内生成的 ID 保持单调递增

  // 上一次生成 ID 时的时间戳（毫秒）
  let lastTimestamp = 0

  // 当前毫秒内的计数器
  // 每次生成 ID 时递增，确保同一毫秒内的 ID 单调递增
  let counter = 0

  /**
   * 生成升序排列的 ID
   *
   * 生成的 ID 按时间升序排列，较早的时间对应较小的 ID。
   * 适合需要按时间从旧到新排序的场景。
   *
   * @returns 升序排列的唯一标识符字符串
   *
   * 使用场景：
   * - 数据库主键（默认按时间升序查询）
   * - 日志记录（按时间顺序显示）
   * - 需要按创建时间排序的数据
   *
   * @example
   * ```typescript
   * const id1 = Identifier.ascending()  // 如 "000018a4f2d3a1b2c3d4e5f6g7h8i9j0"
   * await new Promise(resolve => setTimeout(resolve, 100))
   * const id2 = Identifier.ascending()  // id2 > id1（因为时间更晚）
   * ```
   */
  export function ascending() {
    // 传递 false 表示不反转时间戳，生成升序 ID
    return create(false)
  }

  /**
   * 生成降序排列的 ID
   *
   * 生成的 ID 按时间降序排列，较早的时间对应较大的 ID。
   * 适合需要优先显示最新内容的场景。
   *
   * @returns 降序排列的唯一标识符字符串
   *
   * 使用场景：
   * - 社交媒体动态（最新内容在前）
   * - 消息队列（最新消息优先）
   * - 缓存键（需要反向排序的场景）
   *
   * @example
   * ```typescript
   * const id1 = Identifier.descending()  // 如 "ffffe75b0d2c5a1b2c3d4e5f6g7h8i9j0"
   * await new Promise(resolve => setTimeout(resolve, 100))
   * const id2 = Identifier.descending()  // id2 < id1（因为时间更晚，降序）
   * ```
   */
  export function descending() {
    // 传递 true 表示反转时间戳，生成降序 ID
    return create(true)
  }

  /**
   * 生成 Base62 编码的随机字符串
   *
   * Base62 使用 0-9、A-Z、a-z 共 62 个字符进行编码。
   * 这比十六进制（Base16）更紧凑，同样长度可以表示更多的随机组合。
   *
   * @param length - 需要生成的随机字符串长度
   * @returns Base62 编码的随机字符串
   *
   * 编码过程：
   * 1. 定义 Base62 字符集：0-9、A-Z、a-z
   * 2. 生成指定长度的随机字节
   * 3. 每个字节对 62 取模，映射到字符集中的一个字符
   * 4. 连接所有字符形成最终字符串
   *
   * 注意事项：
   * - 使用模运算会有轻微偏差（256 不是 62 的整数倍）
   * - 对于 ID 生成的场景，这种偏差是可接受的
   * - 如果需要完美的均匀分布，应该使用拒绝采样
   */
  function randomBase62(length: number): string {
    // Base62 字符集
    // 0-9：数字（10 个）
    // A-Z：大写字母（26 个）
    // a-z：小写字母（26 个）
    // 总共 62 个字符
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

    // 结果字符串
    let result = ""

    // 生成随机字节
    // randomBytes 返回指定长度的随机字节缓冲区
    const bytes = randomBytes(length)

    // 遍历每个字节，转换为 Base62 字符
    for (let i = 0; i < length; i++) {
      // 字节值对 62 取模，映射到字符集索引
      // 添加到结果字符串
      result += chars[bytes[i] % 62]
    }

    // 返回 Base62 编码的随机字符串
    return result
  }

  /**
   * 核心 ID 生成函数
   *
   * 生成包含时间戳和随机部分的唯一标识符。
   * 时间戳部分可以按升序或降序排列，随机部分确保唯一性。
   *
   * @param descending - 是否生成降序 ID，true 为降序，false 为升序
   * @param timestamp - 可选的时间戳（毫秒），如果不提供则使用当前时间
   * @returns 26 字符长的唯一标识符字符串
   *
   * ID 结构（26 字符）：
   * - 时间戳部分（12 字符）：6 字节的时间戳和计数器，编码为十六进制
   * - 随机部分（14 字符）：Base62 编码的随机字符串
   *
   * 时间戳编码过程：
   * 1. 获取当前时间戳（毫秒）
   * 2. 如果时间戳与上次不同，重置计数器
   * 3. 递增计数器（确保同一毫秒内的 ID 单调递增）
   * 4. 组合时间戳和计数器：
   *    - 将时间戳左移 12 位（乘以 0x1000 = 4096）
   *    - 加上计数器值（最大 4095，占用 12 位）
   * 5. 如果需要降序，对值按位取反
   * 6. 将 48 位值分割为 6 个字节
   * 7. 将每个字节编码为 2 个十六进制字符
   *
   * 使用场景：
   * - 直接调用需要自定义排序的场景
   * - 测试时使用固定时间戳
   * - 需要精确控制 ID 生成的场景
   *
   * @example
   * ```typescript
   * // 使用当前时间生成升序 ID
   * const id1 = Identifier.create(false)
   *
   * // 使用当前时间生成降序 ID
   * const id2 = Identifier.create(true)
   *
   * // 使用特定时间戳（用于测试）
   * const id3 = Identifier.create(false, 1609459200000)
   * ```
   */
  export function create(descending: boolean, timestamp?: number): string {
    // 获取当前时间戳，如果未提供则使用 Date.now()
    // Date.now() 返回当前时间的毫秒数（Unix 时间戳）
    const currentTimestamp = timestamp ?? Date.now()

    // 检查时间戳是否变化
    if (currentTimestamp !== lastTimestamp) {
      // 时间戳变化，更新最后时间戳
      lastTimestamp = currentTimestamp

      // 重置计数器为 0
      counter = 0
    }

    // 递增计数器
    // 这确保同一毫秒内生成的 ID 保持单调递增
    counter++

    // 将时间戳和计数器组合为 48 位值
    // - 时间戳左移 12 位（乘以 4096）
    // - 加上计数器值（0-4095）
    // - 这样可以在同一毫秒内生成最多 4096 个唯一 ID
    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    // 如果需要降序，对值按位取反
    // 按位取反会将大的值变小，小的值变大
    // 这样时间越晚，ID 值越小（降序）
    now = descending ? ~now : now

    // 创建 6 字节的缓冲区用于存储时间戳部分
    const timeBytes = Buffer.alloc(6)

    // 将 48 位值分割为 6 个字节
    // 每次提取 8 位（1 个字节），从高位到低位
    for (let i = 0; i < 6; i++) {
      // 右移并取低 8 位
      // - 40 - 8*i：计算需要右移的位数
      //   - 第 1 次循环：40 位（取字节 5）
      //   - 第 2 次循环：32 位（取字节 4）
      //   - 第 3 次循环：24 位（取字节 3）
      //   - 第 4 次循环：16 位（取字节 2）
      //   - 第 5 次循环：8 位（取字节 1）
      //   - 第 6 次循环：0 位（取字节 0）
      // - & 0xff：确保只取低 8 位
      timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
    }

    // 组合时间戳部分和随机部分
    // - timeBytes.toString("hex")：6 字节编码为 12 个十六进制字符
    // - randomBase62(LENGTH - 12)：生成 14 个 Base62 字符
    // - 总长度：12 + 14 = 26 个字符
    return timeBytes.toString("hex") + randomBase62(LENGTH - 12)
  }
}
