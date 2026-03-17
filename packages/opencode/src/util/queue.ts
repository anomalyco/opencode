/**
 * Async queue implementation with concurrent work processing.
 *
 * Provides an async iterable queue and a concurrent work executor
 * for processing items with limited parallelism.
 *
 * @example
 * ```typescript
 * const queue = new AsyncQueue<number>()
 * queue.push(1)
 * queue.push(2)
 * for await (const item of queue) {
 *   console.log(item)
 * }
 * ```
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []

  /**
   * Pushes an item to the queue.
   * @param item - The item to add to the queue
   */
  push(item: T) {
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  /**
   * Gets the next item from the queue.
   * Waits if the queue is empty.
   * @returns The next item
   */
  async next(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    while (true) yield await this.next()
  }
}

/**
 * Processes items concurrently with limited parallelism.
 *
 * @param concurrency - Maximum number of concurrent workers
 * @param items - Array of items to process
 * @param fn - Async function to process each item
 *
 * @example
 * ```typescript
 * await work(3, urls, async (url) => {
 *   await download(url)
 * })
 * ```
 */
export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop()
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}
