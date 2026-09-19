export * as InteractiveJobs from "./store"

import { Context, Deferred, Duration, Effect, Exit, Layer, Schema, Stream } from "effect"
import { Config } from "../../config"
import { makeLocationNode } from "../../effect/app-node"
import { Location } from "../../location"
import { SessionSchema } from "../../session/schema"
import { ToolOutputStore } from "../../tool-output-store"
import type { CancelReason, Result } from "./job"
import { InteractiveJob, isTerminal } from "./job"
import { InteractiveGovernor } from "./governor"
import { InteractiveLedger } from "./ledger"
import { InteractiveProcess } from "./runtime"
import { InteractiveSpool } from "./spool"

// ---------------------------------------------------------------------------
// Model-facing errors
// ---------------------------------------------------------------------------

/**
 * Unknown job (spec R12): the jobID was never started in this runtime, the
 * runtime restarted since (jobs do not survive restarts), or the jobID is
 * owned by another Session (job IDs are Session-scoped, spec R2).
 */
export class UnknownJobError extends Schema.TaggedErrorClass<UnknownJobError>()(
  "InteractiveJobs.UnknownJobError",
  { jobID: Schema.String },
) {
  override get message() {
    return `Unknown interactive job: ${this.jobID}. Jobs do not survive runtime restarts.`
  }
}

/**
 * Write against a terminal job (spec R12/I3): terminal jobs accept no stdin.
 * Names the terminal status and the spool `outputPath` so the model can page
 * the remaining output with `read`. `wait`/`cancel` on terminal jobs are
 * idempotent successes instead (spec R13/R14).
 */
export class TerminalJobError extends Schema.TaggedErrorClass<TerminalJobError>()(
  "InteractiveJobs.TerminalJobError",
  { jobID: Schema.String, status: Schema.String, outputPath: Schema.String },
) {
  override get message() {
    return `Interactive job ${this.jobID} is already terminal (status: ${this.status}); full output: ${this.outputPath}`
  }
}

/**
 * A second call while another call is in flight for the same job fails fast,
 * naming the in-flight call (spec R19). Calls against one job serialize in
 * the job store.
 */
export class BusyJobError extends Schema.TaggedErrorClass<BusyJobError>()("InteractiveJobs.BusyJobError", {
  jobID: Schema.String,
  call: Schema.String,
}) {
  override get message() {
    return `Interactive job ${this.jobID} has a call in flight (${this.call}); wait for it to settle`
  }
}

/** `interactive_write` with `input: ""` and no `eof: true` (spec R12). */
export class EmptyWriteError extends Schema.TaggedErrorClass<EmptyWriteError>()(
  "InteractiveJobs.EmptyWriteError",
  { jobID: Schema.String },
) {
  override get message() {
    return `Empty interactive_write to ${this.jobID}: include the text to send (with its trailing newline) or set eof: true`
  }
}

/** Everything `start`/`write`/`wait`/`cancel` can fail with, all model-facing. */
export type StoreError =
  | UnknownJobError
  | TerminalJobError
  | BusyJobError
  | EmptyWriteError
  | InteractiveGovernor.TooManyJobsError

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface StartRequest {
  readonly sessionID: SessionSchema.ID
  /** Shell command string, executed like bash's (spec R7). */
  readonly command: string
  /** Defaults to the active Location; relative resolves from it (spec R7). */
  readonly workdir?: string
  /** Job lifetime in ms; default/clamped by the governor (spec R7/R20). */
  readonly timeout?: number
  /** Bounded-cadence progress publisher under the in-flight call (spec R17). */
  readonly onProgress?: (update: ProgressUpdate) => Effect.Effect<void>
}

export interface WriteRequest {
  readonly sessionID: SessionSchema.ID
  readonly jobID: string
  /** Exact bytes appended to the child's stdin; include "\n" yourself (spec R11). */
  readonly input: string
  /** Signal end-of-input after writing (^D on the PTY) (spec R11). */
  readonly eof?: boolean
  /** Bounded-cadence progress publisher under the in-flight call (spec R17). */
  readonly onProgress?: (update: ProgressUpdate) => Effect.Effect<void>
}

export interface WaitRequest {
  readonly sessionID: SessionSchema.ID
  readonly jobID: string
  /** Deadline in ms; default/clamped by the governor (spec R13). */
  readonly timeout?: number
  /** Bounded-cadence progress publisher under the in-flight call (spec R17). */
  readonly onProgress?: (update: ProgressUpdate) => Effect.Effect<void>
}

export interface CancelRequest {
  readonly sessionID: SessionSchema.ID
  readonly jobID: string
  /** Defaults to `"model"` for the tool; the reaper/interrupt paths pass their own (spec R14/R20/R32). */
  readonly reason?: CancelReason
  /** Bounded-cadence progress publisher under the in-flight call (spec R17). */
  readonly onProgress?: (update: ProgressUpdate) => Effect.Effect<void>
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Location-scoped interactive job store: the owner of live jobs, their
 * delivery cursors, spools, and PTY masters (spec R2/R23/R24).
 *
 * Settle contract (spec R10): every method returns at the FIRST matching
 * boundary — `exit`, `quiescence` (quiet window), `chunk-cap` (`tool_output`
 * bounds), `deadline` (bounded wait), or `killed` — and each returned
 * `Result` carries the new output since the previous result plus budget
 * state. There is deliberately NO read/poll method (invariant I2): output is
 * a side effect of acting on the job.
 *
 * Auto-feed (spec R15): every returned result is an ordinary local tool
 * settlement, so the existing V2 runner continuation (durable settlement →
 * `needsContinuation` → next provider turn after reloading projected
 * history) IS the auto-feed cycle. No runner change, no synthetic input, and
 * this service needs no continuation flag — background transitions publish
 * nothing and wait for the next call (spec R16/R17).
 *
 * Serialization (spec R19): calls against one job serialize; a second
 * concurrent call fails fast with `BusyJobError`.
 */
export interface Interface {
  /**
   * Assert permissions happened in the tool; here: governor admission (spec
   * R9), PTY spawn (spec R22), ledger row (spec R30), then settle at the
   * first boundary (spec R10). Spawn failure settles as `failed` with the
   * message in `output` (spec R8).
   */
  readonly start: (request: StartRequest) => Effect.Effect<Result, StoreError>
  /**
   * Append `input` to the child's stdin, optionally signal EOF, then settle
   * at the first boundary. Empty write without `eof` fails (`EmptyWriteError`);
   * terminal/unknown jobs fail per `TerminalJobError`/`UnknownJobError`
   * (spec R11/R12).
   */
  readonly write: (request: WriteRequest) => Effect.Effect<Result, StoreError>
  /**
   * Block for exit until the effective deadline; `timeout` status when it
   * expires alive. Replays an already-terminal job idempotently with empty
   * new output (spec R13).
   */
  readonly wait: (request: WaitRequest) => Effect.Effect<Result, StoreError>
  /**
   * Kill the process group (SIGTERM → SIGKILL after the 3 s grace, close the
   * PTY), mark `cancelled` with the reason (default `"model"`), and return
   * the final drained output. Idempotent on terminal jobs (spec R14). Does
   * not consume an exchange (spec R18).
   */
  readonly cancel: (request: CancelRequest) => Effect.Effect<Result, StoreError>
  /**
   * Drain-interrupt support (spec R32/I10): kill exactly the jobs of this
   * Session that had a call in flight, marking them `cancelled` with the
   * given reason (normally `"interrupt"`); jobs without in-flight calls are
   * untouched.
   */
  readonly cancelInFlight: (request: { readonly sessionID: SessionSchema.ID; readonly reason: CancelReason }) => Effect.Effect<void>
  /**
   * Runtime shutdown (spec R23/R32): kill every live job of the Location
   * with `reason: "session-close"`. Normally registered as a Location
   * finalizer rather than called explicitly.
   */
  readonly killAll: (request: { readonly reason: CancelReason }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/InteractiveJobs") {}

/**
 * One bounded progress update under an in-flight call (spec R17): the
 * `Tool.Progress` structured payload is exactly `{ jobID, status, cursor }`,
 * and `tail` carries the bounded recent output (≤ PROGRESS_TAIL_MAX_LINES
 * lines) that rides the event's `content`.
 */
export interface ProgressUpdate {
  readonly jobID: InteractiveJob.ID
  readonly status: InteractiveJob.Status
  readonly cursor: InteractiveJob.Cursor
  readonly tail: string
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** How long the final drain waits for in-flight output bytes after exit/kill. */
const DRAIN_MS = 10
/**
 * Minimum a quiescence verdict observes the job before concluding: a
 * synchronous exit finalizes in ~DRAIN_MS, and the exit boundary must win the
 * settle race against an already-quiet window (spec R10).
 */
const MIN_QUIET_OBSERVE_MS = 25

/** The settle boundary that cut an alive result (spec R10). */
type Boundary =
  | { readonly _tag: "exit"; readonly chunk: InteractiveSpool.Chunk }
  | { readonly _tag: "killed"; readonly reason?: CancelReason; readonly chunk: InteractiveSpool.Chunk }
  | { readonly _tag: "quiescence"; readonly chunk: InteractiveSpool.Chunk }
  | { readonly _tag: "chunk-cap"; readonly chunk: InteractiveSpool.Chunk }
  | { readonly _tag: "deadline"; readonly chunk: InteractiveSpool.Chunk }

const ALIVE_SETTLE_STATUS = {
  quiescence: "waiting",
  "chunk-cap": "running",
  deadline: "timeout",
} as const satisfies Record<Exclude<Boundary["_tag"], "exit" | "killed">, InteractiveJob.AliveStatus>

/** Process-local live job owned by the store (see InteractiveJob.Job for the durable shape). */
interface Live {
  readonly id: InteractiveJob.ID
  readonly sessionID: SessionSchema.ID
  readonly command: string
  readonly spoolPath: string
  readonly lifetimeMs: number
  readonly startedAt: number
  readonly child: InteractiveProcess.Child
  /** Total output bytes seen by the pump (stored or not); drives quiescence. */
  received: number
  /** Chunks taken from the child but not yet written to the spool. */
  pending: number
  /** Guards the single exit finalization (the settle loop and watcher race). */
  exitFinalized: boolean
  /** Epoch ms of the last output chunk; quiescence = quietWindow since this. */
  lastByteAt: number
  /** Completed and replaced by the pump per output chunk; wakes settle waiters. */
  activity: Deferred.Deferred<void>
  /** Sticky: the spool stopped storing past interactive.max_spool_bytes (spec R24). */
  spoolCapped: boolean
  status: InteractiveJob.Status
  exit?: number
  reason?: CancelReason
  exchanges: number
  cursor: InteractiveJob.Cursor
  /**
   * Registered synchronously when a call effect is CONSTRUCTED, so a forked
   * first call owns the job before a later-constructed contender executes —
   * Effect fiber scheduling alone cannot order that race (spec R19).
   */
  intent?: string
  /** Call currently executing against the job (spec R19). */
  inFlight?: string
  /** Completed when the child exits and the final output is drained. */
  readonly terminal: Deferred.Deferred<void>
  /** Completed as soon as a kill begins; carries the cancel reason (spec R10). */
  readonly killed: Deferred.Deferred<CancelReason>
  /** Final drained output captured by the exit watcher, pending delivery (spec R10). */
  terminalChunk?: InteractiveSpool.Chunk
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const runtime = yield* InteractiveProcess.Service
    const spool = yield* InteractiveSpool.Service
    const governor = yield* InteractiveGovernor.Service
    const ledger = yield* InteractiveLedger.Service
    const config = yield* Config.Service
    const location = yield* Location.Service

    // startup sweep (spec R30/I9): kill every ledger-recorded orphan process
    // group before this Location can spawn any new job; best-effort, a failing
    // sweep must not keep the Location's job store from booting
    yield* ledger.sweep().pipe(Effect.ignore)

    const context = yield* Effect.context()
    const runFork = Effect.runForkWith(context)

    const jobs = new Map<string, Live>()

    const defaultShell = () => (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh")

    const shell = Effect.fn("InteractiveJobs.shell")(function* () {
      const entries = yield* config.entries().pipe(Effect.catch(() => Effect.succeed([] as Config.Entry[])))
      return Config.latest(entries, "shell") ?? defaultShell()
    })

    const outputLimits = Effect.fn("InteractiveJobs.outputLimits")(function* () {
      const entries = yield* config.entries().pipe(Effect.catch(() => Effect.succeed([] as Config.Entry[])))
      const limits = Config.latest(entries, "tool_output")
      return {
        maxLines: limits?.max_lines ?? ToolOutputStore.MAX_LINES,
        maxBytes: limits?.max_bytes ?? ToolOutputStore.MAX_BYTES,
      }
    })

    const requireJob = (sessionID: SessionSchema.ID, jobID: string) => {
      const live = jobs.get(jobID)
      // Session-scoped ids (spec R2): a job of another Session reads as unknown
      if (!live || live.sessionID !== sessionID) return Effect.fail(new UnknownJobError({ jobID }))
      return Effect.succeed(live)
    }

    const liveJobIDs = (sessionID: SessionSchema.ID) =>
      [...jobs.values()].filter((live) => live.sessionID === sessionID && !isTerminal(live.status)).map((live) => live.id)

    // -- job plumbing ---------------------------------------------------------

    const advance = (live: Live, nextCursor: number) => {
      // monotonic delivery cursor (spec I6)
      if (nextCursor > live.cursor) live.cursor = nextCursor
    }

    const slicePending = Effect.fn("InteractiveJobs.slicePending")(function* (live: Live, limits: { maxLines: number; maxBytes: number }) {
      const chunk = yield* spool.slice(live.id, live.cursor, undefined, limits).pipe(Effect.orDie)
      // "cut" is the chunk-cap boundary; a truncated EMPTY slice only means the
      // cursor points at bytes elided by an earlier capped read
      return { ...chunk, cut: chunk.text !== "" && chunk.truncated }
    })

    const drainedChunk = Effect.fn("InteractiveJobs.drainedChunk")(function* (live: Live, limits: { maxLines: number; maxBytes: number }) {
      let baseline = live.received - 1
      while (live.received !== baseline) {
        baseline = live.received
        yield* Effect.sleep(Duration.millis(DRAIN_MS))
      }
      const chunk = yield* slicePending(live, limits)
      advance(live, chunk.nextCursor)
      return chunk
    })

    const killJob = Effect.fn("InteractiveJobs.killJob")(function* (live: Live, reason: CancelReason) {
      if (isTerminal(live.status)) return
      // the cancelled status wins the terminal race before the exit watcher fires (spec I4)
      live.status = "cancelled"
      live.reason = reason
      yield* ledger.remove(live.id).pipe(Effect.orDie)
      yield* Deferred.done(live.killed, Exit.succeed(reason))
      yield* live.child.kill(InteractiveJob.KILL_GRACE).pipe(Effect.ignore)
    })

    /**
     * Single exit finalization; the settle loop and the background watcher
     * both call it, so the claim flag is checked and set synchronously (spec I4).
     */
    const finalizeExit = (live: Live, status: InteractiveProcess.ExitStatus) =>
      Effect.suspend(() => {
        if (live.exitFinalized || isTerminal(live.status)) return Effect.void
        live.exitFinalized = true
        return Effect.gen(function* () {
          const limits = yield* outputLimits()
          const chunk = yield* drainedChunk(live, limits)
          // a kill that landed during the drain owns the terminal state; still
          // release the terminal waiter so no settle fiber parks on it forever
          if (live.status === "cancelled") {
            yield* Deferred.done(live.terminal, Exit.void)
            return
          }
          live.status = status.signal !== undefined || (status.exitCode ?? 1) !== 0 ? "failed" : "done"
          if (status.signal === undefined && status.exitCode !== undefined) live.exit = status.exitCode
          // park the drained tail so the exit-boundary result can deliver it
          live.terminalChunk = chunk
          yield* ledger.remove(live.id).pipe(Effect.orDie)
          yield* Deferred.done(live.terminal, Exit.void)
        })
      })

    /**
     * Race participant: observe the exit (the raw signal beats quiescence —
     * R10 settles at exit "while alive"), finalize under the claim, and wait
     * for whichever fiber completed the terminal record, so a settled result
     * never builds against an un-finalized status (spec I4).
     */
    const waitForTerminal = (live: Live) =>
      Effect.gen(function* () {
        yield* finalizeExit(live, yield* live.child.exit)
        yield* Deferred.await(live.terminal)
      }).pipe(Effect.as("exit" as const))

    /** Single exit finalizer per job: keeps done/failed and cancelled from racing (spec I4). */
    const exitWatcher = (live: Live) => live.child.exit.pipe(Effect.flatMap((status) => finalizeExit(live, status)), Effect.ignore)

    const reaper = (live: Live) =>
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(live.lifetimeMs))
        yield* killJob(live, "lifetime")
      }).pipe(Effect.ignore)

    const pump = (live: Live) =>
      live.child.output.pipe(
        Stream.runForEach((bytes) =>
          Effect.gen(function* () {
            live.pending += 1
            const appended = yield* spool.append(live.id, bytes).pipe(
              Effect.orDie,
              Effect.ensuring(Effect.sync(() => {
                live.pending -= 1
              })),
            )
            // bump after the bytes are readable in the file, so a quiescence
            // poll that observes the bump also observes the bytes
            live.received += bytes.length
            live.lastByteAt = Date.now()
            if (appended.capped) live.spoolCapped = true
            // replace before completing, so new awaiters wait for genuinely
            // newer output instead of the just-signalled chunk
            const current = live.activity
            live.activity = Deferred.makeUnsafe<void>()
            Deferred.doneUnsafe(current, Effect.void)
          }),
        ),
        // the pump ends when the child's output stream is ended or the fiber is
        // interrupted — never rely on shutdown as a completion signal
        Effect.ignore,
      )

    // -- in-flight serialization (spec R19) -----------------------------------

    const preClaim = (sessionID: SessionSchema.ID, jobID: string, call: string) => {
      const live = jobs.get(jobID)
      if (
        !live ||
        live.sessionID !== sessionID ||
        isTerminal(live.status) ||
        live.inFlight !== undefined ||
        live.intent !== undefined
      )
        return { live: undefined as Live | undefined, mine: false, release: Effect.void }
      live.intent = call
      return {
        live,
        mine: true,
        release: Effect.sync(() => {
          live.intent = undefined
          live.inFlight = undefined
        }),
      }
    }

    /**
     * Atomically checks that the job is free and takes the call's claim in one
     * synchronous step, so no contender can interleave between check and claim
     * (spec R19). The caller must release via `release(live)` — on EVERY exit,
     * including the non-mine path that found the job free, or the job stays
     * permanently busy after an interrupted settle.
     */
    const claimOrBusy = (live: Live, jobID: string, call: string, mine: boolean): Effect.Effect<void, BusyJobError> =>
      Effect.suspend(() => {
        if (live.inFlight !== undefined || (live.intent !== undefined && !mine))
          return Effect.fail(new BusyJobError({ jobID, call: live.inFlight ?? live.intent ?? "unknown" }))
        live.intent = undefined
        live.inFlight = call
        return Effect.void
      })

    const release = (live: Live) =>
      Effect.sync(() => {
        live.inFlight = undefined
      })

    // -- settle engine (spec R10) ---------------------------------------------

    const terminalBoundary = Effect.fn("InteractiveJobs.terminalBoundary")(function* (live: Live, limits: { maxLines: number; maxBytes: number }) {
      const parked = live.terminalChunk
      const chunk = parked ?? (yield* drainedChunk(live, limits))
      live.terminalChunk = undefined
      return live.status === "cancelled"
        ? { _tag: "killed", reason: live.reason, chunk } satisfies Boundary
        : { _tag: "exit", chunk } satisfies Boundary
    })

    /** Returns once no new output arrived for the quiet window (spec R5/R10). */
    const waitForQuiet = (live: Live, quietMs: number) =>
      Effect.gen(function* () {
        // let offers already made by the child reach the pump before judging quiet
        yield* Effect.sleep(Duration.millis(1))
        const entered = Date.now()
        while (true) {
          const remaining = quietMs - (Date.now() - live.lastByteAt)
          const observed = Date.now() - entered
          if (remaining <= 0 && live.pending === 0 && observed >= MIN_QUIET_OBSERVE_MS) return
          const active = yield* Effect.race(
            Effect.sleep(Duration.millis(Math.max(1, remaining, MIN_QUIET_OBSERVE_MS - observed))).pipe(
              Effect.as(false as const),
            ),
            Deferred.await(live.activity).pipe(Effect.as(true as const)),
          )
          // an activity wake can be stale (raced against its own completion);
          // the loop re-reads lastByteAt and falls through when already quiet
          if (!active && live.pending === 0 && Date.now() - entered >= MIN_QUIET_OBSERVE_MS) return
        }
      })

    /** Settle loop for `start`/`write`: first of exit, killed, chunk cap, quiescence. */
    const settleProduce = Effect.fn("InteractiveJobs.settleProduce")(function* (live: Live) {
      const limits = yield* outputLimits()
      const quietMs = (yield* governor.budgets()).quietWindowMs
      while (true) {
        const pending = yield* slicePending(live, limits)
        if (pending.cut) {
          advance(live, pending.nextCursor)
          return { _tag: "chunk-cap", chunk: pending } satisfies Boundary
        }
        if (isTerminal(live.status)) return yield* terminalBoundary(live, limits)
        const woke = yield* Effect.raceAll([
          waitForTerminal(live),
          Deferred.await(live.killed).pipe(Effect.as("killed" as const)),
          waitForQuiet(live, quietMs).pipe(Effect.as("quiet" as const)),
        ])
        if (woke !== "quiet") return yield* terminalBoundary(live, limits)
        const fresh = yield* slicePending(live, limits)
        advance(live, fresh.nextCursor)
        if (fresh.cut) return { _tag: "chunk-cap", chunk: fresh } satisfies Boundary
        return { _tag: "quiescence", chunk: fresh } satisfies Boundary
      }
    })

    /** Settle loop for `wait`: first of exit, killed, chunk cap, deadline (spec R10/R13). */
    const settleWait = Effect.fn("InteractiveJobs.settleWait")(function* (
      live: Live,
      deadlineMs: number,
      onProgress: WaitRequest["onProgress"],
    ) {
      const limits = yield* outputLimits()
      const quietMs = (yield* governor.budgets()).quietWindowMs
      const deadline = Date.now() + deadlineMs
      let lastPublish = 0
      while (true) {
        const pending = yield* slicePending(live, limits)
        if (pending.cut) {
          advance(live, pending.nextCursor)
          return { _tag: "chunk-cap", chunk: pending } satisfies Boundary
        }
        if (isTerminal(live.status)) return yield* terminalBoundary(live, limits)
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          advance(live, pending.nextCursor)
          return { _tag: "deadline", chunk: pending } satisfies Boundary
        }
        const woke = yield* Effect.raceAll([
          waitForTerminal(live),
          Deferred.await(live.killed).pipe(Effect.as("killed" as const)),
          Deferred.await(live.activity).pipe(Effect.as("activity" as const)),
          Effect.sleep(Duration.millis(remaining)).pipe(Effect.as("deadline" as const)),
        ])
        if (woke === "deadline") {
          const fresh = yield* slicePending(live, limits)
          advance(live, fresh.nextCursor)
          if (fresh.cut) return { _tag: "chunk-cap", chunk: fresh } satisfies Boundary
          return { _tag: "deadline", chunk: fresh } satisfies Boundary
        }
        if (woke !== "activity") return yield* terminalBoundary(live, limits)
        // at most one progress publish per quiet window during long waits (spec R17)
        if (Date.now() - lastPublish < quietMs) continue
        lastPublish = Date.now()
        const interim = yield* slicePending(live, limits)
        if (interim.text !== "" && !interim.cut) yield* publishProgress(onProgress, live, "running", interim.text)
      }
    })

    // -- accounting and result building ---------------------------------------

    const consume = Effect.fn("InteractiveJobs.consumeExchange")(function* (live: Live) {
      const decision = yield* governor.consumeExchange(live.id, live.exchanges)
      if (decision._tag === "Exhausted")
        return { exchanges: live.exchanges, exchangesRemaining: 0, exhausted: true as const }
      live.exchanges += 1
      return { exchanges: live.exchanges, exchangesRemaining: decision.exchangesRemaining, exhausted: false as const }
    })

    const buildResult = (
      live: Live,
      input: {
        readonly status: InteractiveJob.Status
        readonly chunk: InteractiveSpool.Chunk
        readonly exit?: number
        readonly reason?: CancelReason
        readonly exchanges: number
        readonly exchangesRemaining: number
      },
    ): Result => ({
      jobID: live.id,
      status: input.status,
      output: input.chunk.text,
      truncated: input.chunk.truncated || live.spoolCapped,
      outputPath: live.spoolPath,
      exit: input.exit,
      reason: input.reason,
      exchanges: input.exchanges,
      exchangesRemaining: input.exchangesRemaining,
    })

    const settleOutcome = Effect.fn("InteractiveJobs.settleOutcome")(function* (live: Live, boundary: Boundary) {
      const budgets = yield* governor.budgets()
      const remaining = Math.max(0, budgets.maxExchanges - live.exchanges)
      if (boundary._tag === "killed") {
        // kills and the cancel tool never consume an exchange (spec R18)
        return buildResult(live, {
          status: "cancelled",
          reason: boundary.reason ?? live.reason,
          chunk: boundary.chunk,
          exchanges: live.exchanges,
          exchangesRemaining: remaining,
        })
      }
      if (boundary._tag === "exit") {
        const consumed = yield* consume(live)
        return buildResult(live, {
          status: live.status,
          exit: live.exit,
          chunk: boundary.chunk,
          exchanges: consumed.exchanges,
          exchangesRemaining: consumed.exchangesRemaining,
        })
      }
      const consumed = yield* consume(live)
      if (!consumed.exhausted) {
        return buildResult(live, {
          status: ALIVE_SETTLE_STATUS[boundary._tag],
          chunk: boundary.chunk,
          exchanges: consumed.exchanges,
          exchangesRemaining: consumed.exchangesRemaining,
        })
      }
      // the budget would be exceeded: auto-cancel instead of settling (spec R18/I8)
      yield* killJob(live, "exchanges")
      const limits = yield* outputLimits()
      const final = yield* drainedChunk(live, limits)
      return buildResult(live, {
        status: "cancelled",
        reason: "exchanges",
        chunk: final,
        exchanges: consumed.exchanges,
        exchangesRemaining: 0,
      })
    })

    // -- progress (spec R17) ----------------------------------------------------

    const tailLines = (text: string) => {
      const lines = text.split("\n")
      return lines.length <= InteractiveJob.PROGRESS_TAIL_MAX_LINES
        ? text
        : lines.slice(-InteractiveJob.PROGRESS_TAIL_MAX_LINES).join("\n")
    }

    const publishProgress = (
      onProgress: WaitRequest["onProgress"],
      live: Live,
      status: InteractiveJob.Status,
      output: string,
    ) =>
      onProgress
        ? onProgress({ jobID: live.id, status, cursor: live.cursor, tail: tailLines(output) }).pipe(Effect.ignore)
        : Effect.void

    // -- operations -------------------------------------------------------------

    // Slots reserved by in-flight `start` calls whose job is not yet registered
    // in `jobs`; without them two concurrent starts could both pass the
    // max_jobs check and oversubscribe the Session (spec R9 TOCTOU).
    const pending = new Map<SessionSchema.ID, number>()

    /** Check-and-reserve one max_jobs slot in a single synchronous step (spec R9). */
    const admitStart = (sessionID: SessionSchema.ID, limit: number) =>
      Effect.suspend(() => {
        const live = liveJobIDs(sessionID)
        if (live.length + (pending.get(sessionID) ?? 0) >= limit)
          return Effect.fail(new InteractiveGovernor.TooManyJobsError({ liveJobIDs: live }))
        pending.set(sessionID, (pending.get(sessionID) ?? 0) + 1)
        return Effect.void
      })

    /** Drops the reserved slot; the live job counts through `liveJobIDs` from here on. */
    const releaseStart = (sessionID: SessionSchema.ID) =>
      Effect.sync(() => {
        const count = (pending.get(sessionID) ?? 0) - 1
        if (count <= 0) pending.delete(sessionID)
        else pending.set(sessionID, count)
      })

    const start = Effect.fn("InteractiveJobs.start")(function* (request: StartRequest) {
      const budgets = yield* governor.budgets()
      yield* admitStart(request.sessionID, budgets.maxJobs)
      let registered = false
      return yield* Effect.gen(function* () {
        const id = InteractiveJob.ID.create()
        // the spool exists before the child spawns, so every result names a real file (spec R24)
        const spoolPath = yield* spool.open(id).pipe(Effect.orDie)
        const spawned = yield* runtime
          .spawn({ command: request.command, shell: yield* shell(), cwd: request.workdir ?? location.directory })
          .pipe(Effect.catch((spawnError) => Effect.succeed({ spawnError })))
        // spawn failure settles as a terminal `failed` result, not an opaque error (spec R8)
        if ("spawnError" in spawned) {
          return {
            jobID: id,
            status: "failed" as const,
            output: spawned.spawnError.message,
            truncated: false,
            outputPath: spoolPath,
            exchanges: 1,
            exchangesRemaining: Math.max(0, budgets.maxExchanges - 1),
          }
        }
        const child = spawned
        const startedAt = Date.now()
        const live: Live = {
          id,
          sessionID: request.sessionID,
          command: request.command,
          spoolPath,
          lifetimeMs: yield* governor.lifetimeMs(request.timeout),
          startedAt,
          child,
          received: 0,
          pending: 0,
          exitFinalized: false,
          lastByteAt: Date.now(),
          activity: Deferred.makeUnsafe<void>(),
          spoolCapped: false,
          status: "running",
          // claimed from birth: an interrupt mid-settle must observe this call
          // as in flight (spec R19/I10)
          inFlight: "interactive_start",
          exchanges: 0,
          cursor: 0,
          terminal: yield* Deferred.make<void>(),
          killed: yield* Deferred.make<CancelReason>(),
        }
        jobs.set(id, live)
        registered = true
        // the live job counts through `liveJobIDs` from here; a sync effect
        // adds no scheduling point, so this stays atomic with the registration
        yield* releaseStart(request.sessionID)
        // the pump must subscribe before the child can produce and exit — its
        // first bytes otherwise die with the queue's shutdown (spec R23/R24)
        runFork(pump(live))
        runFork(exitWatcher(live))
        runFork(reaper(live))
        yield* ledger.record({ jobID: id, sessionID: request.sessionID, pgid: child.pgid, startedAt }).pipe(Effect.orDie)
        const boundary = yield* settleProduce(live).pipe(Effect.ensuring(release(live)))
        const result = yield* settleOutcome(live, boundary)
        yield* publishProgress(request.onProgress, live, result.status, result.output)
        return result
      }).pipe(
        // the reserved slot is needed only until the job registers or the
        // attempt ends without a live job (spec R9)
        Effect.onExit(() =>
          Effect.sync(() => {
            if (!registered) releaseStart(request.sessionID)
          }),
        ),
      )
    })

    const writeRun = Effect.fn("InteractiveJobs.writeRun")(function* (request: WriteRequest, intent: ReturnType<typeof preClaim>) {
      const live =       yield* requireJob(request.sessionID, request.jobID)
      if (request.input === "" && request.eof !== true) return yield* new EmptyWriteError({ jobID: request.jobID })
      if (isTerminal(live.status)) {
        // a kill that landed between construction and execution settles the pre-claimed call (spec R32)
        if (intent.mine && live.status === "cancelled") return yield* killedResult(live, request.onProgress)
        return yield* new TerminalJobError({ jobID: request.jobID, status: live.status, outputPath: live.spoolPath })
      }
      const body = Effect.gen(function* () {
        // skip the append for an eof-only write: "" is not real stdin (spec R11)
        if (request.input !== "") yield* live.child.write(request.input).pipe(Effect.ignore)
        if (request.eof) yield* live.child.signalEof()
        return yield* settleProduce(live)
      })
      // claim runs in the same synchronous step as the busy check; the claim is
      // released on every exit, non-mine included — otherwise an interrupted
      // settle would leave the job permanently busy (spec R19)
      const boundary = yield* claimOrBusy(live, request.jobID, "interactive_write", intent.mine).pipe(
        Effect.flatMap(() => body.pipe(Effect.ensuring(release(live)))),
      )
      const result = yield* settleOutcome(live, boundary)
      yield* publishProgress(request.onProgress, live, result.status, result.output)
      return result
    })

    const write = (request: WriteRequest): Effect.Effect<Result, StoreError> => {
      const intent = preClaim(request.sessionID, request.jobID, "interactive_write")
      const run = Effect.suspend(() => writeRun(request, intent))
      return intent.mine ? run.pipe(Effect.ensuring(intent.release)) : run
    }

    const waitRun = Effect.fn("InteractiveJobs.waitRun")(function* (request: WaitRequest, intent: ReturnType<typeof preClaim>) {
      const live = yield* requireJob(request.sessionID, request.jobID)
      if (isTerminal(live.status)) {
        if (intent.mine && live.status === "cancelled") return yield* killedResult(live, request.onProgress)
        const consumed = yield* consume(live)
        // terminal replay is idempotent with empty new output (spec R13)
        const result = buildResult(live, {
          status: live.status,
          exit: live.exit,
          reason: live.reason,
          chunk: { text: "", truncated: false, nextCursor: live.cursor },
          exchanges: consumed.exchanges,
          exchangesRemaining: consumed.exchangesRemaining,
        })
        yield* publishProgress(request.onProgress, live, result.status, result.output)
        return result
      }
      const deadlineMs = yield* governor.waitDeadlineMs(request.timeout)
      const body = Effect.gen(function* () {
        return yield* settleWait(live, deadlineMs, request.onProgress)
      })
      // claim runs in the same synchronous step as the busy check; the claim is
      // released on every exit, non-mine included (spec R19)
      const boundary = yield* claimOrBusy(live, request.jobID, "interactive_wait", intent.mine).pipe(
        Effect.flatMap(() => body.pipe(Effect.ensuring(release(live)))),
      )
      const result = yield* settleOutcome(live, boundary)
      yield* publishProgress(request.onProgress, live, result.status, result.output)
      return result
    })

    const wait = (request: WaitRequest): Effect.Effect<Result, StoreError> => {
      const intent = preClaim(request.sessionID, request.jobID, "interactive_wait")
      const run = Effect.suspend(() => waitRun(request, intent))
      return intent.mine ? run.pipe(Effect.ensuring(intent.release)) : run
    }

    const cancelRun = Effect.fn("InteractiveJobs.cancelRun")(function* (request: CancelRequest, intent: ReturnType<typeof preClaim>) {
      const live = yield* requireJob(request.sessionID, request.jobID)
      const budgets = yield* governor.budgets()
      const remaining = Math.max(0, budgets.maxExchanges - live.exchanges)
      if (isTerminal(live.status)) {
        // idempotent on terminal jobs, without consuming an exchange (spec R14/R18)
        const result = buildResult(live, {
          status: live.status,
          exit: live.exit,
          reason: live.reason,
          chunk: { text: "", truncated: false, nextCursor: live.cursor },
          exchanges: live.exchanges,
          exchangesRemaining: remaining,
        })
        yield* publishProgress(request.onProgress, live, result.status, result.output)
        return result
      }
      const reason = request.reason ?? "model"
      const body = Effect.gen(function* () {
        yield* killJob(live, reason)
        const limits = yield* outputLimits()
        const chunk = yield* drainedChunk(live, limits)
        return buildResult(live, {
          status: "cancelled",
          reason: live.reason,
          chunk,
          exchanges: live.exchanges,
          exchangesRemaining: remaining,
        })
      })
      // claim runs in the same synchronous step as the busy check; the claim is
      // released on every exit, non-mine included (spec R19)
      const result = yield* claimOrBusy(live, request.jobID, "interactive_cancel", intent.mine).pipe(
        Effect.flatMap(() => body.pipe(Effect.ensuring(release(live)))),
      )
      yield* publishProgress(request.onProgress, live, result.status, result.output)
      return result
    })

    const cancel = (request: CancelRequest): Effect.Effect<Result, StoreError> => {
      const intent = preClaim(request.sessionID, request.jobID, "interactive_cancel")
      const run = Effect.suspend(() => cancelRun(request, intent))
      return intent.mine ? run.pipe(Effect.ensuring(intent.release)) : run
    }

    const killedResult = Effect.fn("InteractiveJobs.killedResult")(function* (
      live: Live,
      onProgress: WaitRequest["onProgress"],
    ) {
      yield* Deferred.await(live.killed)
      const limits = yield* outputLimits()
      const chunk = yield* drainedChunk(live, limits)
      const budgets = yield* governor.budgets()
      const result = buildResult(live, {
        status: "cancelled",
        reason: live.reason,
        chunk,
        exchanges: live.exchanges,
        exchangesRemaining: Math.max(0, budgets.maxExchanges - live.exchanges),
      })
      yield* publishProgress(onProgress, live, result.status, result.output)
      return result
    })

    const cancelInFlight = Effect.fn("InteractiveJobs.cancelInFlight")(function* (request: {
      readonly sessionID: SessionSchema.ID
      readonly reason: CancelReason
    }) {
      for (const live of [...jobs.values()]) {
        if (live.sessionID !== request.sessionID) continue
        if (isTerminal(live.status)) continue
        // an intent counts: a forked call may not have started executing yet
        if (live.inFlight === undefined && live.intent === undefined) continue
        yield* killJob(live, request.reason)
      }
    })

    const killAll = Effect.fn("InteractiveJobs.killAll")(function* (request: { readonly reason: CancelReason }) {
      for (const live of [...jobs.values()]) {
        yield* killJob(live, request.reason)
      }
    })

    // runtime shutdown kills every live job of the Location (spec R23/R32)
    yield* Effect.addFinalizer(() => killAll({ reason: "session-close" }))

    return Service.of({ start, write, wait, cancel, cancelInFlight, killAll })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    InteractiveProcess.node,
    InteractiveSpool.node,
    InteractiveGovernor.node,
    InteractiveLedger.node,
    Config.node,
    Location.node,
  ],
})
