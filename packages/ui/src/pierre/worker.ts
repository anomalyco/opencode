import ShikiWorkerUrl from "@pierre/precision-diffs/worker/shiki-worker.js?worker&url"

export function workerFactory(): Worker {
  return new Worker(ShikiWorkerUrl, { type: "module" })
}
