import { constants } from "node:fs"
import { mkdir, lstat, readdir, open } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"

export type DSMLRecoveryAuditInput = {
  sessionID: string
  messageID: string
  providerID: "llmgw"
  modelID: "dsv4"
  disposition: "recovered" | "rejected" | "aborted" | "overflow"
  reason: string
  recoveredCount: number
  nativeCount: number
  candidateCount: number
  sourceHash: string
  gatewayRequestID?: string
  toolNames?: string[]
}

const DEFAULT_DIR = "/home/jsimon/.local/state/opencode/dsml-recovery-audit"
const RECORD_BYTES = 64 * 1024
const REASONS = new Set([
  "undeclared_tool", "tool_choice_none", "invalid_arguments", "invalid_native",
  "malformed_protocol", "missing_finish", "truncated_finish", "upstream_error",
  "unknown_reason", "cancelled", "response_limit", "global_limit", "native_preserved", "empty_vetting_loop",
])
// Existing immutable records retain the closed vocabulary of older workers.
// Only REASONS above can be emitted by the current writer.
const LEGACY_REASONS = new Set([
  "recovered", "complete_invoke", "note_native", "note_only", "unknown_variant", "malformed",
  "validation_unsupported", "validation_failed", "schema_invalid", "schema_transformed", "undeclared_tool",
  "tool_choice", "duplicate_native", "duplicate_parameter", "invalid_json", "lossy_arguments",
  "incomplete", "truncated", "upstream_error", "aborted", "cancelled", "candidate_overflow",
  "response_overflow", "memory_overflow", "handle_overflow", "overflow", "unknown_reason",
  "recovered_complete_invoke", "note_with_native", "malformed_protocol", "tool_choice_none", "invalid_arguments",
  "transformed_arguments", "quoted_protocol", "missing_finish", "truncated_finish", "candidate_limit",
  "response_limit", "global_limit", "native_preserved", "empty_vetting_loop",
])
const identity = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000

// Copy only a closed metadata schema; unknown fields never cross this boundary.
function metadata(input: DSMLRecoveryAuditInput) {
  if (!identity(input.sessionID) || !identity(input.messageID)) return
  if (!(["recovered", "rejected", "aborted", "overflow"] as string[]).includes(input.disposition)) return
  if (![input.recoveredCount, input.nativeCount, input.candidateCount].every(count)) return
  if (typeof input.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(input.sourceHash)) return
  if (input.gatewayRequestID !== undefined && (typeof input.gatewayRequestID !== "string" || !/^[a-f0-9]{16}$/.test(input.gatewayRequestID))) return
  if (input.toolNames !== undefined && (!Array.isArray(input.toolNames) || input.toolNames.length > 256 ||
    input.toolNames.some((name) => typeof name !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(name)))) return
  return {
    source: "opencode-dsml-recovery-audit-v1-20261005",
    createdAt: new Date().toISOString(),
    sessionID: input.sessionID, messageID: input.messageID, providerID: "llmgw", modelID: "dsv4",
    disposition: input.disposition,
    reason: REASONS.has(input.reason) ? input.reason : "unknown_reason",
    recoveredCount: input.recoveredCount, nativeCount: input.nativeCount, candidateCount: input.candidateCount,
    sourceHash: input.sourceHash,
    ...(input.gatewayRequestID === undefined ? {} : { gatewayRequestID: input.gatewayRequestID }),
    ...(input.toolNames === undefined ? {} : { toolNames: [...input.toolNames] }),
  }
}
type Metadata = NonNullable<ReturnType<typeof metadata>>
export type DSMLRecoveryAuditNotice = {
  sessionID: string
  disposition: string
  recoveredCount: number
  outputLoop?: true
  nativePreservedCount?: number
  status: "persisted" | "not_persisted"
  reason: "stored" | "invalid_metadata" | "queue_capacity" | "storage_failure"
  file?: string
}

// A bounded, content-free progress notice; final audit persistence is separate.
export function notifyDSMLBuffering(sessionID: string): void {
  if (!identity(sessionID)) return
  try {
    Effect.runFork(
      Effect.logWarning("Malformed model output detected; waiting for the response to finish before handling pending calls.", {
        sessionID,
      }),
    )
  } catch { /* notification failure must never affect native calls */ }
}

function notify(notice: DSMLRecoveryAuditNotice) {
  const summary = notice.outputLoop
    ? "Model output loop stopped after 16 empty vetting blocks; pending calls not dispatched; earlier calls may already have run; "
    : notice.nativePreservedCount === undefined
    ? `dsv4 recovery ${notice.disposition}; recovered ${notice.recoveredCount}; `
    : `Malformed text was not executed; ${notice.nativePreservedCount} API calls preserved for normal tool handling; `
  const message = summary + `session ${notice.sessionID}; ` +
    (notice.status === "persisted" ? `audit ${notice.file}` : `audit not persisted (${notice.reason})`)
  Effect.runFork(Effect.logWarning("dsv4 recovery audit", { message }).pipe(Effect.annotateLogs(notice)))
}

export function createDSMLRecoveryAudit(options: {
  enabled?: boolean
  directory?: string
  notifier?: (notice: DSMLRecoveryAuditNotice) => void
  writer?: (record: Metadata) => Promise<string>
} = {}) {
  const enabled = () => options.enabled ?? process.env.OPENCODE_DSV4_RECOVERY_ENABLED === "1"
  const writer = options.writer ?? ((record: Metadata) => persist(options.directory ?? DEFAULT_DIR, record))
  const notices = options.notifier ?? notify
  const queue: Metadata[] = []
  const state = { slots: 0, bytes: 0, running: false }
  const send = (notice: DSMLRecoveryAuditNotice) => { try { notices(notice) } catch {} }
  const drain = () => {
    if (state.running) return
    state.running = true
    void Promise.resolve().then(async () => {
      while (queue.length) {
        const record = queue.shift()!
        try {
          const file = await writer(record)
          if (!path.isAbsolute(file)) throw new Error("invalid audit destination")
          send({ sessionID: record.sessionID, disposition: record.disposition, recoveredCount: record.recoveredCount,
            ...(record.reason === "empty_vetting_loop" ? { outputLoop: true as const } : {}),
            ...(record.reason === "native_preserved" ? { nativePreservedCount: record.nativeCount } : {}),
            status: "persisted", reason: "stored", file })
        } catch {
          send({ sessionID: record.sessionID, disposition: record.disposition, recoveredCount: record.recoveredCount,
            ...(record.reason === "empty_vetting_loop" ? { outputLoop: true as const } : {}),
            ...(record.reason === "native_preserved" ? { nativePreservedCount: record.nativeCount } : {}),
            status: "not_persisted", reason: "storage_failure" })
        } finally {
          state.bytes -= Buffer.byteLength(JSON.stringify(record))
          state.slots--
        }
      }
      state.running = false
    })
  }
  return {
    get notice() { return enabled() ? "enabled" : "disabled" },
    stats: () => ({ ...state, queued: queue.length }),
    queue(input: DSMLRecoveryAuditInput): void {
      try {
        if (!enabled() || input.providerID !== "llmgw" || input.modelID !== "dsv4") return
        const record = metadata(input)
        if (!record || Buffer.byteLength(JSON.stringify(record)) > RECORD_BYTES) {
          send({ sessionID: identity(input.sessionID) ? input.sessionID : "unavailable", disposition: "rejected",
            recoveredCount: 0, status: "not_persisted", reason: "invalid_metadata" })
          return
        }
        if (state.slots >= 8) {
          send({ sessionID: record.sessionID, disposition: record.disposition, recoveredCount: record.recoveredCount,
            ...(record.reason === "empty_vetting_loop" ? { outputLoop: true as const } : {}),
            ...(record.reason === "native_preserved" ? { nativePreservedCount: record.nativeCount } : {}),
            status: "not_persisted", reason: "queue_capacity" })
          return
        }
        state.slots++
        state.bytes += Buffer.byteLength(JSON.stringify(record))
        queue.push(record)
        drain()
      } catch { /* Never mask recovery/guard failure with diagnostic failure. */ }
    },
  }
}

async function persist(directory: string, record: Metadata): Promise<string> {
  if (!path.isAbsolute(directory)) throw new Error("audit directory must be absolute")
  // Reject symlinks in the path as well as in existing files. No repair/chmod/delete.
  const parents = directory.split(path.sep).filter(Boolean)
  for (let index = 1; index <= parents.length; index++) {
    const current = path.sep + parents.slice(0, index).join(path.sep)
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (info && !info.isDirectory()) throw new Error("unsafe audit path")
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.())
    throw new Error("audit directory must be private")
  const files = await readdir(directory)
  if (files.length >= 64 || files.some((name) => !/^slot-(?:[0-5][0-9]|6[0-3])\.json$/.test(name)))
    throw new Error("audit capacity or unknown state")
  let bytes = 0
  for (const name of files) {
    const fd = await open(path.join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await fd.stat()
      if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== stat.uid || info.nlink !== 1 ||
        info.size <= 0 || info.size > RECORD_BYTES) throw new Error("invalid audit record")
      bytes += info.size
      const buffer = Buffer.alloc(RECORD_BYTES + 1)
      const read = await fd.read(buffer, 0, buffer.length, 0)
      if (read.bytesRead !== info.size) throw new Error("unstable audit record")
      const existing = JSON.parse(buffer.subarray(0, read.bytesRead).toString("utf8"))
      const clean = metadata(existing)
      if (!clean || existing.source !== clean.source || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(existing.createdAt) ||
        existing.providerID !== "llmgw" || existing.modelID !== "dsv4" || !(REASONS.has(existing.reason) || LEGACY_REASONS.has(existing.reason)) ||
        Object.keys(existing).some((key) => !(key in clean))) throw new Error("invalid audit metadata")
    } finally { await fd.close() }
  }
  const serialized = JSON.stringify(record)
  if (Buffer.byteLength(serialized) > RECORD_BYTES || bytes + Buffer.byteLength(serialized) > 4 * 1024 * 1024)
    throw new Error("audit bytes capacity")
  // One immutable fixed-size slot is one record. O_EXCL coordinates independent
  // clients without deletion, locks, retries or unbounded reservations.
  for (let index = 0; index < 64; index++) {
    const file = path.join(directory, `slot-${String(index).padStart(2, "0")}.json`)
    const fd = await open(file, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") return undefined
      throw error
    })
    if (!fd) continue
    try {
      if (((await fd.stat()).mode & 0o777) !== 0o600) throw new Error("audit file must be private")
      await fd.writeFile(serialized)
      await fd.sync()
    } finally { await fd.close() }
    return file
  }
  throw new Error("audit capacity")
}

const audit = createDSMLRecoveryAudit()
export function queueDSMLRecoveryAudit(input: DSMLRecoveryAuditInput): void { audit.queue(input) }
