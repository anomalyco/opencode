import { getOrCreateWorkerPoolSingleton } from "@pierre/precision-diffs/worker"
import ShikiWorkerUrl from "@pierre/precision-diffs/worker/worker.js?worker&url"

export function workerFactory(): Worker {
  return new Worker(ShikiWorkerUrl, { type: "module" })
}

export const workerPool = getOrCreateWorkerPoolSingleton({
  poolOptions: {
    workerFactory,
    // poolSize defaults to 8. More workers = more parallelism but
    // also more memory. Too many can actually slow things down.
    // poolSize: 8,
  },
  highlighterOptions: {
    theme: "OpenCode",
    // Optionally preload languages to avoid lazy-loading delays
    // langs: ["typescript", "javascript", "css", "html"],
  },
})
