export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private max: number

  constructor(input?: number | { max?: number }) {
    this.max = typeof input === "number" ? input : (input?.max ?? Number.POSITIVE_INFINITY)
  }

  push(item: T, input?: { force?: boolean }) {
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve(item)
      return true
    }

    if (this.queue.length >= this.max) {
      if (!input?.force) return false
      this.queue.push(item)
      return true
    }

    this.queue.push(item)
    return true
  }

  clear() {
    this.queue.length = 0
  }

  size() {
    return this.queue.length
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!
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
