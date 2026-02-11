export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private done: (() => void)[] = []
  private closed = false

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  close() {
    this.closed = true
    for (const resolve of this.done) resolve()
    this.done.length = 0
    this.queue.length = 0
  }

  async *[Symbol.asyncIterator]() {
    while (!this.closed) {
      const result = await Promise.race([
        this.next(),
        new Promise<undefined>((resolve) => {
          if (this.closed) return resolve(undefined)
          this.done.push(() => resolve(undefined))
        }),
      ])
      if (result === undefined) return
      yield result
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
