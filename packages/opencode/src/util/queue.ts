export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private closed = false
  private sentinel: T
  readonly capacity: number | undefined

  constructor(opts?: { capacity?: number; sentinel?: T }) {
    this.capacity = opts?.capacity
    this.sentinel = opts?.sentinel as T
  }

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else {
      if (this.capacity !== undefined && this.queue.length >= this.capacity) this.queue.shift()
      this.queue.push(item)
    }
  }

  clear() {
    this.queue.length = 0
  }

  close(opts?: { clear?: boolean }) {
    if (this.closed) return
    this.closed = true
    if (opts?.clear) this.clear()
    if (this.sentinel === undefined) return
    if (this.resolvers.length > 0) {
      const list = this.resolvers.splice(0)
      for (const resolve of list) resolve(this.sentinel)
      return
    }
    this.queue.push(this.sentinel)
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!
    if (this.closed) return this.sentinel
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
