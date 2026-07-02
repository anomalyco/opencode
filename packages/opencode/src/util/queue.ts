export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private done = false

  push(item: T) {
    if (this.done) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  close() {
    this.done = true
    for (const resolve of this.resolvers.splice(0)) {
      resolve(undefined as unknown as T)
    }
  }

  async next(): Promise<T> {
    if (this.done) throw new Error("AsyncQueue closed")
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    try {
      while (true) yield await this.next()
    } catch {
      // iteration terminated cleanly via close()
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
