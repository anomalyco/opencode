import { WorkerPoolManager } from "@pierre/diffs/worker"
import ShikiWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url"
import { registerBoltTheme } from "@bolt-ai/ui/context/marked-theme-register"

registerBoltTheme()

export type WorkerPoolStyle = "unified" | "split"

export function workerFactory(): Worker {
  return new Worker(ShikiWorkerUrl, { type: "module" })
}

function createPool(lineDiffType: "none" | "word-alt") {
  const pool = new WorkerPoolManager(
    {
      workerFactory: () => new Worker(DiffsWorkerUrl, { type: "module" }),
      // poolSize defaults to 8. More workers = more parallelism but
      // also more memory. Too many can actually slow things down.
      // NOTE: 2 is probably better for Bolt, as I think 8 might be
      // a bit overkill, especially because Safari has a significantly slower
      // boot up time for workers
      poolSize: 2,
    },
    {
      theme: "Bolt",
      lineDiffType,
      // Pierre renders with the pool's options, not the viewer's, whenever the pool works. The "none" pool only
      // serves diffs above the large-file threshold, so it carries the plain-text fallback the viewer requests.
      ...(lineDiffType === "none" && { maxLineDiffLength: 0, tokenizeMaxLineLength: 1 }),
    },
  )

  void pool.initialize()

  return pool
}

let plain: WorkerPoolManager | undefined

let diff: WorkerPoolManager | undefined

export function getWorkerPool(lineDiffType: "none" | "word-line" = "word-line"): WorkerPoolManager | undefined {
  if (typeof window === "undefined") return

  if (lineDiffType === "none") {
    if (!plain) plain = createPool("none")

    return plain
  }

  if (!diff) diff = createPool("word-line")

  return diff
}
