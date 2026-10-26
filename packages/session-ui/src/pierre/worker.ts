import { WorkerPoolManager } from "@pierre/diffs/worker"
import DiffsWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url"
import { highlightOptions } from "./index"

function createPool(lineDiffType: "none" | "word-line") {
  const pool = new WorkerPoolManager(
    {
      workerFactory: () => new Worker(DiffsWorkerUrl, { type: "module" }),
      // poolSize defaults to 8. More workers = more parallelism but
      // also more memory. Too many can actually slow things down.
      // NOTE: 2 is probably better for OpenCode, as I think 8 might be
      // a bit overkill, especially because Safari has a significantly slower
      // boot up time for workers
      poolSize: 2,
    },
    {
      ...highlightOptions,
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
