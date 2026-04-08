export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private idx = 0
  private resolvers: ((value: T) => void)[] = []

  push(item: T) {
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  async next(): Promise<T> {
    if (this.idx < this.queue.length) {
      const item = this.queue[this.idx++]!
      if (this.idx === this.queue.length) {
        this.queue = []
        this.idx = 0
      } else if (this.idx > 1024 && this.idx * 2 >= this.queue.length) {
        this.queue = this.queue.slice(this.idx)
        this.idx = 0
      }
      return item
    }
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
