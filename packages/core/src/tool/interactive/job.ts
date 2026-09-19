export * as InteractiveJob from "./job"

import { Schema } from "effect"
import { NonNegativeInt, statics } from "../../schema"
import { Identifier } from "../../util/identifier"
import { ConfigInteractive } from "../../config/interactive"
import type { SessionSchema } from "../../session/schema"

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const IDSchema = Schema.String.check(Schema.isStartsWith("ijob_")).pipe(Schema.brand("InteractiveJobID"))

/**
 * Job identity (spec R2): `ijob_<ascending>` from `Identifier.ascending`.
 * IDs are Session-scoped — the job store indexes by `(sessionID, jobID)`, and
 * a call from another Session observes `unknown job`. Opaque strings to the
 * model; they do NOT survive a runtime restart (jobs are process-local).
 */
export const ID = IDSchema.pipe(
  statics((schema: typeof IDSchema) => {
    const create = () => schema.make("ijob_" + Identifier.ascending())
    return {
      create,
      ascending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type ID = typeof ID.Type

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

/**
 * All job statuses (spec R5). Alive statuses describe a live process:
 * - `waiting` — quiescent (no new output for the quiet window); it is the
 *   model's move (usually `interactive_write`).
 * - `running` — alive and still producing output; the result was cut at the
 *   chunk cap and elided bytes exist only in the spool.
 * - `timeout` — a bounded `interactive_wait` expired without exit.
 * Terminal statuses end the job (spec R6/I4): exactly one terminal record per
 * job; terminal jobs accept no stdin (spec I3).
 */
export const Status = Schema.Literals(["waiting", "running", "timeout", "done", "failed", "cancelled"])
export type Status = typeof Status.Type

/** Alive statuses: the process lives and later calls may act on the job. */
export const AliveStatus = Schema.Literals(["waiting", "running", "timeout"])
export type AliveStatus = typeof AliveStatus.Type

/** Terminal statuses: `done` (exit 0), `failed` (non-zero exit, signal, spawn failure), `cancelled` (killed with a reason). */
export const TerminalStatus = Schema.Literals(["done", "failed", "cancelled"])
export type TerminalStatus = typeof TerminalStatus.Type

export const isTerminal = (status: Status): status is TerminalStatus =>
  status === "done" || status === "failed" || status === "cancelled"

/**
 * Why a job was cancelled (spec R3/R14/R18/R20/R32). `model` — explicit
 * `interactive_cancel`; `exchanges` — exchange budget exhausted (auto-cancel);
 * `lifetime` — lifetime reaper; `interrupt` — the user interrupted the drain
 * that had a call in flight on the job; `session-close` — runtime shutdown.
 */
export const CancelReason = Schema.Literals(["model", "exchanges", "lifetime", "interrupt", "session-close"])
export type CancelReason = typeof CancelReason.Type

/**
 * Which settle boundary cut the in-flight result (spec R10):
 * `exit`, `quiescence` (quiet window elapsed), `chunk-cap` (result reached
 * `tool_output` bounds), `deadline` (bounded wait expired), `killed`
 * (cancelled or lifetime-reaped). `interactive_cancel` settles after the kill
 * completes rather than at a boundary.
 */
export type SettleBoundary = "exit" | "quiescence" | "chunk-cap" | "deadline" | "killed"

// ---------------------------------------------------------------------------
// Delivery cursor
// ---------------------------------------------------------------------------

/**
 * Byte offset into a job's combined (merged PTY) output stream. Monotonic
 * (spec I6): it advances to the current end even when a chunk is truncated,
 * so elided bytes are never re-embedded in later results — they exist only in
 * the spool file.
 */
export type Cursor = number

// ---------------------------------------------------------------------------
// Shared structured result (spec R3)
// ---------------------------------------------------------------------------

/**
 * The one output shape every method returns (spec R3). `output` is the new
 * output since the previous result (may be ""); `outputPath` always names the
 * managed spool file with the full combined output so far; `exit` is present
 * iff status is `done` | `failed`; `reason` iff `cancelled`; `exchanges` /
 * `exchangesRemaining` report the per-job exchange budget state. Cancel does
 * not increment `exchanges` (spec R18).
 */
export const Result = Schema.Struct({
  jobID: Schema.String,
  status: Status,
  output: Schema.String,
  truncated: Schema.Boolean,
  outputPath: Schema.String,
  exit: Schema.Number.pipe(Schema.optional),
  reason: CancelReason.pipe(Schema.optional),
  exchanges: NonNegativeInt,
  exchangesRemaining: NonNegativeInt,
}).annotate({ identifier: "InteractiveJobResult" })
export type Result = typeof Result.Type

// ---------------------------------------------------------------------------
// Process-local job record
// ---------------------------------------------------------------------------

/**
 * In-memory job record owned by the Location-scoped job store. Not durable:
 * beyond the runner's durable tool-call records, job state (cursor, buffers,
 * process handle) is process-local and dies with the runtime (spec R29/R31).
 * `inFlight` names the tool call currently acting on the job — a second call
 * against the same job fails fast naming it (spec R19).
 */
export interface Job {
  readonly id: ID
  readonly sessionID: SessionSchema.ID
  readonly command: string
  readonly workdir?: string
  readonly status: Status
  readonly exit?: number
  readonly reason?: CancelReason
  /** Settled results consumed so far (spec R18); `cancel` does not increment. */
  readonly exchanges: number
  readonly exchangesRemaining: number
  readonly cursor: Cursor
  /** Managed spool file with the full combined output (`tool_ijob_<id>`). */
  readonly spoolPath: string
  /** Job lifetime in ms; the reaper kills expired jobs (spec R20). */
  readonly lifetimeMs: number
  /** Epoch ms when the child was spawned. */
  readonly startedAt: number
  /** Name of the in-flight interactive call, if any (spec R19). */
  readonly inFlight?: string
}

// ---------------------------------------------------------------------------
// Progress payload (spec R17)
// ---------------------------------------------------------------------------

/**
 * Structured payload published as `Tool.Progress.structured` under an
 * in-flight interactive call only — never for background transitions. The
 * bounded recent tail (≤ `PROGRESS_TAIL_MAX_LINES` lines) rides the event's
 * `content`, honoring `Tool.Progress`'s bounded-cadence contract (published
 * at settle boundaries and at most once per quiet window during long waits).
 */
export interface ProgressPayload {
  readonly jobID: ID
  readonly status: Status
  readonly cursor: Cursor
}

/** Hard cap on the recent tail attached to `Tool.Progress` events (spec R17). */
export const PROGRESS_TAIL_MAX_LINES = 40

// ---------------------------------------------------------------------------
// Budget defaults
// ---------------------------------------------------------------------------

/** Default `interactive.max_jobs` (spec R19). */
export const DEFAULT_MAX_JOBS = 3
/** Default `interactive.max_exchanges` (spec R18). */
export const DEFAULT_MAX_EXCHANGES = 20
/** Default `interactive.quiet_window_ms` (spec R5/R10). */
export const DEFAULT_QUIET_WINDOW_MS = 500
/** Default `interactive.wait_timeout_ms` (spec R13). */
export const DEFAULT_WAIT_TIMEOUT_MS = 120_000
/** Default job lifetime (spec R7/R20). */
export const DEFAULT_JOB_LIFETIME_MS = 900_000
/** Default `interactive.max_spool_bytes` (spec R24). */
export const DEFAULT_MAX_SPOOL_BYTES = 8_388_608
/** SIGTERM → SIGKILL grace, the same 3 s bash uses (spec R14). */
export const KILL_GRACE = "3 seconds"
/** Hard caps re-exported from the config schema for convenience. */
export const MAX_WAIT_TIMEOUT_MS = ConfigInteractive.MAX_WAIT_TIMEOUT_MS
/** Hard cap on the job lifetime in ms (spec R7). */
export const MAX_JOB_LIFETIME_MS = ConfigInteractive.MAX_JOB_LIFETIME_MS
