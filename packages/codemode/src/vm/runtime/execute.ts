import { parse, type Program } from "acorn"
import { Cause, Deferred, Effect, Option, Schema, type Scope } from "effect"
import type { DataValue, Diagnostic, ResolvedExecutionLimits, Result, Suspended } from "../../codemode.js"
import type { Extension } from "../../extension.js"
import { fromJson } from "../data.js"
import { fromBytes, header, type Snapshot, SnapshotError, toBytes } from "../snapshot/snapshot.js"
import { ToolRuntime } from "../../tool-runtime.js"
import { SuspendError } from "../../suspend-error.js"
import { normalizeError } from "./errors.js"
import { extensionGlobals } from "./extensions.js"
import { createBuiltins } from "./intrinsics.js"
import { Interpreter } from "./interpreter.js"
import type { Value } from "./objects.js"
import { formatLocation, sourceLocation } from "./model.js"
import { Driver, SUSPENDED } from "./driver.js"
import { Interruption } from "./signals.js"
import { Source } from "./source.js"
import type { Vm } from "../vm.js"

type Globals<R> = (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>

/** How a runtime runs programs: its tools, limits, hooks, and host globals, shared by every run it starts. */
export type Setup<R> = {
  readonly prepared: ToolRuntime.Prepared<R>
  readonly limits: ResolvedExecutionLimits
  readonly hooks: ToolRuntime.Hooks<R>
  /** The host's globals, made again for a restored run; see `Interpreter`. */
  readonly globals?: Globals<R> | undefined
  /** Whether the host globals can hand the program values with no data form (extensions can). */
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
   * running, while a host call is in progress. A run that already ended gives its result.
   */
  readonly suspend: Effect.Effect<Result | Suspended, SuspendError>
}

export const finishExecution = <E, R>(
  started: Effect.Effect<Execution, E, R>,
): Effect.Effect<Result, E, Exclude<R, Scope.Scope>> =>
  Effect.scoped(
    Effect.flatMap(started, (execution) =>
      Effect.map(execution.result, (outcome): Result => {
        if (outcome.ok !== "suspended") return outcome
        return {
          ok: false,
          error: { kind: "ExecutionFailure", message: "The program suspended, which isn't supported here." },
          toolCalls: outcome.state.header.toolCalls,
        }
      }),
    ),
  )

/** Runs a program on the VM with `CodeMode.make`'s extensions and JSON bindings. */
export const execute = <R>(
  code: string,
  prepared: ToolRuntime.Prepared<R>,
  limits: ResolvedExecutionLimits,
  hooks: ToolRuntime.Hooks<R>,
  extensions: ReadonlyArray<Extension>,
  bindings: Readonly<Record<string, DataValue>> | undefined,
): Effect.Effect<Result, never, R> =>
  executeProgram(
    code,
    prepared,
    limits,
    hooks,
    extensions.length === 0 ? undefined : (ctx) => extensionGlobals(ctx, extensions),
    bindings === undefined
      ? undefined
      : (ctx) => Object.entries(bindings).map(([name, value]) => [name, fromJson(ctx, value)] as const),
    extensions.length > 0,
  )

export const executeProgram = <R>(
  code: string,
  prepared: ToolRuntime.Prepared<R>,
  limits: ResolvedExecutionLimits,
  hooks: ToolRuntime.Hooks<R>,
  globals?: Globals<R>,
  bindings?: Globals<R>,
  lossy = false,
): Effect.Effect<Result, never, R> =>
  finishExecution(startProgram({ prepared, limits, hooks, globals, lossy }, code, bindings))

/** Starts a program in the current scope; closing the scope interrupts it. */
export const startProgram = <R>(
  setup: Setup<R>,
  code: string,
  bindings?: Globals<R>,
): Effect.Effect<Execution, never, R | Scope.Scope> =>
  Effect.suspend(() => {
    if (code.trim().length === 0) {
      return Effect.succeed(
        ended({ ok: false, error: { kind: "ParseError", message: "Code cannot be empty." }, toolCalls: [] }),
      )
    }
    return new Running(setup, 0, () => {
      const parsed = parseProgram(code)
      if (!parsed.ok) return { ok: false, error: parsed.error, toolCalls: [] }
      const runtime = instantiate(setup, bindings)
      runtime.vm.start(parsed.source)
      return runtime
    }).start()
  })

/**
 * Resumes a saved run in this runtime, in the current scope, as `startProgram` starts one, under the limits it was
 * saved with. Fails with a `SnapshotError` when the state can't be read or belongs to another build, other host
 * globals, or other sources.
 */
export const resumeProgram = <R>(
  setup: Setup<R>,
  saved: Snapshot | Uint8Array | unknown,
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
      const snapshot = restoreInto(state, fresh.vm)
      return new Running(resumed, snapshot.header.budget.activeMs, () => fresh, true)
    },
    catch: (error) => (error instanceof SnapshotError ? error : new SnapshotError(String(error))),
  }).pipe(Effect.flatMap((running) => running.start()))

const ended = (result: Result): Execution => ({ result: Effect.succeed(result), suspend: Effect.succeed(result) })

// Sources restored recently, by text: the AST is never changed, so runs restored from the same program share it.
const restoredSources = new Map<string, Source>()

const restoreInto = (saved: unknown, vm: Vm): Snapshot =>
  vm.restore(saved, {
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

// A new runtime: intrinsics, the host globals, the program's bindings, a fresh tool bridge, and its VM.
const instantiate = <R>(setup: Setup<R>, bindings?: Globals<R>): Interpreter<R> => {
  const ctx = new Interpreter<R>({
    tools: ToolRuntime.make(setup.prepared, setup.limits.maxToolCalls, setup.hooks),
    builtins: createBuiltins(),
    logs: [],
    globals: setup.globals,
    bindings,
  })
  if (roundTrip) ctx.vm.tripEvery = ROUND_TRIP_TICKS
  return ctx
}

/**
 * The round-trip test mode: at every host stop and every slice, which come every few loop back-edges and calls, a run's
 * state is saved to bytes and restored into a brand-new runtime, which continues the run. It proves the VM's state is
 * plain data at every step. Internal: only the test suite turns it on (`bun run test:roundtrip`).
 */
let roundTrip = false
export const setRoundTrip = (enabled: boolean) => {
  roundTrip = enabled
}
const ROUND_TRIP_TICKS = 2
const ROUND_TRIP_MAX = 200

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
    /** Active milliseconds used before this run, by earlier ones of the same execution. */
    private readonly activeBefore: number,
    private readonly prepare: () => Interpreter<R> | Result,
    private readonly resuming = false,
  ) {}

  // Makes the run's runtime and driver, then runs the program in a fiber of the current scope.
  start(): Effect.Effect<Execution, never, R | Scope.Scope> {
    const self = this
    return Effect.gen(function* () {
      const prepared = self.prepare()
      if (!(prepared instanceof Interpreter)) return ended(prepared)
      self.ctx = prepared
      self.driver = new Driver(prepared.vm, prepared.tools, yield* Effect.context<R>())
      if (roundTrip) self.driver.checkpoint = Effect.sync(() => self.trip())
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
    const limits = this.setup.limits
    const logged = () => {
      const logs = self.ctx.logs
      return logs.length > 0 ? { logs: [...logs] } : {}
    }
    const toolCalls = () => self.ctx.tools.calls
    const failed = (error: Diagnostic): Result => ({ ok: false, error, ...logged(), toolCalls: toolCalls() })
    // Set only after copy-out so timeouts cannot report invalid values as completed.
    let returned: { value: DataValue; warnings: () => Array<Diagnostic> } | undefined

    const base = Effect.gen(function* () {
      const driver = self.driver
      if (self.resuming) driver.resume()
      const outcome = yield* driver.run()
      if (outcome === SUSPENDED) return self.suspended!
      self.finished = true
      if (!outcome.ok) return failed(normalizeError(outcome.error))
      const result = (outcome.value as DataValue | undefined) ?? null
      const vm = self.ctx.vm
      returned = { value: result, warnings: () => vm.diagnostics() }
      // Host work the program left running is interrupted, not awaited.
      yield* driver.interrupt()
      const warnings = vm.diagnostics()
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
                    return failed({ kind: "TimeoutExceeded", message: `Execution timed out after ${timeoutMs}ms.` })
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
        Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.succeed(failed(normalizeError(Cause.squash(cause)))),
      ),
      Effect.map((result) =>
        result.ok === "suspended" || limits.maxOutputBytes === undefined
          ? result
          : boundOutput(result, limits.maxOutputBytes),
      ),
    )
  }

  // Suspends the run once its state is saved: the driver stops.
  private stop(saved: Suspended): void {
    this.finished = true
    this.suspended = saved
    this.driver.detach()
  }

  /**
   * Saves the run's state, with no effect on the run: the calls that block a suspend, or the state as it is now. The
   * program shares this thread with the caller, so it is at a step boundary.
   */
  private save(): Suspended | SuspendError {
    const vm = this.ctx.vm
    const running = this.driver.blocking()
    if (running.length > 0) {
      return new SuspendError({
        message: `The run can't be suspended while ${running.map((call) => call.path).join(", ")} ${running.length === 1 ? "is" : "are"} running.`,
        running,
      })
    }
    const limits = this.setup.limits
    const saved = attempt(() =>
      vm.capture({
        limits: {
          timeoutMs: limits.timeoutMs ?? null,
          maxToolCalls: limits.maxToolCalls ?? null,
          maxOutputBytes: limits.maxOutputBytes ?? null,
        },
        activeMs: this.activeBefore + Date.now() - this.startedAt,
        strict: false,
      }),
    )
    if (!saved.ok) {
      const error = saved.error
      return new SuspendError({
        message: `The run's state couldn't be saved: ${error instanceof Error ? error.message : String(error)}`,
        running: [],
      })
    }
    const snapshot = saved.value.snapshot
    const maxBytes = this.setup.suspend?.maxBytes
    if (maxBytes !== undefined) {
      const size = toBytes(snapshot).byteLength
      if (size > maxBytes) {
        return new SuspendError({
          message: `The run's state takes ${size} bytes, more than the ${maxBytes}-byte limit, so it couldn't be suspended.`,
          running: [],
        })
      }
    }
    return { ok: "suspended", state: snapshot }
  }

  // The round-trip test mode's checkpoint: saves the state to bytes and continues in a brand-new runtime. States that
  // hold live host values (an extension call in flight, a function an extension returned) can't round-trip, so they
  // are skipped; a lost value anywhere else is a codec gap and fails the run.
  private trip(): void {
    const driver = this.driver
    if (this.trips >= ROUND_TRIP_MAX) {
      this.ctx.vm.tripEvery = 0
      return
    }
    if (this.skip > 0) {
      this.skip--
      return
    }
    if (driver.holdsHostValues) return
    this.trips++
    const saved = this.ctx.vm.capture({ strict: !this.setup.lossy })
    const bytes = toBytes(saved.snapshot)
    this.skip = Math.floor(saved.snapshot.records.length / 200 + bytes.byteLength / 100_000)
    if (saved.lost.length > 0) return
    const fresh = instantiate(this.setup)
    restoreInto(fromBytes(bytes), fresh.vm)
    this.ctx = fresh
    driver.vm = fresh.vm
    driver.tools = fresh.tools
  }
}

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

// The longest prefix of `items` whose sizes add up to at most `budget` bytes.
const fitting = <T>(items: ReadonlyArray<T>, budget: number, size: (item: T) => number): Array<T> => {
  const kept: Array<T> = []
  let used = 0
  for (const item of items) {
    used += size(item)
    if (used > budget) break
    kept.push(item)
  }
  return kept
}

// Warnings have a separate budget so result data cannot starve diagnostics.
const boundOutput = (result: Result, maxOutputBytes: number): Result => {
  const serialized = result.ok ? (JSON.stringify(result.value) ?? "null") : ""
  const valueBytes = result.ok ? utf8ByteLength(serialized) : 0
  const valueTruncated = valueBytes > maxOutputBytes
  const value: DataValue = !result.ok
    ? null
    : valueTruncated
      ? `${utf8Truncate(serialized, maxOutputBytes)} [result truncated: ${valueBytes} bytes exceeds the ${maxOutputBytes}-byte output limit; return a smaller value]`
      : result.value

  const warnings = result.ok ? (result.warnings ?? []) : []
  const keptWarnings = fitting(warnings, maxOutputBytes, (warning) => utf8ByteLength(JSON.stringify(warning)) + 1)
  const warningsCut = keptWarnings.length < warnings.length
  if (warningsCut) {
    keptWarnings.push({
      kind: "Truncated",
      message: `${warnings.length - keptWarnings.length} additional warnings omitted by the output limit.`,
    })
  }

  const logs = result.logs ?? []
  const logBudget = Math.max(0, maxOutputBytes - Math.min(valueBytes, maxOutputBytes))
  const kept = fitting(logs, logBudget, (line) => utf8ByteLength(line) + 1)
  const logsCut = kept.length < logs.length
  if (logsCut) kept.push(`[logs truncated: showing ${kept.length} of ${logs.length} lines]`)

  if (!valueTruncated && !warningsCut && !logsCut) return result
  const warningsPart = keptWarnings.length > 0 ? { warnings: keptWarnings } : {}
  const logsPart = kept.length > 0 ? { logs: kept } : {}
  return result.ok
    ? { ok: true, value, ...warningsPart, ...logsPart, truncated: true, toolCalls: result.toolCalls }
    : { ok: false, error: result.error, ...logsPart, truncated: true, toolCalls: result.toolCalls }
}
