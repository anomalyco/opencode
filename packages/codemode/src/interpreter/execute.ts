import { parse, type Program } from "acorn"
import { Cause, Deferred, Effect, Option, Schema, type Scope } from "effect"
import type { DataValue, Diagnostic, Pending, ResolvedExecutionLimits, Result, Suspended } from "../codemode.js"
import type { Json } from "../data.js"
import { capture, fromBytes, header, restore, type Snapshot, SnapshotError, toBytes } from "../snapshot/snapshot.js"
import { ToolRuntime } from "../tool-runtime.js"
import type { HostCall } from "../machine/scheduler.js"
import { SuspendError } from "../suspend-error.js"
import { normalizeError } from "./errors.js"
import { createBuiltins } from "./intrinsics.js"
import { Interpreter } from "./interpreter.js"
import type { Value } from "./objects.js"
import { formatLocation, sourceLocation } from "./model.js"
import { callPath, Driver, type Outcome, SUSPENDED } from "./driver.js"
import { Interruption } from "./signals.js"
import { Source } from "./source.js"
import { stats } from "../machine/task.js"
import "../machine/kinds.js"

/** How a runtime runs programs: its tools, limits, hooks, and host globals, shared by every run it starts. */
export type Setup<R> = {
  readonly prepared: ToolRuntime.Prepared<R>
  readonly limits: ResolvedExecutionLimits
  readonly hooks: ToolRuntime.Hooks<R>
  /** The host's globals, made again for a restored run; see `Interpreter`. */
  readonly globals?: ((ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>) | undefined
  /** Whether the host globals can hand the program values with no data form (extensions without `snapshot` hooks can). */
  readonly lossy?: boolean
  /** The most bytes a suspended run's state may take. */
  readonly suspend?: { readonly maxBytes?: number | undefined }
}

/** A started program: its outcome, and a way to suspend it. */
export type Execution = {
  /** Waits for the program's result, or its saved state once suspended. */
  readonly result: Effect.Effect<Result | Suspended>
  /**
   * Saves the run's state and stops it, at once: what `result` gives. It fails with a `SuspendError`, leaving the run
   * running, while a host call other than a durable tool's started work is in progress. A run that already ended
   * gives its result.
   */
  readonly suspend: Effect.Effect<Result | Suspended, SuspendError>
}

export const executeProgram = <R>(
  code: string,
  prepared: ToolRuntime.Prepared<R>,
  limits: ResolvedExecutionLimits,
  hooks: ToolRuntime.Hooks<R>,
  globals?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>,
  bindings?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>,
): Effect.Effect<Result, never, R> =>
  Effect.scoped(
    Effect.flatMap(
      startProgram({ prepared, limits, hooks, globals }, code, bindings),
      // Nothing suspends this run, so it ends with a result.
      (execution) => execution.result as Effect.Effect<Result>,
    ),
  )

/** Starts a program in the current scope; closing the scope interrupts it. */
export const startProgram = <R>(
  setup: Setup<R>,
  code: string,
  bindings?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>,
  runId: string = crypto.randomUUID(),
): Effect.Effect<Execution, never, R | Scope.Scope> =>
  Effect.suspend(() => {
    if (code.trim().length === 0) {
      return Effect.succeed(
        ended({ ok: false, error: { kind: "ParseError", message: "Code cannot be empty." }, toolCalls: [] }),
      )
    }
    return new Running(setup, runId, 0, () => {
      const parsed = parseProgram(code)
      if (!parsed.ok) return { ok: false, error: parsed.error, toolCalls: [] }
      const ctx = instantiate(setup, bindings)
      ctx.machine.runId = runId
      ctx.start(parsed.source)
      return ctx
    }).start()
  })

/**
 * Resumes a saved run in this runtime, in the current scope, as `startProgram` starts one, under the limits it was
 * saved with. `outcomes` settles its pending durable calls, by key: each one needs an outcome. Fails with a
 * `SnapshotError` when the state can't be read or belongs to another build, other host globals, or other sources, or
 * when `outcomes` doesn't match the pending calls.
 */
export const resumeProgram = <R>(
  setup: Setup<R>,
  saved: Snapshot | Uint8Array | unknown,
  outcomes: Readonly<Record<string, Outcome>> = {},
): Effect.Effect<Execution, SnapshotError, R | Scope.Scope> =>
  Effect.try({
    try: () => {
      const state = saved instanceof Uint8Array ? fromBytes(saved) : saved
      const limits = header(state).limits
      const resumed: Setup<R> = {
        ...setup,
        limits: {
          timeoutMs: limits.timeoutMs ?? undefined,
          maxToolCalls: limits.maxToolCalls ?? undefined,
          maxOutputBytes: limits.maxOutputBytes ?? undefined,
        },
      }
      const fresh = instantiate(resumed)
      const snapshot = restoreInto(resumed, state, fresh)
      const pending = fresh.machine.calls().filter((call) => call.status === "started")
      for (const call of pending) {
        if (!Object.hasOwn(outcomes, call.key)) {
          throw new SnapshotError(
            `The pending durable call ${call.key} (${callPath(call)}) needs an outcome to resume.`,
          )
        }
      }
      for (const key of Object.keys(outcomes)) {
        if (!pending.some((call) => call.key === key)) {
          throw new SnapshotError(`An outcome was given for ${key}, which isn't a pending durable call of this run.`)
        }
      }
      return new Running(resumed, snapshot.header.runId, snapshot.header.budget.activeMs, () => fresh, outcomes)
    },
    catch: (error) => (error instanceof SnapshotError ? error : new SnapshotError(String(error))),
  }).pipe(Effect.flatMap((running) => running.start()))

const ended = (result: Result): Execution => ({ result: Effect.succeed(result), suspend: Effect.succeed(result) })

// Sources restored recently, by text: the AST is never changed, so runs restored from the same program share it.
const restoredSources = new Map<string, Source>()

const restoreInto = <R>(setup: Setup<R>, saved: unknown, fresh: Interpreter<R>): Snapshot =>
  restore(saved, fresh as Interpreter<unknown>, {
    bare: bare(),
    parse: (code) => {
      const known = restoredSources.get(code)
      if (known !== undefined) return known
      const parsed = parseProgram(code)
      if (!parsed.ok) throw new SnapshotError(`A saved source no longer parses: ${parsed.error.message}`)
      if (restoredSources.size >= 16) restoredSources.delete(restoredSources.keys().next().value!)
      restoredSources.set(code, parsed.source)
      return parsed.source
    },
    interruption: () => new Interruption(Cause.interrupt()),
  })

// A new runtime: intrinsics, the host globals, the program's bindings, and a fresh tool bridge.
const instantiate = <R>(
  setup: Setup<R>,
  bindings?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>,
): Interpreter<R> => {
  const ctx = new Interpreter<R>({
    tools: ToolRuntime.make(setup.prepared, setup.limits.maxToolCalls, setup.hooks),
    builtins: createBuiltins(),
    logs: [],
    globals: setup.globals,
    bindings,
  })
  if (roundTrip) driven.add(ctx.machine)
  return ctx
}

let bareRuntime: Interpreter<unknown> | undefined
// The intrinsics alone, which the build id is taken from.
const bare = () =>
  (bareRuntime ??= instantiate<unknown>({ prepared: ToolRuntime.prepare({}), limits: noLimits, hooks: {} }))
const noLimits: ResolvedExecutionLimits = { timeoutMs: undefined, maxToolCalls: undefined, maxOutputBytes: undefined }

const pristines = new WeakMap<object, Interpreter<unknown>>()
// A runtime as fresh as a run's, never run, to tell which built-ins and host globals a run changed. Runs with the
// same host globals share one, whatever their limits.
const pristine = <R>(setup: Setup<R>): Interpreter<unknown> => {
  const globals = setup.globals
  if (globals === undefined) return bare()
  const known = pristines.get(globals)
  if (known !== undefined) return known
  const made = instantiate(setup) as Interpreter<unknown>
  pristines.set(globals, made)
  return made
}

/**
 * The round-trip test mode (`CODEMODE_ROUNDTRIP=1`): at every host stop and every slice, which come every few steps,
 * a run's state is saved to bytes and restored into a brand-new runtime, which continues the run.
 */
const roundTrip = typeof process !== "undefined" && process.env.CODEMODE_ROUNDTRIP === "1"
const ROUND_TRIP_STEPS = 5
const ROUND_TRIP_MAX = 200
// The machines runs drive, so tests that step a machine themselves see no extra slices.
const driven = new WeakSet<object>()
if (roundTrip) {
  // A slice every few steps, so the run stops (and round-trips) all through its body, not only at host calls.
  let countdown = ROUND_TRIP_STEPS
  stats.inspect = (_stack, task) => {
    if (!driven.has(task.machine) || --countdown > 0) return
    countdown = ROUND_TRIP_STEPS
    task.slice = true
  }
}

/** One run's state: the runtime it is in now (restoring swaps it), its driver, and how much active time it used. */
class Running<R> {
  private ctx!: Interpreter<R>
  private driver!: Driver<R>
  private startedAt = 0
  // Set once the program's body ends, and once a suspend saved the run: either way, `done` gets the outcome next.
  private finished = false
  private suspended: Suspended | undefined
  private trips = 0
  // Checkpoints to let pass before the next round trip, so a large state is not saved at every one.
  private skip = 0
  private readonly done = Deferred.makeUnsafe<Result | Suspended>()

  constructor(
    private readonly setup: Setup<R>,
    private readonly runId: string,
    /** Active milliseconds used before this run, by earlier ones of the same execution. */
    private readonly activeBefore: number,
    private readonly prepare: () => Interpreter<R> | Result,
    private readonly outcomes?: Readonly<Record<string, Outcome>>,
  ) {}

  // Makes the run's runtime and driver, then runs the program in a fiber of the current scope.
  start(): Effect.Effect<Execution, never, R | Scope.Scope> {
    const self = this
    return Effect.gen(function* () {
      const prepared = self.prepare()
      if (!(prepared instanceof Interpreter)) return ended(prepared)
      self.ctx = prepared
      self.driver = new Driver(prepared.machine, prepared.tools, yield* Effect.context<R>())
      if (roundTrip) self.driver.checkpoint = Effect.sync(() => self.trip())
      self.driver.suspendFor = (id) => {
        if (self.finished)
          return new SuspendError({ message: "The run has already ended or been suspended.", running: [] })
        const saved = self.save(self.ctx.machine.call(id))
        if (saved instanceof SuspendError) return saved
        self.stop(saved)
        return undefined
      }
      self.startedAt = Date.now()
      yield* Effect.forkScoped(self.execute().pipe(Effect.onExit((exit) => Deferred.done(self.done, exit))))
      return {
        result: Deferred.await(self.done),
        suspend: Effect.suspend(() => {
          if (self.finished) return Deferred.await(self.done)
          const saved = self.save()
          if (saved instanceof SuspendError) return Effect.fail(saved)
          self.stop(saved)
          return Deferred.await(self.done)
        }),
      } satisfies Execution
    })
  }

  private execute(): Effect.Effect<Result | Suspended, never, R> {
    const self = this
    const setup = this.setup
    const limits = setup.limits
    const logged = () => {
      const logs = self.ctx.logs
      return logs.length > 0 ? { logs: [...logs] } : {}
    }
    const toolCalls = () => self.ctx.tools.calls
    // Set only after copy-out so timeouts cannot report invalid values as completed.
    let returned: { value: DataValue; warnings: () => Array<Diagnostic> } | undefined

    const base = Effect.gen(function* () {
      const driver = self.driver
      if (self.outcomes !== undefined) driver.resume(self.outcomes)
      const outcome = yield* driver.run()
      // Suspended: the durable calls' work was detached, and is left running.
      if (outcome === SUSPENDED) return self.suspended!
      self.finished = true
      const ctx = self.ctx
      if (!outcome.ok) {
        return { ok: false, error: normalizeError(outcome.error), ...logged(), toolCalls: toolCalls() } satisfies Result
      }
      const result = (outcome.value as DataValue | undefined) ?? null
      const machine = ctx.machine
      returned = { value: result, warnings: () => machine.diagnostics() }
      // Host work the program left running is interrupted, not awaited.
      yield* driver.interrupt()
      const warnings = machine.diagnostics()
      return {
        ok: true,
        value: result,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...logged(),
        toolCalls: toolCalls(),
      } satisfies Result
    }).pipe(Effect.ensuring(Effect.suspend(() => self.driver.interrupt())))
    const timeoutMs = limits.timeoutMs
    const operation =
      timeoutMs === undefined
        ? base
        : base.pipe(
            Effect.timeoutOrElse({
              duration: Math.max(0, timeoutMs - this.activeBefore),
              orElse: () =>
                Effect.sync((): Result | Suspended => {
                  self.finished = true
                  if (self.suspended !== undefined) return self.suspended
                  if (returned === undefined) {
                    return {
                      ok: false,
                      error: { kind: "TimeoutExceeded", message: `Execution timed out after ${timeoutMs}ms.` },
                      ...logged(),
                      toolCalls: toolCalls(),
                    } satisfies Result
                  }
                  // Keep the timeout warning first so truncation preserves it.
                  return {
                    ok: true,
                    value: returned.value,
                    warnings: [
                      {
                        kind: "TimeoutExceeded",
                        message: `The program returned, but background work was still running at the ${timeoutMs}ms timeout and was interrupted. Await all started promises.`,
                      },
                      ...returned.warnings(),
                    ],
                    ...logged(),
                    toolCalls: toolCalls(),
                  } satisfies Result
                }),
            }),
          )

    return operation.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.succeed({
              ok: false,
              error: normalizeError(Cause.squash(cause)),
              ...logged(),
              toolCalls: toolCalls(),
            } satisfies Result),
      ),
      Effect.map((result) =>
        result.ok === "suspended" || limits.maxOutputBytes === undefined
          ? result
          : boundOutput(result, limits.maxOutputBytes),
      ),
    )
  }

  // Suspends the run once its state is saved: the driver stops and detaches the durable calls' work.
  private stop(saved: Suspended): void {
    this.finished = true
    this.suspended = saved
    this.driver.detach()
  }

  /**
   * Saves the run's state, with no effect on the run: the calls that block a suspend, or the state as it is now and
   * the durable calls it waits on. The program shares this thread with the caller, so it is at a step boundary.
   * `asking` is a durable call suspending the run from its `start` or `attach`: it is saved as pending.
   */
  private save(asking?: HostCall): Suspended | SuspendError {
    const ctx = this.ctx
    const machine = ctx.machine
    const running = this.driver.blocking(asking)
    if (running.length > 0) {
      return new SuspendError({
        message: `The run can't be suspended while ${running.map((call) => call.path).join(", ")} ${running.length === 1 ? "is" : "are"} running; only a durable tool's started work can be.`,
        running,
      })
    }
    const limits = this.setup.limits
    const status = asking?.status
    if (asking !== undefined) asking.status = "started"
    const saved = attempt(() =>
      capture(ctx as Interpreter<unknown>, {
        bare: bare(),
        pristine: pristine(this.setup),
        runId: this.runId,
        limits: {
          timeoutMs: limits.timeoutMs ?? null,
          maxToolCalls: limits.maxToolCalls ?? null,
          maxOutputBytes: limits.maxOutputBytes ?? null,
        },
        activeMs: this.activeBefore + Date.now() - this.startedAt,
        strict: false,
      }),
    )
    const restored = (failure: SuspendError) => {
      if (asking !== undefined && status !== undefined) asking.status = status
      return failure
    }
    if (!saved.ok) {
      const error = saved.error
      return restored(
        new SuspendError({
          message: `The run's state couldn't be saved: ${error instanceof Error ? error.message : String(error)}`,
          running: [],
        }),
      )
    }
    const snapshot = saved.value.snapshot
    const maxBytes = this.setup.suspend?.maxBytes
    if (maxBytes !== undefined) {
      const size = toBytes(snapshot).byteLength
      if (size > maxBytes) {
        return restored(
          new SuspendError({
            message: `The run's state takes ${size} bytes, more than the ${maxBytes}-byte limit, so it couldn't be suspended.`,
            running: [],
          }),
        )
      }
    }
    const pending = machine.calls().flatMap((call): Array<Pending> => {
      const request = call.request
      if (call.status !== "started" || request.kind !== "tool") return []
      return [
        {
          key: call.key,
          path: callPath(call),
          args: request.args.map((arg): Json => arg ?? null),
          ...(call.handle === undefined ? {} : { handle: call.handle }),
        },
      ]
    })
    return { ok: "suspended", state: snapshot, pending }
  }

  // The round-trip test mode's checkpoint: saves the state to bytes and continues in a brand-new runtime. States that
  // hold live host values (an extension call in flight, a function an extension without `snapshot` hooks returned)
  // can't round-trip, so they are skipped; a lost value anywhere else is a codec gap and fails the run.
  private trip(): void {
    const ctx = this.ctx!
    const driver = this.driver!
    if (this.trips >= ROUND_TRIP_MAX) {
      driven.delete(ctx.machine)
      return
    }
    if (this.skip > 0) {
      this.skip--
      return
    }
    if (driver.holdsHostValues) return
    this.trips++
    const attempted = attempt(() =>
      capture(ctx as Interpreter<unknown>, {
        bare: bare(),
        pristine: pristine(this.setup),
        runId: this.runId,
        limits: { timeoutMs: null, maxToolCalls: null, maxOutputBytes: null },
        activeMs: 0,
        strict: this.setup.lossy !== true,
      }),
    )
    // An extension's `snapshot` hooks may refuse to save a value, which fails a suspend, not the run.
    if (!attempted.ok) {
      const error = attempted.error
      if (error instanceof SnapshotError && error.message.startsWith("The extension ")) return
      throw error
    }
    const saved = attempted.value
    const bytes = toBytes(saved.snapshot)
    this.skip = Math.floor(saved.snapshot.records.length / 200 + bytes.byteLength / 100_000)
    if (saved.lost.length > 0) return
    const fresh = instantiate(this.setup)
    restoreInto(this.setup, fromBytes(bytes), fresh)
    this.ctx = fresh
    driver.machine = fresh.machine
    driver.tools = fresh.tools
  }
}

// Saving runs host code (an extension's `snapshot.encode`), and anything it throws fails the suspend.
const attempt = <A>(run: () => A): { ok: true; value: A } | { ok: false; error: unknown } => {
  try {
    return { ok: true, value: run() }
  } catch (error) {
    return { ok: false, error }
  }
}

export const parseProgram = (
  code: string,
): { ok: true; program: Program; source: Source } | { ok: false; error: Diagnostic } => {
  try {
    const program = parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      // Imports bind globals by module name; scripts keep sloppy-mode semantics, which module source would make strict.
      allowImportExportEverywhere: true,
      locations: true,
    })
    const exported = program.body.find((statement) => statement.type.startsWith("Export"))
    if (exported) {
      const location = sourceLocation(exported)
      return {
        ok: false,
        error: {
          kind: "ParseError",
          message: `SyntaxError: Exports aren't available. Return the result instead.${formatLocation(location)}`,
          location,
        },
      }
    }
    return { ok: true, program, source: new Source("main", code, program) }
  } catch (error) {
    // Only acorn's own syntax errors become a located ParseError; anything else keeps the generic failure path.
    const acorn = error instanceof SyntaxError ? decodeAcornError(error) : Option.none()
    if (Option.isNone(acorn)) throw error
    return { ok: false, error: parseDiagnostic(acorn.value) }
  }
}

// Acorn appends ` (line:column)` to its messages; its lines are 1-based and its columns 0-based.
const AcornError = Schema.Struct({
  message: Schema.String,
  loc: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
})
const decodeAcornError = Schema.decodeUnknownOption(AcornError)

const parseDiagnostic = (error: typeof AcornError.Type): Diagnostic => {
  const location = { line: error.loc.line, column: error.loc.column + 1 }
  const reason = error.message.replace(/ \(\d+:\d+\)$/, "")
  const text = `${reason.endsWith(".") ? reason : `${reason}.`} Code must be plain JavaScript written as a program body.`
  return { kind: "ParseError", message: `SyntaxError: ${text}${formatLocation(location)}`, location }
}

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength

// Drop a replacement character produced by truncating inside a UTF-8 sequence.
const utf8Truncate = (value: string, maxBytes: number): string => {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength <= maxBytes) return value
  const text = new TextDecoder("utf-8").decode(bytes.slice(0, Math.max(0, maxBytes)))
  return text.endsWith("\uFFFD") ? text.slice(0, -1) : text
}

// Warnings have a separate budget so result data cannot starve diagnostics.
const boundOutput = (result: Result, maxOutputBytes: number): Result => {
  let truncated = false

  let value: DataValue = null
  let valueBytes = 0
  if (result.ok) {
    const serialized = JSON.stringify(result.value) ?? "null"
    const bytes = utf8ByteLength(serialized)
    if (bytes > maxOutputBytes) {
      truncated = true
      value = `${utf8Truncate(serialized, maxOutputBytes)} [result truncated: ${bytes} bytes exceeds the ${maxOutputBytes}-byte output limit; return a smaller value]`
      valueBytes = maxOutputBytes
    } else {
      value = result.value
      valueBytes = bytes
    }
  }

  const warnings = result.ok ? (result.warnings ?? []) : []
  const keptWarnings: Array<Diagnostic> = []
  let warningBytes = 0
  for (const warning of warnings) {
    const bytes = utf8ByteLength(JSON.stringify(warning)) + 1
    if (warningBytes + bytes > maxOutputBytes) break
    warningBytes += bytes
    keptWarnings.push(warning)
  }
  if (keptWarnings.length < warnings.length) {
    truncated = true
    keptWarnings.push({
      kind: "Truncated",
      message: `${warnings.length - keptWarnings.length} additional warnings omitted by the output limit.`,
    })
  }

  const logs = result.logs ?? []
  const kept: Array<string> = []
  const logBudget = Math.max(0, maxOutputBytes - valueBytes)
  let logBytes = 0
  for (const line of logs) {
    const lineBytes = utf8ByteLength(line) + 1
    if (logBytes + lineBytes > logBudget) break
    logBytes += lineBytes
    kept.push(line)
  }
  if (kept.length < logs.length) {
    truncated = true
    kept.push(`[logs truncated: showing ${kept.length} of ${logs.length} lines]`)
  }

  if (!truncated) return result
  const warningsPart = keptWarnings.length > 0 ? { warnings: keptWarnings } : {}
  const logsPart = kept.length > 0 ? { logs: kept } : {}
  return result.ok
    ? {
        ok: true,
        value,
        ...warningsPart,
        ...logsPart,
        truncated: true,
        toolCalls: result.toolCalls,
      }
    : { ok: false, error: result.error, ...logsPart, truncated: true, toolCalls: result.toolCalls }
}
