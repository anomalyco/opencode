/**
 * ============================================================================
 * 文件名：queue.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 异步队列和并发控制模块。提供异步队列实现和并发任务执行器。
 *
 * 主要功能：
 * - AsyncQueue：生产者-消费者模式的异步队列
 * - work()：固定并发度的任务执行器
 * - 支持 async iterator 协议
 * - 零拷贝的队列操作
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - AsyncQueue：异步队列类
 * - work(concurrency, items, fn)：并发执行任务
 *
 * 使用场景：
 * - 生产者-消费者模式
 * - 任务调度和工作队列
 * - 速率限制和流量控制
 * - 并发控制（限制同时执行的任务数）
 *
 * 使用示例：
 * ```typescript
 * // AsyncQueue：生产者-消费者
 * const queue = new AsyncQueue<number>()
 *
 * // 生产者：推入项目
 * queue.push(1)
 * queue.push(2)
 * queue.push(3)
 *
 * // 消费者：async iterator
 * for await (const item of queue) {
 *   console.log(item)
 *   // 可以随时 break，不会丢失项目
 *   if (item === 3) break
 * }
 *
 * // 或者使用 next() 手动获取
 * const item1 = await queue.next()
 * const item2 = await queue.next()
 *
 * // work()：并发控制
 * const urls = ["url1", "url2", "url3", "url4", "url5"]
 *
 * // 最多同时执行 3 个请求
 * await work(3, urls, async (url) => {
 *   const response = await fetch(url)
 *   console.log(`Fetched: ${url}`)
 * })
 *
 * // 实际应用：处理文件
 * const files = await glob("**/*.ts")
 * await work(5, files, async (file) => {
 *   await processFile(file)
 * })
 * ```
 *
 * AsyncQueue 特性：
 * - 无界队列（没有大小限制）
 * - 如果有等待的消费者，push() 直接传递给消费者
 * - 如果队列中有项目，next() 立即返回
 * - 否则 next() 等待直到有项目可用
 * - 支持 for-await-of 语法
 *
 * work() 特性：
 * - 固定并发度
 * - 按顺序从数组取任务
 * - 等待所有任务完成
 * - 适合 CPU 密集型和 I/O 密集型任务
 *
 * @package opencode
 * @module util/queue
 */

/**
 * 异步队列类
 *
 * 实现生产者-消费者模式的异步队列。
 * 支持多生产者和多消费者。
 *
 * @template T - 队列中项目的类型
 *
 * 实现细节：
 * - 使用数组存储待处理项目
 * - 使用 Promise resolver 数组存储等待的消费者
 * - push() 时优先唤醒等待的消费者
 * - next() 时优先从队列取项目
 * - 支持 async iterator 协议
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  /**
   * 待处理项目队列
   *
   * 存储 push() 但尚未被消费者取走的项目。
   */
  private queue: T[] = []

  /**
   * 等待的消费者
   *
   * 存储 next() 调用时创建的 Promise resolve 函数。
   * 当有新项目 push 时，会调用这些 resolve。
   */
  private resolvers: ((value: T) => void)[] = []

  /**
   * 推入项目到队列
   *
   * 如果有等待的消费者（resolvers 不为空），
   * 直接将项目传递给第一个等待者。
   * 否则将项目加入队列。
   *
   * @param item - 要推入的项目
   *
   * 时间复杂度：O(1)
   */
  push(item: T) {
    // 获取第一个等待的消费者
    const resolve = this.resolvers.shift()

    // 如果有等待的消费者，直接传递项目
    if (resolve) resolve(item)
    // 否则加入队列
    else this.queue.push(item)
  }

  /**
   * 获取下一个项目
   *
   * 如果队列中有项目，立即返回第一个。
   * 否则创建 Promise 等待直到有项目可用。
   *
   * @returns Promise，解析为下一个项目
   *
   * 时间复杂度：O(1)
   */
  async next(): Promise<T> {
    // 如果队列中有项目，立即返回
    if (this.queue.length > 0) return this.queue.shift()!

    // 否则创建 Promise 等待
    // Promise 的 resolve 函数被加入 resolvers 数组
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  /**
   * 异步迭代器实现
   *
   * 支持使用 for-await-of 语法消费队列。
   * 无限循环，持续从队列获取项目。
   *
   * 使用示例：
   *
   * for await (const item of queue) {
   *   process(item)
   *   if (shouldStop) break
   * }
   * ```
   */
  async *[Symbol.asyncIterator]() {
    // 无限循环，持续等待下一个项目
    while (true) yield await this.next()
  }
}

/**
 * 并发执行任务
 *
 * 使用固定数量的并发工作者执行数组中的所有任务。
 * 适合限制同时进行的异步操作数量。
 *
 * @param concurrency - 并发度（同时执行的最大任务数）
 * @param items - 要处理的项目数组
 * @param fn - 处理每个项目的异步函数
 * @returns Promise，当所有任务完成时 resolve
 *
 * 工作原理：
 * 1. 创建 concurrency 个工作者
 * 2. 每个工作者循环从 items 数组取任务
 * 3. 使用 pop() 从数组末尾移除任务（避免索引冲突）
 * 4. 当数组为空时，工作者退出
 * 5. 等待所有工作者完成
 *
 * @template T - 项目类型
 *
 * 使用场景：
 * - 限制 API 请求速率
 * - 控制文件 I/O 并发
 * - 限制 CPU 密集型任务
 *
 * 注意事项：
 * - 任务执行顺序不保证
 * - 如果一个任务失败，整个操作会失败
 * - items 数组会被修改（pop()）
 */
export async function work<T>(
  concurrency: number,  // 并发度
  items: T[],           // 任务数组
  fn: (item: T) => Promise<void>  // 处理函数
) {
  // 创建数组的副本，因为 pop() 会修改原数组
  const pending = [...items]

  // 创建并发工作者并等待所有完成
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      // 工作者循环
      while (true) {
        // 从数组末尾取任务
        const item = pending.pop()

        // 如果没有更多任务，退出工作者
        if (item === undefined) return

        // 执行任务
        await fn(item)
      }
    }),
  )
}
