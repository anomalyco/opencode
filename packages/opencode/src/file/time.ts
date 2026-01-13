/**
 * ============================================================================
 * 文件名：time.ts
 * 所属包：packages/opencode/src/file
 * ============================================================================
 *
 * 文件作用：
 * 文件时间跟踪模块。跟踪会话读取文件的时间和并发写入锁，
 * 防止在文件被外部修改后覆盖它。
 *
 * 主要功能：
 * - state：存储读取时间和写入锁
 * - read(sessionID, file)：记录文件读取时间
 * - get(sessionID, file)：获取文件读取时间
 * - assert(sessionID, filepath)：断言文件未被外部修改
 * - withLock(filepath, fn)：串行化对同一文件的并发写入
 *
 * 依赖关系：
 * - ../project/instance：实例状态管理
 * - ../util/log：日志记录
 *
 * 导出内容：
 * - FileTime namespace：文件时间跟踪命名空间
 *   - state：状态存储
 *   - read()：记录读取时间
 *   - get()：获取读取时间
 *   - assert()：断言文件未修改
 *   - withLock()：并发写入锁
 *
 * 并发控制：
 * - 使用 Promise 链串行化对同一文件的写入
 * - 每个文件的写入操作按顺序执行
 *
 * @package opencode
 * @module file/time
 */

// 导入实例管理
import { Instance } from "../project/instance"

// 导入日志工具
import { Log } from "../util/log"

/**
 * 文件时间跟踪命名空间
 *
 * 跟踪会话读取文件的时间并提供并发写入保护。
 */
export namespace FileTime {
  // 创建日志记录器
  const log = Log.create({ service: "file.time" })

  // Per-session read times plus per-file write locks.
  // 所有覆盖现有文件的工具都应该在 withLock(filepath, ...) 中
  // 运行它们的 assert/read/write/update 序列，以便并发写入同一文件被串行化。
  /**
   * 状态存储
   *
   * 实例级状态，包含：
   * - read：按会话 ID 和文件路径索引的读取时间
   * - locks：按文件路径索引的写入锁 Promise 链
   */
  export const state = Instance.state(() => {
    // 读取时间映射：sessionID -> (filepath -> 读取时间)
    const read: {
      [sessionID: string]: {
        [path: string]: Date | undefined
      }
    } = {}

    // 写入锁映射：filepath -> Promise
    // 使用 Promise 链确保对同一文件的写入按顺序执行
    const locks = new Map<string, Promise<void>>()

    return {
      read,
      locks,
    }
  })

  /**
   * 记录文件读取时间
   *
   * 当会话读取文件时调用，记录读取时间戳。
   *
   * @param sessionID - 会话 ID
   * @param file - 文件路径
   */
  export function read(sessionID: string, file: string) {
    log.info("read", { sessionID, file })
    const { read } = state()
    // 初始化会话的读取记录
    read[sessionID] = read[sessionID] || {}
    // 记录当前时间
    read[sessionID][file] = new Date()
  }

  /**
   * 获取文件读取时间
   *
   * @param sessionID - 会话 ID
   * @param file - 文件路径
   * @returns 读取时间，如果未读取则返回 undefined
   */
  export function get(sessionID: string, file: string) {
    return state().read[sessionID]?.[file]
  }

  /**
   * 使用写入锁执行函数
   *
   * 确保对同一文件的写入操作按顺序执行。
   * 使用 Promise 链实现串行化。
   *
   * @param filepath - 文件路径
   * @param fn - 要执行的异步函数
   * @returns Promise，解析为函数返回值
   *
   * 实现逻辑：
   * 1. 获取当前的写入锁（如果没有则为 resolved Promise）
   * 2. 创建新的写入锁 Promise
   * 3. 将新锁链接到当前锁之后
   * 4. 等待当前锁完成
   * 5. 执行函数
   * 6. 释放新锁（如果当前锁没有变化则删除）
   */
  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    const current = state()
    // 获取当前锁，没有则用 resolved Promise
    const currentLock = current.locks.get(filepath) ?? Promise.resolve()

    // 创建释放函数
    let release: () => void = () => {}
    // 创建新的锁 Promise
    const nextLock = new Promise<void>((resolve) => {
      release = resolve
    })

    // 链接锁：当前锁完成后执行新锁
    const chained = currentLock.then(() => nextLock)
    current.locks.set(filepath, chained)

    // 等待当前锁完成
    await currentLock

    try {
      // 执行函数
      return await fn()
    } finally {
      // 释放新锁
      release()

      // 如果锁没有被替换，则删除
      if (current.locks.get(filepath) === chained) {
        current.locks.delete(filepath)
      }
    }
  }

  /**
   * 断言文件未被外部修改
   *
   * 在写入文件前调用，确保文件自上次读取以来未被外部修改。
   *
   * @param sessionID - 会话 ID
   * @param filepath - 文件路径
   * @throws 如果文件未读取或已被外部修改
   *
   * 检查逻辑：
   * 1. 确认文件已读取（有读取时间记录）
   * 2. 比较文件修改时间与读取时间
   * 3. 如果文件更新，抛出错误
   */
  export async function assert(sessionID: string, filepath: string) {
    // 获取读取时间
    const time = get(sessionID, filepath)
    if (!time) throw new Error(`You must read the file ${filepath} before overwriting it. Use the Read tool first`)

    // 获取文件状态
    const stats = await Bun.file(filepath).stat()

    // 检查文件是否在读取后被修改
    if (stats.mtime.getTime() > time.getTime()) {
      throw new Error(
        `File ${filepath} has been modified since it was last read.\nLast modification: ${stats.mtime.toISOString()}\nLast read: ${time.toISOString()}\n\nPlease read the file again before modifying it.`,
      )
    }
  }
}
