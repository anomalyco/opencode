/**
 * ============================================================================
 * 文件名：state.ts
 * 所属包：packages/opencode/src/project
 * ============================================================================
 *
 * 文件作用：
 * 状态管理模块。提供基于根键的状态存储和生命周期管理。
 *
 * 主要功能：
 * - create()：创建状态获取函数
 * - dispose()：释放指定根键的所有状态
 *
 * 依赖关系：
 * - ../util/log：日志记录
 *
 * 导出内容：
 * - State namespace：状态管理命名空间
 *   - create(root, init, dispose)：创建状态获取函数
 *   - dispose(key)：释放指定根键的所有状态
 *
 * 状态管理机制：
 * - 使用嵌套 Map 存储状态
 * - 外层 Map：根键（如实例目录）到状态条目的映射
 * - 内层 Map：初始化函数到状态条目的映射
 * - 支持每个状态的独立清理函数
 *
 * 生命周期：
 * 1. 调用 create() 创建状态获取函数
 * 2. 首次调用获取函数时执行 init()
 * 3. 后续调用返回缓存的状态
 * 4. 调用 dispose() 释放所有状态
 *
 * 超时警告：
 * - 如果状态清理超过 10 秒未完成，会记录警告日志
 * - 用于检测状态清理逻辑中的问题
 *
 * 使用示例：
 * ```typescript
 * // 创建状态获取函数
 * const getState = State.create(
 *   () => "instance-123",  // 根键函数
 *   () => {
 *     // 初始化状态
 *     return { count: 0, data: [] }
 *   },
 *   async (state) => {
 *     // 清理状态
 *     console.log("清理:", state.count)
 *   }
 * )
 *
 * // 获取状态（首次调用会执行 init）
 * const state1 = getState()
 *
 * // 再次获取（返回缓存的状态）
 * const state2 = getState()
 * // state1 === state2
 *
 * // 释放所有状态
 * await State.dispose("instance-123")
 * ```
 *
 * @package opencode
 * @module project/state
 */

// 导入日志模块
import { Log } from "@/util/log"

/**
 * 状态管理命名空间
 *
 * 提供基于根键的状态存储和生命周期管理功能。
 */
export namespace State {
  /**
   * 状态条目接口
   *
   * 定义存储在状态注册表中的条目结构。
   */
  interface Entry {
    // 状态对象（任意类型）
    state: any
    // 可选的状态清理函数
    dispose?: (state: any) => Promise<void>
  }

  // 创建日志记录器
  const log = Log.create({ service: "state" })

  /**
   * 状态注册表
   *
   * 嵌套 Map 结构：
   * - 外层：根键（如实例目录）到状态条目 Map 的映射
   * - 内层：初始化函数到状态条目的映射
   *
   * 使用初始化函数作为键的好处：
   * - 确保相同的初始化逻辑只创建一次状态
   * - 即使 create() 被多次调用，相同的 init 函数会返回相同状态
   */
  const recordsByKey = new Map<string, Map<any, Entry>>()

  /**
   * 创建状态获取函数
   *
   * 创建一个在指定根键下缓存状态的函数。
   *
   * @param root - 根键函数，返回状态所属的根标识（如实例目录）
   * @param init - 状态初始化函数，返回初始状态
   * @param dispose - 可选的状态清理函数
   * @returns 状态获取函数
   *
   * 工作原理：
   * 1. 获取根键（调用 root()）
   * 2. 获取该根键的状态条目 Map
   * 3. 检查是否已有该 init 函数的状态
   * 4. 如果没有，执行 init() 并存储
   * 5. 返回状态对象
   *
   * @example
   * ```typescript
   * const getConfig = State.create(
   *   () => Instance.directory,
   *   () => loadConfig(),
   *   async (config) => {
   *     await config.close()
   *   }
   * )
   *
   * const config = getConfig() // 首次调用，执行 init
   * const same = getConfig()  // 返回缓存的 config
   * ```
   */
  export function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) {
    // 返回状态获取函数
    return () => {
      // 获取根键（如实例目录路径）
      const key = root()

      // 获取该根键的状态条目 Map
      let entries = recordsByKey.get(key)

      // 如果该根键还没有条目 Map，创建一个
      if (!entries) {
        entries = new Map<string, Entry>()
        recordsByKey.set(key, entries)
      }

      // 检查是否已有该 init 函数的状态
      const exists = entries.get(init)
      if (exists) return exists.state as S // 返回缓存的状态

      // 首次调用：执行初始化函数
      const state = init()

      // 存储状态条目
      entries.set(init, {
        state, // 状态对象
        dispose, // 清理函数（如果有）
      })

      // 返回状态
      return state
    }
  }

  /**
   * 释放指定根键的所有状态
   *
   * 清理与指定根键关联的所有状态，执行它们的清理函数。
   *
   * @param key - 根键（如实例目录路径）
   * @returns Promise，完成时所有状态已释放
   *
   * 处理流程：
   * 1. 获取该根键的状态条目 Map
   * 2. 如果没有，直接返回
   * 3. 启动 10 秒超时警告
   * 4. 遍历所有状态条目：
   *    - 如果有清理函数，执行它
   *    - 捕获并记录任何错误
   * 5. 等待所有清理完成
   * 6. 清空条目 Map
   * 7. 记录完成日志
   *
   * 超时警告：
   * - 如果清理超过 10 秒未完成，会输出警告日志
   * - 用于检测清理逻辑中的死锁或性能问题
   * - 警告："state disposal is taking an unusually long time..."
   *
   * @example
   * ```typescript
   * await State.dispose("/path/to/instance")
   * // 该实例的所有状态都会被清理
   * ```
   */
  export async function dispose(key: string) {
    // 获取该根键的状态条目 Map
    const entries = recordsByKey.get(key)

    // 如果没有条目，直接返回
    if (!entries) return

    // 记录正在等待状态清理完成
    log.info("waiting for state disposal to complete", { key })

    // 标记清理是否完成（用于超时警告）
    let disposalFinished = false

    // 启动 10 秒超时警告
    // unref() 允许进程在计时器活动时退出
    setTimeout(() => {
      if (!disposalFinished) {
        // 清理耗时过长，记录警告
        log.warn(
          "state disposal is taking an unusually long time - if it does not complete in a reasonable time, please report this as a bug",
          { key },
        )
      }
    }, 10000).unref()

    // 收集所有清理任务
    const tasks: Promise<void>[] = []

    // 遍历所有状态条目
    for (const entry of entries.values()) {
      // 如果没有清理函数，跳过
      if (!entry.dispose) continue

      // 创建清理任务
      const task = Promise.resolve(entry.state)
        .then((state) => entry.dispose!(state)) // 执行清理函数
        .catch((error) => {
          // 记录清理错误，但不中断其他清理
          log.error("Error while disposing state:", { error, key })
        })

      // 添加到任务列表
      tasks.push(task)
    }

    // 清空条目 Map
    entries.clear()

    // 等待所有清理任务完成
    await Promise.all(tasks)

    // 标记清理完成
    disposalFinished = true

    // 记录清理完成
    log.info("state disposal completed", { key })
  }
}
