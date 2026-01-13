/**
 * ============================================================================
 * 文件名：lock.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 读写锁（Read-Write Lock）模块。提供并发访问控制的读写锁实现。
 *
 * 主要功能：
 * - read(key)：获取读锁（多个读者可以同时持有）
 * - write(key)：获取写锁（独占访问，只能有一个写者）
 * - 防止写者饥饿（优先唤醒等待的写者）
 * - 支持 using 语法自动释放锁
 *
 * 依赖关系：
 * - 无外部依赖（使用 Symbol.dispose）
 *
 * 导出内容：
 * - Lock namespace：读写锁命名空间
 *   - read(key)：获取读锁
 *   - write(key)：获取写锁
 *
 * 读写锁特性：
 * - 读锁：允许多个读者同时访问
 * - 写锁：独占访问，排斥所有读者和写者
 * - 写者优先：防止写者被读者无限延迟
 * - 自动清理：空闲的锁会自动删除
 *
 * 使用场景：
 * - 保护共享资源的并发访问
 * - 配置文件的读写（多读少写）
 * - 缓存的一致性控制
 * - 数据库事务隔离
 *
 * 使用示例：
 * ```typescript
 * // 基本使用：使用 using 自动释放锁
 * {
 *   await using lock = await Lock.read("my-resource")
 *   // 读取共享资源
 *   console.log("reading...")
 * } // 锁自动释放
 *
 * // 写锁
 * {
 *   await using lock = await Lock.write("my-resource")
 *   // 修改共享资源
 *   console.log("writing...")
 * } // 锁自动释放
 *
 * // 手动释放锁
 * const lock = await Lock.read("my-resource")
 * try {
 *   // 读取操作
 * } finally {
 *   lock[Symbol.dispose]()
 * }
 *
 * // 并发示例
 * async function reader(id: number) {
 *   await using lock = await Lock.read("data")
 *   console.log(`Reader ${id} reading`)
 *   await sleep(1000)
 *   console.log(`Reader ${id} done`)
 * }
 *
 * async function writer(id: number) {
 *   await using lock = await Lock.write("data")
 *   console.log(`Writer ${id} writing`)
 *   await sleep(1000)
 *   console.log(`Writer ${id} done`)
 * }
 *
 * // 多个读者可以并发，写者独占
 * await Promise.all([reader(1), reader(2), writer(3)])
 * ```
 *
 * 实现原理：
 * 1. 每个键对应一个锁状态
 * 2. readers：当前持有读锁的数量
 * 3. writer：是否有写者持有锁
 * 4. waitingReaders：等待读锁的队列
 * 5. waitingWriters：等待写锁的队列
 *
 * 防止饥饿：
 * - 优先唤醒等待的写者
 * - 避免新读者不断到达导致写者永远等待
 *
 * @package opencode
 * @module util/lock
 */

/**
 * 读写锁命名空间
 *
 * 提供基于键的读写锁功能。
 */
export namespace Lock {
  /**
   * 全局锁状态存储
   *
   * Map 结构：键 -> 锁状态
   *
   * 锁状态包含：
   * - readers：当前持有读锁的数量
   * - writer：是否有写者持有锁
   * - waitingReaders：等待读锁的函数队列
   * - waitingWriters：等待写锁的函数队列
   */
  const locks = new Map<
    string,
    {
      readers: number
      writer: boolean
      waitingReaders: (() => void)[]
      waitingWriters: (() => void)[]
    }
  >()

  /**
   * 获取或创建锁状态
   *
   * 如果键不存在，创建新的锁状态并返回。
   *
   * @param key - 锁的键名
   * @returns 锁状态对象
   */
  function get(key: string) {
    // 如果键不存在，创建新的锁状态
    if (!locks.has(key)) {
      locks.set(key, {
        readers: 0,              // 初始没有读者
        writer: false,           // 初始没有写者
        waitingReaders: [],      // 初始没有等待的读者
        waitingWriters: [],      // 初始没有等待的写者
      })
    }
    // 返回锁状态（非空断言安全，因为上面已处理）
    return locks.get(key)!
  }

  /**
   * 处理锁的唤醒逻辑
   *
   * 在锁释放后，检查并唤醒等待的读者或写者。
   *
   * @param key - 锁的键名
   *
   * 唤醒策略：
   * 1. 如果锁还被持有，不处理
   * 2. 优先唤醒写者（防止写者饥饿）
   * 3. 如果没有等待的写者，唤醒所有等待的读者
   * 4. 清理空闲的锁
   */
  function process(key: string) {
    // 获取锁状态
    const lock = locks.get(key)

    // 如果锁不存在，或仍被持有，不处理
    if (!lock || lock.writer || lock.readers > 0) return

    /**
     * 优先唤醒写者
     *
     * 这样可以防止写者饥饿：
     * - 如果不断有新读者到来，写者可能永远等待
     * - 优先唤醒写者确保写者能及时获取锁
     */
    if (lock.waitingWriters.length > 0) {
      // 取出第一个等待的写者
      const nextWriter = lock.waitingWriters.shift()!
      // 唤醒写者（调用其 resolve 函数）
      nextWriter()
      return
    }

    /**
     * 唤醒所有等待的读者
     *
     * 读锁是共享的，多个读者可以同时持有。
     * 所以一次性唤醒所有等待的读者。
     */
    while (lock.waitingReaders.length > 0) {
      // 取出第一个等待的读者
      const nextReader = lock.waitingReaders.shift()!
      // 唤醒读者
      nextReader()
    }

    /**
     * 清理空闲的锁
     *
     * 如果锁没有被持有，也没有等待者，可以删除。
     * 这样可以节省内存。
     */
    if (
      lock.readers === 0 &&
      !lock.writer &&
      lock.waitingReaders.length === 0 &&
      lock.waitingWriters.length === 0
    ) {
      locks.delete(key)
    }
  }

  /**
   * 获取读锁
   *
   * 如果有写者持有锁或等待的写者，必须等待。
   * 否则立即获取读锁（多个读者可以同时持有）。
   *
   * @param key - 锁的键名
   * @returns Promise，解析为 Disposable 对象（用于释放锁）
   *
   * 获取条件：
   * - 没有写者持有锁
   * - 没有等待的写者（写者优先策略）
   *
   * 使用 using 语法自动释放：
   * ```typescript
   * await using lock = await Lock.read("resource")
   * // 读取操作...
   * // 离开作用域时自动释放
   * ```
   *
   * 手动释放：
   * ```typescript
   * const lock = await Lock.read("resource")
   * try {
   *   // 读取操作...
   * } finally {
   *   lock[Symbol.dispose]()
   * }
   * ```
   */
  export async function read(key: string): Promise<Disposable> {
    // 获取或创建锁状态
    const lock = get(key)

    // 创建 Promise 返回
    return new Promise((resolve) => {
      /**
       * 检查是否可以立即获取读锁
       *
       * 条件：
       * 1. 没有写者持有锁
       * 2. 没有等待的写者（写者优先）
       */
      if (!lock.writer && lock.waitingWriters.length === 0) {
        // 立即获取读锁
        lock.readers++

        // 返回 Disposable 对象用于释放锁
        resolve({
          [Symbol.dispose]: () => {
            // 释放读锁：减少读者计数
            lock.readers--
            // 处理等待队列
            process(key)
          },
        })
      } else {
        /**
         * 不能立即获取，加入等待队列
         *
         * 将 resolve 函数加入等待队列，
         * 当锁可用时会被调用。
         */
        lock.waitingReaders.push(() => {
          // 被唤醒时获取读锁
          lock.readers++

          // 返回 Disposable 对象
          resolve({
            [Symbol.dispose]: () => {
              // 释放读锁
              lock.readers--
              // 处理等待队列
              process(key)
            },
          })
        })
      }
    })
  }

  /**
   * 获取写锁
   *
   * 写锁是独占的，只能有一个写者持有。
   * 如果有读者或写者持有锁，必须等待。
   *
   * @param key - 锁的键名
   * @returns Promise，解析为 Disposable 对象（用于释放锁）
   *
   * 获取条件：
   * - 没有写者持有锁
   * - 没有读者持有锁
   *
   * 写锁特性：
   * - 独占访问，排斥所有读者和写者
   * - 保证数据一致性
   * - 适合修改操作
   *
   * @example
   * ```typescript
   * await using lock = await Lock.write("config")
   * // 修改配置...
   * // 离开作用域时自动释放
   * ```
   */
  export async function write(key: string): Promise<Disposable> {
    // 获取或创建锁状态
    const lock = get(key)

    // 创建 Promise 返回
    return new Promise((resolve) => {
      /**
       * 检查是否可以立即获取写锁
       *
       * 条件：
       * 1. 没有写者持有锁
       * 2. 没有读者持有锁
       */
      if (!lock.writer && lock.readers === 0) {
        // 立即获取写锁
        lock.writer = true

        // 返回 Disposable 对象用于释放锁
        resolve({
          [Symbol.dispose]: () => {
            // 释放写锁：清除写者标志
            lock.writer = false
            // 处理等待队列
            process(key)
          },
        })
      } else {
        /**
         * 不能立即获取，加入等待队列
         *
         * 将 resolve 函数加入等待队列，
         * 当锁可用时会被调用。
         */
        lock.waitingWriters.push(() => {
          // 被唤醒时获取写锁
          lock.writer = true

          // 返回 Disposable 对象
          resolve({
            [Symbol.dispose]: () => {
              // 释放写锁
              lock.writer = false
              // 处理等待队列
              process(key)
            },
          })
        })
      }
    })
  }
}
