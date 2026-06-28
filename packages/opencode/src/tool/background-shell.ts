import { Cause, Effect, Scope, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Shell } from "@opencode-ai/core/shell"
import { monitorPid, monitorStarted, monitorStopped } from "@opencode-ai/core/background-monitor"
import { WakeScope } from "@opencode-ai/core/background-job"

// Coalesce lines arriving within this window into one wake (one model turn).
const BATCH_WINDOW_MS = 200
// Kill a runaway watcher after this many lines rather than flood the session.
const FLOOD_MAX_LINES = 5000
// Ceiling (in JS string chars) on the unterminated-line carry buffer. The line flood
// guard counts COMPLETE lines, so a watcher spewing bytes with no newline would never
// trip it and would grow carry without bound. Cap it and treat an over-long partial
// line as flood. (Chars, not bytes: bounds memory to a few MB regardless of encoding.)
const CARRY_MAX_CHARS = 1_000_000

/** Build a detached login-shell command (same env/flags the old monitor used). */
export function makeShellCommand(command: string, cwd: string): ChildProcess.Command {
  const shell = Shell.acceptable()
  // Parent-death watchdog. The child is `detached` (its own process group / session
  // leader via setsid) so graceful teardown can tree-kill it with `kill -- -pid`.
  // But on NON-graceful opencode death (SIGKILL / tile-close / crash) no JS finalizer
  // runs, the child reparents to launchd, and the watcher leaks forever (seen live:
  // 8-9 day old `while :; ... stat ./f` orphans). Fix: spawn a tiny background guard
  // that polls opencode's pid (passed in as OPENCODE_PARENT_PID, unambiguous vs $PPID)
  // and SIGTERMs our own process group once it disappears, bounding orphan life to
  // ~the poll interval. Must be a SINGLE line: Shell.args runs `eval <JSON.stringify>`,
  // so a literal newline corrupts into a `\n` token.
  // The watchdog's stdio is redirected to /dev/null: as a background job it inherits
  // the command's stdout pipe, and leaving it attached would hold the pipe open so the
  // reader never sees EOF when a short command exits (hanging exit-notify).
  // Guard the watchdog behind a liveness check of the parent at arm time: if
  // OPENCODE_PARENT_PID is empty/unset (e.g. a dotfile scrubbed env before the eval)
  // then `kill -0 ""` fails and an UNguarded watchdog would fall straight through to
  // `kill -- -$$` and reap the job the instant it starts. Only arm when the parent is
  // actually alive; otherwise just run the command (accept no orphan protection).
  //
  // The caller's `command` may be MULTI-LINE (a model arming `monitor` with a `while`
  // loop, or a `python3 -c "..."` heredoc). Shell.args wraps whatever we pass as
  // `eval ${JSON.stringify(...)}` inside `zsh -lc`/`bash -lc`; a real newline survives
  // JSON.stringify as a literal `\n` escape, which inside the eval's double-quoted arg is
  // backslash-n (NOT a newline) and eval re-parses it as an escaped `n` — fusing adjacent
  // lines into garbage (e.g. `done` -> `don`) so the command dies instantly with a parse
  // error (the "monitor exited the moment I armed a multi-line command" bug). Transport the
  // command base64-encoded HERE (Node's toString("base64") is unwrapped -> a single line of
  // [A-Za-z0-9+/=], which has no newline and no shell metacharacter, so it passes through
  // the eval+JSON layer verbatim) and decode it in the child. Decode by PIPING into a fresh
  // shell rather than `eval "$(...)"`: the outer eval's double-quoted arg would expand a
  // `$(...)` (or `$`/backtick) BEFORE eval runs, re-injecting the raw newlines and corrupting
  // them again — the pipe form has nothing for that pass to expand. The inner shell inherits
  // this login shell's already-sourced env (PATH/aliases), so it needs no `-l`.
  const payload =
    process.platform === "win32"
      ? command
      : `printf %s '${Buffer.from(command, "utf8").toString("base64")}' | base64 -d | ${shell}`
  const guarded =
    process.platform === "win32"
      ? payload
      : `if kill -0 "$OPENCODE_PARENT_PID" 2>/dev/null; then ( while kill -0 "$OPENCODE_PARENT_PID" 2>/dev/null; do sleep 2; done; kill -- -$$ 2>/dev/null ) </dev/null >/dev/null 2>&1 & fi; ${payload}`
  const args = Shell.args(shell, guarded, cwd)
  return ChildProcess.make(shell, args, {
    cwd,
    detached: process.platform !== "win32",
    // Discard stderr instead of leaving it a piped-but-undrained stream: the reader
    // only consumes stdout, so an unread stderr pipe fills (~64KB) and BLOCKS the
    // watched process. The monitor watches stdout only (the prompt tells callers to
    // merge with 2>&1 if they want stderr), so "ignore" removes the deadlock.
    stderr: "ignore",
    env: {
      ...process.env,
      OPENCODE_PARENT_PID: String(process.pid),
      TERM: "xterm-256color",
      PAGER: "cat",
      GIT_PAGER: "cat",
    },
  })
}

/**
 * A fully-provided (`R = never`) Effect suitable as a `BackgroundJob` `run`:
 * spawns `command`, tracks session liveness + PID (so the CLI defers exit and
 * SIGINT can kill it), and (when `onBatch` is given) delivers stdout as
 * coalesced line batches. The process is killed when the job's scope closes
 * (i.e. on `BackgroundJob.cancel` / session teardown) via the scoped spawn + an
 * explicit kill finalizer. Resolves to the exit reason string.
 */
export function runShellJob(opts: {
  sessionID: string
  command: ChildProcess.Command
  // Called with a BATCH of stdout lines (joined by "\n") coalesced over a short
  // window. Receiving batches — not single lines — is what bounds wake frequency.
  onBatch?: (batch: string) => Effect.Effect<void>
  // Called once with the exit reason when the process exits ON ITS OWN (not on
  // cancel/teardown — those interrupt the reader before we get here). Delivered as a
  // forked wake into wakeScope, exactly like onBatch: callers MUST NOT await their own
  // exit note inline (e.g. Effect.tap on this function's result), because the model
  // can re-arm on the exit note, and an inline await would run that re-arm's cancel in
  // THIS run fiber -> self-join deadlock (the exit-then-rearm hang). Routing it here
  // forks it off the run fiber.
  onExit?: (reason: string) => Effect.Effect<void>
}): Effect.Effect<string, unknown, ChildProcessSpawner> {
  return Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      // The job's own scope (provided by Effect.scoped). The reader and the debounce
      // timer fork into THIS — not detached: forkDetach makes daemon fibers no scope
      // ever interrupts (proven against the Effect internals), leaking a ref'd timer
      // past teardown (hang) and orphaning in-flight work. job-scoping keeps them
      // interruptible on cancel/teardown. (The model WAKE forks into wakeScope below,
      // for a different reason — see there.)
      const jobScope = yield* Scope.Scope
      // Registry/instance-lifetime scope (provided by BackgroundJob.start; it's the
      // BackgroundJob state.scope, parent of every job scope). Model wakes fork into
      // THIS, not jobScope, so cancelling this job (re-arm) can't interrupt a wake that
      // is itself running the re-arm turn (the self-cancel deadlock). Falls back to
      // jobScope when run outside start. Reader + debounce timer stay jobScope.
      const wakeScope = (yield* WakeScope) ?? jobScope
      // Set true the instant this job's scope begins closing (cancel / re-arm /
      // session teardown). Wakes fork into wakeScope, which OUTLIVES this scope, so
      // without a guard a debounce flush or trailing batch racing the close could fork
      // a stale wake AFTER the job is dead (M3), and a wake for a torn-down job could
      // drive a turn for a gone session (M2 dead-session). The emit guard below checks
      // this. Added as the LAST jobScope finalizer so it runs FIRST on close.
      let jobClosing = false
      // Fork a model wake (onBatch / onExit) into wakeScope, off the run+reader fibers,
      // so a re-arm triggered from inside the wake can cancel THIS job without a
      // self-join. Guarded by jobClosing so no wake is forked once the job is torn down.
      const forkWake = (effect: Effect.Effect<void>) =>
        jobClosing ? Effect.void : effect.pipe(Effect.forkIn(wakeScope, { startImmediately: true }))
      let pid: number | undefined
      // Acquire/release the session count atomically: acquireRelease registers the
      // release finalizer in the SAME uninterruptible step as the increment, so an
      // interrupt between "incremented" and "finalizer registered" can't leak the count.
      yield* Effect.acquireRelease(
        Effect.sync(() => monitorStarted(opts.sessionID)),
        () => Effect.sync(() => monitorStopped(opts.sessionID, pid)),
      )

      const handle = yield* spawner.spawn(opts.command)
      pid = Number(handle.pid)
      monitorPid(opts.sessionID, pid)
      // forceKillAfter escalates TERM -> SIGKILL after a grace period so a
      // TERM-ignoring command can't hang teardown (cancel / re-arm / session delete),
      // which would otherwise block on scope close (H-HIGH).
      yield* Effect.addFinalizer(() => handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.ignore))
      // Last finalizer added => first to run on close: flip the guard before the
      // process is killed or the count is decremented, so no late wake escapes.
      yield* Effect.addFinalizer(() => Effect.sync(() => (jobClosing = true)))

      const onBatch = opts.onBatch
      if (onBatch) {
        // ONE persistent streaming decoder for the whole stream. A per-chunk
        // `new TextDecoder().decode(chunk)` corrupts any multi-byte UTF-8 char (emoji,
        // CJK) split across an OS pipe-read boundary: the trailing partial bytes flush
        // as U+FFFD and the leading continuation bytes in the next chunk flush as more
        // U+FFFD. {stream:true} buffers the partial sequence inside the decoder instead.
        const decoder = new TextDecoder()
        let carry = ""
        let pending: string[] = []
        let total = 0
        let timerArmed = false

        // Fire-and-forget (forked, NOT awaited): onBatch calls ops.prompt, which
        // AWAITS the model turn. Forked so the reader never blocks on a turn. We fork
        // into wakeScope (the registry/instance scope), NOT jobScope: when the model
        // re-arms a monitor from inside a wake turn, that cancels THIS job — and the
        // wake fiber is a CHILD of the reader fiber, so closing jobScope would
        // interrupt+await the reader and cascade into its own child (the wake) = a
        // self-join hang. wakeScope reparents the wake off the reader so the turn
        // completes. Reaping: Effect.forkIn drops the fiber from wakeScope the instant
        // it COMPLETES (effect.js:2112), so completed wakes never accumulate; only a
        // genuinely-hung turn lingers (until instance disposal). The jobClosing guard
        // stops a wake from being forked once this job is torn down (M2 dead-session /
        // M3 late-flush); an already-in-flight wake to a vanished session is caught by
        // ops.prompt + the caller's catchCause. This also delivers the trailing exit
        // batch (below) reliably instead of dropping it on job-scope close.
        const emit = (batch: ReadonlyArray<string>) => forkWake(onBatch(batch.join("\n")))

        // Flush whatever has accumulated as one batch (one wake).
        const flush = Effect.suspend(() => {
          timerArmed = false
          if (pending.length === 0) return Effect.void
          const batch = pending
          pending = []
          return emit(batch)
        })

        yield* Stream.runForEach(handle.stdout, (chunk) =>
          Effect.gen(function* () {
            carry += decoder.decode(chunk as Uint8Array, { stream: true })
            // No-newline flood: an endless partial line never produces a complete line,
            // so the line counter below can't catch it. Cap carry (in chars) and treat
            // the overflow as flood — warn (with a truncated head) and kill.
            if (carry.length > CARRY_MAX_CHARS) {
              yield* emit([
                `[flood guard] watcher stopped: ${carry.length} chars with no newline. head: ${carry.slice(0, 200)}`,
              ])
              return yield* Effect.interrupt
            }
            const lines = carry.split(/\r?\n/)
            carry = lines.pop() ?? ""
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed) continue
              pending.push(trimmed)
              total += 1
            }
            // Flood guard: flush what we have, tell the model, then kill (via scope).
            if (total >= FLOOD_MAX_LINES) {
              if (pending.length > 0) {
                const batch = pending
                pending = []
                yield* emit(batch)
              }
              yield* emit([`[flood guard] watcher stopped: emitted ${total}+ lines too fast`])
              return yield* Effect.interrupt
            }
            // Arm a single debounce timer; it flushes everything buffered so far.
            if (pending.length > 0 && !timerArmed) {
              timerArmed = true
              yield* flush.pipe(Effect.delay(`${BATCH_WINDOW_MS} millis`), Effect.forkIn(jobScope, { startImmediately: true }))
            }
          }),
        )

        // Process exited: flush the streaming decoder (emits U+FFFD only for a genuinely
        // truncated final sequence) and deliver any buffered lines (incl. a trailing
        // partial). emit() forks into wakeScope (session-lifetime), so this trailing
        // batch survives the job-scope close that follows exit — and the model may
        // safely re-arm on the exit note without the exit-then-rearm self-cancel deadlock.
        carry += decoder.decode()
        const tail = carry.trim()
        if (tail) pending.push(tail)
        if (pending.length > 0) {
          // Clear pending + disarm the timer (like flush/flood do) so a debounce timer
          // that armed on the final chunk and survives to fire can't re-emit this batch.
          const batch = pending
          pending = []
          timerArmed = false
          yield* emit(batch)
        }
      }

      const reason = yield* handle.exitCode.pipe(
        Effect.matchCause({
          onSuccess: (code) => `exit code ${code}`,
          onFailure: (cause) => `signal or error: ${Cause.squash(cause)}`,
        }),
      )
      // Exit note as a FORKED wake (off this run fiber) — never an inline await — so a
      // re-arm on the note can cancel this job without self-joining. We reach here only
      // on a real exit; cancel/teardown interrupts the reader above before this point.
      if (opts.onExit) yield* forkWake(opts.onExit(reason))
      return reason
    }),
  )
}
