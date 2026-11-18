import { ClientError, type ExperimentalMigrationV1StatusOutput, type OpenCodeClient } from "@opencode/client"
import { scheduler } from "node:timers/promises"
import { isRecord } from "../util/record"

export type MigrationProgress = Extract<ExperimentalMigrationV1StatusOutput, { status: "running" }>["progress"]

export async function pollMigrationStatus(
  read: OpenCodeClient["experimental"]["migration"]["v1"]["status"],
  onProgress: (progress: MigrationProgress | undefined) => void,
  signal: AbortSignal,
  timing?: { interval?: number; retryTimeout?: number },
) {
  const interval = timing?.interval ?? 1_000
  await scheduler.wait(interval, { signal })

  const deadline = new AbortController()
  const requestSignal = AbortSignal.any([signal, deadline.signal])
  const timer = setTimeout(
    () => deadline.abort(new DOMException("Timed out waiting for the data migration status", "TimeoutError")),
    timing?.retryTimeout ?? 30_000,
  )

  try {
    while (true) {
      requestSignal.throwIfAborted()
      const status = await read({ signal: requestSignal }).catch((error: unknown) => {
        if (!(error instanceof ClientError)) throw error
        if (error.reason === "Transport") return undefined
        if (error.reason === "UnexpectedStatus" && isRecord(error.cause) && error.cause.status === 503) return undefined
        throw error
      })
      requestSignal.throwIfAborted()
      if (status) {
        if (status.status === "completed" || status.status === "error") return status
        onProgress(status.status === "running" ? status.progress : undefined)
        // Bound time without a status response, even during a long-running migration.
        timer.refresh()
      }
      await scheduler.wait(interval, { signal: requestSignal })
    }
  } catch (error) {
    requestSignal.throwIfAborted()
    throw error
  } finally {
    clearTimeout(timer)
  }
}
