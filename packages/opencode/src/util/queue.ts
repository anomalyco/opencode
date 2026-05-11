export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((result: IteratorResult<T>) => void)[] = []
  private closed = false

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve({ value: item, done: false })
      return
    }
    this.queue.push(item)
  }

  close() {
    if (this.closed) return
    this.closed = true
    while (this.resolvers.length > 0) {
      this.resolvers.shift()!({ value: undefined, done: true })
    }
  }

  drain() {
    if (this.queue.length === 0) return []
    const items = this.queue
    this.queue = []
    return items
  }

  get isClosed() {
    return this.closed
  }

  private async nextResult(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) return { value: this.queue.shift()!, done: false }
    if (this.closed) return { value: undefined, done: true }
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async next(): Promise<T> {
    return (await this.nextResult()).value as T
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.nextResult(),
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
