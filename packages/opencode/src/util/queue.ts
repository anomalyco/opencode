export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T | undefined) => void)[] = []
  private closed = false

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  close() {
    this.closed = true
    for (const resolve of this.resolvers) resolve(undefined)
    this.resolvers.length = 0
  }

  drain() {
    const items = [...this.queue]
    this.queue.length = 0
    return items
  }

  async next(): Promise<T | undefined> {
    if (this.queue.length > 0) return this.queue.shift()!
    if (this.closed) return undefined
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const value = await this.next()
      if (value === undefined) return
      yield value
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
