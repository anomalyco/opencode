export * as ParallelStorageAnalysis from "./parallel-analysis"

import type { DatabaseMaintenance } from "@opencode-ai/core/database/maintenance"
import { availableParallelism } from "node:os"
import { basename, dirname, extname, join } from "node:path"

declare global {
  const OPENCODE_STORAGE_WORKER_PATH: string
}

export type Phase = "snapshot" | "verify" | "index" | "analyze"

export type Progress = {
  readonly phase: Phase
  readonly completed: number
  readonly total: number
  readonly workers: number
}

type WorkerProgress = Omit<Progress, "workers">

type WorkerMessage<Result> =
  | ({ readonly type: "progress" } & WorkerProgress)
  | { readonly type: "result"; readonly result: Result }
  | { readonly type: "error"; readonly error: { readonly message: string; readonly stack?: string } }

type PrepareResult = {
  readonly snapshots: number
  readonly maximum: number
  readonly malformed: number
}

type WorkerAnalysis = Omit<DatabaseMaintenance.Analysis, "snapshots" | "malformed">

export type Options = {
  readonly workers?: number
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: Progress) => void
}

function workerTarget() {
  if (typeof OPENCODE_STORAGE_WORKER_PATH !== "undefined") return OPENCODE_STORAGE_WORKER_PATH
  return new URL("./worker.ts", import.meta.url)
}

function call<Result>(input: object, signal: AbortSignal | undefined, onProgress: (progress: WorkerProgress) => void) {
  return new Promise<Result>((resolve, reject) => {
    const worker = new Worker(workerTarget())
    const stop = () => worker.terminate()
    const abort = () => {
      stop()
      reject(new DOMException("Storage analysis aborted", "AbortError"))
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener("abort", abort, { once: true })
    worker.onerror = (event) => {
      signal?.removeEventListener("abort", abort)
      stop()
      reject(event.error ?? new Error(event.message))
    }
    worker.onmessage = (event: MessageEvent<WorkerMessage<Result>>) => {
      if (event.data.type === "progress") return onProgress(event.data)
      signal?.removeEventListener("abort", abort)
      stop()
      if (event.data.type === "result") return resolve(event.data.result)
      const error = new Error(event.data.error.message)
      error.stack = event.data.error.stack
      reject(error)
    }
    try {
      worker.postMessage(input)
    } catch (error) {
      signal?.removeEventListener("abort", abort)
      stop()
      reject(error)
    }
  })
}

function empty(): DatabaseMaintenance.Analysis {
  return {
    snapshots: 0,
    inspected: 0,
    candidates: 0,
    projectionMismatches: 0,
    compatibilityRejected: 0,
    malformed: 0,
    payloadBytesReclaimable: 0,
    byType: {},
  }
}

function combine(prepared: PrepareResult, reports: ReadonlyArray<WorkerAnalysis>): DatabaseMaintenance.Analysis {
  return reports.reduce<DatabaseMaintenance.Analysis>(
    (result, report) => ({
      snapshots: prepared.snapshots,
      inspected: result.inspected + report.inspected,
      candidates: result.candidates + report.candidates,
      projectionMismatches: result.projectionMismatches + report.projectionMismatches,
      compatibilityRejected: result.compatibilityRejected + report.compatibilityRejected,
      malformed: prepared.malformed,
      payloadBytesReclaimable: result.payloadBytesReclaimable + report.payloadBytesReclaimable,
      byType: Object.entries(report.byType).reduce(
        (byType, [type, summary]) => ({
          ...byType,
          [type]: {
            events: (byType[type]?.events ?? 0) + summary.events,
            payloadBytesReclaimable: (byType[type]?.payloadBytesReclaimable ?? 0) + summary.payloadBytesReclaimable,
          },
        }),
        { ...result.byType },
      ),
    }),
    empty(),
  )
}

async function removeSnapshot(path: string) {
  await Promise.all(
    [path, `${path}-wal`, `${path}-shm`].map(async (target) => {
      const file = Bun.file(target)
      if (await file.exists()) await file.delete()
    }),
  )
}

export async function analyze(path: string, options: Options = {}) {
  if (path === ":memory:") throw new Error("In-memory databases cannot be analyzed in parallel")
  const desiredWorkers = options.workers ?? availableParallelism() - 1
  const requestedWorkers = Math.max(1, Math.min(8, Number.isSafeInteger(desiredWorkers) ? desiredWorkers : 1))
  const extension = extname(path) || ".db"
  const snapshot = join(
    dirname(path),
    `.${basename(path, extname(path))}.analyze-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`,
  )
  const progress = (value: WorkerProgress, count = requestedWorkers) =>
    options.onProgress?.({ ...value, workers: count })
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener("abort", abort, { once: true })

  try {
    const prepared = await call<PrepareResult>(
      { type: "prepare", source: path, snapshot },
      controller.signal,
      (value) => progress(value, 1),
    )
    if (prepared.maximum === 0) return { ...empty(), snapshots: prepared.snapshots, malformed: prepared.malformed }

    const workers = Math.min(requestedWorkers, prepared.maximum)
    const width = Math.ceil(prepared.maximum / workers)
    const completed = Array.from({ length: workers }, () => 0)
    const reports = await Promise.all(
      completed.map((_, index) => {
        const afterScanID = index * width
        const throughScanID = Math.min(prepared.maximum, afterScanID + width)
        return call<WorkerAnalysis>(
          { type: "analyze", snapshot, afterScanID, throughScanID },
          controller.signal,
          (value) => {
            completed[index] = value.completed
            progress({
              phase: "analyze",
              completed: completed.reduce((sum, item) => sum + item, 0),
              total: prepared.maximum,
            })
          },
        )
      }),
    )
    progress({ phase: "analyze", completed: prepared.maximum, total: prepared.maximum })
    return combine(prepared, reports)
  } catch (error) {
    controller.abort(error)
    throw error
  } finally {
    options.signal?.removeEventListener("abort", abort)
    controller.abort()
    await removeSnapshot(snapshot)
  }
}
