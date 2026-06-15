import type { DiffSource, PreparedDiff } from "../components/session-diff"
import type { DiffWorkerRequest, DiffWorkerResponse } from "./protocol"

type WorkerLike = {
  postMessage(message: DiffWorkerRequest): void
  addEventListener(type: "message", listener: (event: MessageEvent<DiffWorkerResponse>) => void): void
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void
}

export class DiffPreparation {
  private static readonly cacheLimit = 16
  private next = 0
  private failed = false
  private readonly cache = new Map<string, Promise<PreparedDiff>>()
  private readonly pending = new Map<
    number,
    { resolve: (value: PreparedDiff) => void; reject: (error: Error) => void }
  >()

  constructor(
    private readonly worker: WorkerLike,
    private readonly onFailure?: () => void,
  ) {
    worker.addEventListener("message", (event: MessageEvent<DiffWorkerResponse>) => {
      const pending = this.pending.get(event.data.id)
      if (!pending) return
      this.pending.delete(event.data.id)
      if ("error" in event.data) {
        pending.reject(new Error(event.data.error))
        return
      }
      pending.resolve(event.data.result)
    })
    const fail = () => {
      if (this.failed) return
      this.failed = true
      for (const pending of this.pending.values()) pending.reject(new Error("diff preparation worker failed"))
      this.pending.clear()
      this.cache.clear()
      this.onFailure?.()
    }
    worker.addEventListener("error", fail)
    worker.addEventListener("messageerror", fail)
  }

  prepare(source: DiffSource) {
    const snapshot = snapshotSource(source)
    const key = sourceKey(snapshot)
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const id = ++this.next
    const request = new Promise<PreparedDiff>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, source: snapshot } satisfies DiffWorkerRequest)
    })
    this.cache.set(key, request)
    request.then(
      () => {
        while (this.cache.size > DiffPreparation.cacheLimit) this.cache.delete(this.cache.keys().next().value!)
      },
      () => this.cache.delete(key),
    )
    return request
  }
}

export function snapshotSource(source: DiffSource): DiffSource {
  return { file: source.file, patch: source.patch, before: source.before, after: source.after }
}

function sourceKey(source: DiffSource) {
  if (source.patch !== undefined) return `${source.file.length}:${source.file}p${source.patch.length}:${source.patch}`
  const before = source.before ?? ""
  const after = source.after ?? ""
  return `${source.file.length}:${source.file}c${before.length}:${before}${after.length}:${after}`
}
