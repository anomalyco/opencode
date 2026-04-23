export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private closed = false
  private closeSentinel?: T

  get size() {
    return this.queue.length
  }

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  /**
   * Close the queue. Drops any buffered items, resolves any pending consumer
   * immediately with `sentinel`, and ignores further pushes. Used to unblock
   * an iterator from the producer side (e.g. on disconnect) without having
   * to wait for the consumer to drain the backlog.
   */
  close(sentinel: T) {
    if (this.closed) return
    this.closed = true
    this.closeSentinel = sentinel
    this.queue.length = 0
    while (this.resolvers.length > 0) this.resolvers.shift()!(sentinel)
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!
    if (this.closed) return this.closeSentinel as T
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    while (true) yield await this.next()
  }
}

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
