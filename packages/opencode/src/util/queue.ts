export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []

  push(item: T) {
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    while (true) yield await this.next()
  }
}

export interface WorkOptions {
  signal?: AbortSignal
}

export interface WorkResult<T> {
  item: T
  status: "fulfilled" | "rejected"
  error?: Error
}

export async function work<T>(
  concurrency: number,
  items: T[],
  fn: (item: T) => Promise<void>,
  options?: WorkOptions,
): Promise<WorkResult<T>[]> {
  const results: WorkResult<T>[] = []
  const pending = [...items]
  const signal = options?.signal

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (signal?.aborted) return

      const item = pending.shift()
      if (item === undefined) return

      try {
        await fn(item)
        results.push({ item, status: "fulfilled" })
      } catch (err) {
        results.push({
          item,
          status: "rejected",
          error: err instanceof Error ? err : new Error(String(err)),
        })
      }
    }
  })

  if (signal) {
    signal.addEventListener("abort", () => {
      for (const worker of workers) {
        worker.catch(() => {})
      }
    })
  }

  await Promise.all(workers)
  return results
}
