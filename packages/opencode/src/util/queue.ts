export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T | PromiseLike<T>) => void)[] = []
  private rejecters: ((reason: Error) => void)[] = []
  private closed = false

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    this.rejecters.shift() // Remove corresponding rejecter
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  async next(): Promise<T> {
    if (this.closed) {
      throw new Error("Queue is closed")
    }
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve, reject) => {
      this.resolvers.push(resolve)
      this.rejecters.push(reject)
    })
  }

  close(): T[] {
    this.closed = true
    const error = new Error("Queue closed")
    for (const reject of this.rejecters) {
      reject(error)
    }
    this.resolvers = []
    this.rejecters = []
    // Return remaining items instead of dropping them
    const remaining = this.queue
    this.queue = []
    return remaining
  }

  get isClosed() {
    return this.closed
  }

  async *[Symbol.asyncIterator]() {
    while (!this.closed) {
      try {
        yield await this.next()
      } catch {
        // Queue was closed during iteration
        break
      }
    }
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
