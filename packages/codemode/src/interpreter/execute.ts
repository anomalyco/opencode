import { parse, type Program } from "acorn"
import { Cause, Deferred, Effect, Option, Schema } from "effect"
import type {
  DataValue,
  Diagnostic,
  Pending,
  ResolvedExecutionLimits,
  Result,
  Suspended,
} from "../codemode.js"
import type { Json } from "../data.js"
import { capture, fromBytes, restore, type Snapshot, SnapshotError, toBytes } from "../snapshot/snapshot.js"
import { ToolRuntime } from "../tool-runtime.js"
import { normalizeError } from "./errors.js"
import { createBuiltins } from "./intrinsics.js"
import { Interpreter } from "./interpreter.js"
import type { Value } from "./objects.js"
import { formatLocation, sourceLocation } from "./model.js"
import { Driver, type Outcome, SUSPENDED } from "./driver.js"
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
  /** Whether the host globals can hand the program values with no data form (extensions can). */
  readonly lossy?: boolean
  /** How long suspending waits for running host calls to finish, and the most bytes a saved state may take. */
  readonly suspend?: { readonly graceMs?: number | undefined; readonly maxBytes?: number | undefined }
}

/** A running execution: its outcome, and a way to suspend it. */
export type Run<R> = {
  /** Runs the program: its result, or its saved state once suspended. Run it once. */
  readonly result: Effect.Effect<Result | Suspended, never, R>
  /**
   * Stops the run at the next step boundary, settles its host calls, and saves its state; what `result` gives. A run
   * that already ended gives its result.
   */
  readonly suspend: Effect.Effect<Result | Suspended>
}

const DEFAULT_GRACE_MS = 50

export const executeProgram = <R>(
  code: string,
  prepared: ToolRuntime.Prepared<R>,
  limits: ResolvedExecutionLimits,
  hooks: ToolRuntime.Hooks<R>,
  globals?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>,
  bindings?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>,
): Effect.Effect<Result, never, R> =>
  executeSetup({ prepared, limits, hooks, globals }, code, bindings)

/** Runs one program to its end; nothing can suspend it. */
export const executeSetup = <R>(
  setup: Setup<R>,
  code: string,
  bindings?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>,
): Effect.Effect<Result, never, R> =>
  // Allocate execution state inside suspension so reused Effects never share it.
  Effect.suspend(() => startProgram(setup, code, bindings).result as Effect.Effect<Result, never, R>)

/** Starts a program: a handle whose `result` runs it, and whose `suspend` saves its state. */
export const startProgram = <R>(
  setup: Setup<R>,
  code: string,
  bindings?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>,
  runId: string = crypto.randomUUID(),
): Run<R> => {
  if (code.trim().length === 0) {
    return ended({ ok: false, error: { kind: "ParseError", message: "Code cannot be empty." }, toolCalls: [] })
  }
  return new Execution(setup, runId, 0, () => {
    const parsed = parseProgram(code)
    if (!parsed.ok) return { ok: false, error: parsed.error, toolCalls: [] }
    const ctx = instantiate(setup, bindings)
    ctx.machine.runId = runId
    ctx.start(parsed.source)
    return ctx
  }).run
}

/**
 * Resumes a saved run in this runtime: a handle like `startProgram`'s. `outcomes` completes pending host calls by
 * key. Throws a `SnapshotError` when the state can't be read or belongs to another build, other host globals, or
 * other sources.
 */
export const resumeProgram = <R>(
  setup: Setup<R>,
  saved: Snapshot | Uint8Array | unknown,
  outcomes: Readonly<Record<string, Outcome>> = {},
): Run<R> => {
  const fresh = instantiate(setup)
  const snapshot = restoreInto(setup, saved instanceof Uint8Array ? fromBytes(saved) : saved, fresh)
  return new Execution(setup, snapshot.header.runId, snapshot.header.budget.activeMs, () => fresh, outcomes).run
}

const ended = (result: Result): Run<never> => ({ result: Effect.succeed(result), suspend: Effect.succeed(result) })

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
const bare = () => (bareRuntime ??= instantiate<unknown>({ prepared: ToolRuntime.prepare({}), limits: noLimits, hooks: {} }))
const noLimits: ResolvedExecutionLimits = { timeoutMs: undefined, maxToolCalls: undefined, maxOutputBytes: undefined }

const pristines = new WeakMap<object, Interpreter<unknown>>()
// A runtime as fresh as a run's, never run, to tell which built-ins and host globals a run changed.
const pristine = <R>(setup: Setup<R>): Interpreter<unknown> => {
  if (setup.globals === undefined) return bare()
  const known = pristines.get(setup)
  if (known !== undefined) return known
  const made = instantiate(setup) as Interpreter<unknown>
  pristines.set(setup, made)
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
class Execution<R> {
  private ctx: Interpreter<R> | undefined
  private driver: Driver<R> | undefined
  private suspendAsked = false
  private started = false
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

  get run(): Run<R> {
    return {
      result: Effect.suspend(() => {
        if (this.started) return Deferred.await(this.done)
        this.started = true
        return this.execute().pipe(Effect.onExit((exit) => Deferred.done(this.done, exit)))
      }),
      suspend: Effect.suspend(() => {
        this.suspendAsked = true
        this.driver?.suspend()
        return Deferred.await(this.done)
      }),
    }
  }

  private execute(): Effect.Effect<Result | Suspended, never, R> {
    const self = this
    const setup = this.setup
    const limits = setup.limits
    const startedAt = Date.now()
    const logged = () => {
      const logs = self.ctx?.logs ?? []
      return logs.length > 0 ? { logs: [...logs] } : {}
    }
    const toolCalls = () => self.ctx?.tools.calls ?? []
    // Set only after copy-out so timeouts cannot report invalid values as completed.
    let returned: { value: DataValue; warnings: () => Array<Diagnostic> } | undefined

    const base = Effect.gen(function* () {
      const prepared = self.prepare()
      if (!(prepared instanceof Interpreter)) return prepared
      self.ctx = prepared
      const services = yield* Effect.context<R>()
      const driver = new Driver(prepared.machine, prepared.tools, services)
      self.driver = driver
      if (self.suspendAsked) driver.suspend()
      if (roundTrip) driver.checkpoint = Effect.sync(() => self.trip())
      if (self.outcomes !== undefined) driver.resume(self.outcomes)
      const outcome = yield* driver.run()
      if (outcome === SUSPENDED) {
        yield* driver.detach(setup.suspend?.graceMs ?? DEFAULT_GRACE_MS)
        return self.save(Date.now() - startedAt)
      }
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
    }).pipe(Effect.ensuring(Effect.suspend(() => self.driver?.interrupt() ?? Effect.void)))
    const timeoutMs = limits.timeoutMs
    const operation =
      timeoutMs === undefined
        ? base
        : base.pipe(
            Effect.timeoutOrElse({
              duration: Math.max(0, timeoutMs - this.activeBefore),
              orElse: () =>
                Effect.sync(() => {
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

  // Saves the run's state once its host calls are settled.
  private save(activeMs: number): Result | Suspended {
    const ctx = this.ctx!
    const limits = this.setup.limits
    const saved = capture(ctx as Interpreter<unknown>, {
      bare: bare(),
      pristine: pristine(this.setup),
      runId: this.runId,
      limits: {
        timeoutMs: limits.timeoutMs ?? null,
        maxToolCalls: limits.maxToolCalls ?? null,
        maxOutputBytes: limits.maxOutputBytes ?? null,
      },
      activeMs: this.activeBefore + activeMs,
      strict: false,
    })
    const maxBytes = this.setup.suspend?.maxBytes
    if (maxBytes !== undefined) {
      const size = toBytes(saved.snapshot).byteLength
      if (size > maxBytes) {
        const message = `The run's state takes ${size} bytes, more than the ${maxBytes}-byte limit, so it couldn't be suspended.`
        return { ok: false, error: { kind: "ExecutionFailure", message }, toolCalls: ctx.tools.calls }
      }
    }
    const pending = ctx.machine.calls().flatMap((call): Array<Pending> => {
      if (call.status === "completed") return []
      const request = call.request
      return [
        {
          id: call.id,
          path: request.kind === "tool" ? request.path.join(".") : request.kind === "search" ? "search" : call.label,
          args: request.kind === "extension" ? [] : request.args.map((arg): Json => arg ?? null),
          key: call.key,
          status: call.status,
        },
      ]
    })
    return { ok: "suspended", state: saved.snapshot, pending }
  }

  // The round-trip test mode's checkpoint: saves the state to bytes and continues in a brand-new runtime. States that
  // hold live host values (an extension call in flight, a function an extension returned) can't round-trip, so they
  // are skipped; a lost value anywhere else is a codec gap and fails the run.
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
    if (ctx.machine.calls().some((call) => call.request.kind === "extension")) return
    this.trips++
    const saved = capture(ctx as Interpreter<unknown>, {
      bare: bare(),
      pristine: pristine(this.setup),
      runId: this.runId,
      limits: { timeoutMs: null, maxToolCalls: null, maxOutputBytes: null },
      activeMs: 0,
      strict: this.setup.lossy !== true,
    })
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
