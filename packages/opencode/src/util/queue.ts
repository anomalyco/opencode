export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private readonly capacity: number | undefined

  constructor(capacity?: number) {
    this.capacity = capacity
  }

  push(item: T) {
    const resolve = this.resolvers.shift()
    if (resolve) return resolve(item)
    this.queue.push(item)
    if (this.capacity !== undefined) while (this.queue.length > this.capacity) this.queue.shift()
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
