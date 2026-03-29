export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private max: number

  constructor(input?: { max?: number }) {
    this.max = input?.max ?? Number.POSITIVE_INFINITY
  }

  push(item: T, input?: { force?: boolean }) {
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve(item)
      return true
    }
    if (!input?.force && this.queue.length >= this.max) {
      return false
    }
    this.queue.push(item)
    return true
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  clear() {
    this.queue.length = 0
  }

  async *[Symbol.asyncIterator]() {
    while (true) yield await this.next()
  }

  size() {
    return this.queue.length
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
