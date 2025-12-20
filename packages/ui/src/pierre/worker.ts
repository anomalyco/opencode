import { getOrCreateWorkerPoolSingleton, WorkerPoolManager } from "@pierre/diffs/worker"
import ShikiWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url"

export function workerFactory(): Worker {
  return new Worker(ShikiWorkerUrl, { type: "module" })
}

export const workerPool: WorkerPoolManager | undefined = (() => {
  if (typeof window === "undefined") {
    return undefined
  }
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory,
      // poolSize defaults to 8. More workers = more parallelism but
      // also more memory. Too many can actually slow things down.
      // NOTE: 2 is probably better for OpenCode, as I think 8 might be
      // a bit overkill, especially because Safari has a significantly slower
      // boot up time for workers
      poolSize: 2,
    },
    highlighterOptions: {
      theme: "OpenCode",
      // Optionally preload languages to avoid lazy-loading delays
      // langs: ["typescript", "javascript", "css", "html"],
    },
  })
})()
