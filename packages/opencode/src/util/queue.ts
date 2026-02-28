const DONE = Symbol("queue.done")

export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T | typeof DONE) => void)[] = []
  private closed = false

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const resolve of this.resolvers) {
      resolve(DONE)
    }
    this.resolvers.length = 0
    this.queue.length = 0
  }

  drain(): T[] {
    const items = [...this.queue]
    this.queue.length = 0
    return items
  }

  async next(): Promise<T | typeof DONE> {
    if (this.closed) return DONE
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    while (!this.closed) {
      const value = await this.next()
      if (value === DONE) return
      yield value as T
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
