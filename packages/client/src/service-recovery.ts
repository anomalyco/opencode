export * as ServiceRecovery from "./service-recovery.js"

import { readFile, rename, rm, writeFile } from "node:fs/promises"
import type { Info } from "./service.js"

/** Why and how a client's recovery stopped an unresponsive service, for the next service to log. */
export type Entry = {
  readonly pid: number
  readonly version?: string
  readonly signal: "SIGTERM" | "SIGKILL"
  readonly reason: string
  readonly at: string
}

// The killed service often cannot write anything, and the client may not log to the service's log file,
// so the next service to register reports the kill from this sidecar.
export async function record(file: string, info: Info, signal: Entry["signal"]) {
  const temporary = `${file}.recovery.${crypto.randomUUID()}.tmp`
  await writeFile(
    temporary,
    JSON.stringify({
      pid: info.pid,
      version: info.version,
      signal,
      reason: "/api/info probes timed out",
      at: new Date().toISOString(),
    } satisfies Entry),
    { mode: 0o600, flag: "wx" },
  )
  await rename(temporary, file + ".recovery").finally(() => rm(temporary, { force: true }))
}

/** Read and remove the last recovery record, if any. */
export async function take(file: string): Promise<Entry | undefined> {
  const claimed = `${file}.recovery.${crypto.randomUUID()}.taken`
  const moved = await rename(file + ".recovery", claimed).then(
    () => true,
    () => false,
  )
  if (!moved) return undefined
  const value: unknown = await readFile(claimed, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
    .finally(() => rm(claimed, { force: true }))
  if (typeof value !== "object" || value === null) return undefined
  if (!("pid" in value) || typeof value.pid !== "number") return undefined
  if (!("signal" in value) || (value.signal !== "SIGTERM" && value.signal !== "SIGKILL")) return undefined
  if (!("reason" in value) || typeof value.reason !== "string") return undefined
  if (!("at" in value) || typeof value.at !== "string") return undefined
  return {
    pid: value.pid,
    version: "version" in value && typeof value.version === "string" ? value.version : undefined,
    signal: value.signal,
    reason: value.reason,
    at: value.at,
  }
}
