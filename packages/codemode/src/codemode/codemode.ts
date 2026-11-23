import { Effect, Schema } from "effect"
import { type Extension, isAsync, isConstructible } from "./extension.js"
import { scanProgram, scanTools } from "./scan.js"
import { hooked, type Services, type ToolDescription, ToolRuntime } from "./tool-runtime.js"
import type { Tools } from "./tools.js"
import {
  fromBytes,
  globalNames,
  Host,
  // Code Mode exports its own Runtime type.
  Runtime as Language,
  type Snapshot,
  SnapshotError,
  type SnapshotHeader,
  toBytes,
} from "psychoscript/effect"

export const SuspendError: typeof Language.SuspendError = Language.SuspendError
export type SuspendError = Language.SuspendError
export { fromBytes, scanProgram, scanTools, SnapshotError, toBytes }
export type { Snapshot, SnapshotHeader }

/** A tool call admitted during an execution. */
export type {
  CallResult,
  ExtensionInvocation,
  Hooks,
  ToolCall,
  ToolDescription,
  ToolInvocation,
} from "./tool-runtime.js"
/** Signature-construction helpers for host-owned catalog instructions. */
export { searchSignature, toolExpression } from "./tool-runtime.js"

/** Resource budgets enforced independently during each CodeMode program execution. */
export type ExecutionLimits = {
  /**
   * Wall-clock milliseconds before interruption. Result delivery waits for tool cleanup.
   * No default: absent means no timeout.
   */
  readonly timeoutMs?: number
  /** Maximum number of tool calls admitted by the runtime. No default: absent means unlimited. */
  readonly maxToolCalls?: number
  /**
   * Maximum UTF-8 bytes retained from the result and logs. Warnings have a separate equal budget;
   * truncation notices and host formatting are additional.
   */
  readonly maxOutputBytes?: number
}

export type ResolvedExecutionLimits = {
  readonly timeoutMs: number | undefined
  readonly maxToolCalls: number | undefined
  readonly maxOutputBytes: number | undefined
}

/** Options for one run of a runtime's program: `Runtime.execute`, `Runtime.program`, and `Runtime.resume`. */
export type RunOptions = {
  /**
   * Which of the runtime's extensions this run gets as globals; all of them by default. Each must be one the runtime
   * was made with, so its services are already part of the runtime's environment. A resumed run needs the ones it
   * started with.
   */
  readonly extensions?: ReadonlyArray<Extension>
}

/** Options for `Runtime.program`. */
export type ProgramOptions = RunOptions & {
  /** Names this run's host calls (`<runId>:<callId>`); a random UUID by default. */
  readonly runId?: string
}

/** How `program.suspend` saves a run's state. */
export type SuspendOptions = {
  /** The most bytes a saved state may take; a larger one fails the suspend, and the run goes on. */
  readonly maxBytes?: number
}

/** Configuration shared by `CodeMode.make` and `CodeMode.execute`. */
export type Options<Provided extends Record<string, unknown> = {}, Extensions extends ReadonlyArray<Extension> = []> = {
  /** Explicit tools exposed to the program as `tools`. */
  tools?: Provided & Tools<Services<Provided>>
  /** Hooks around every tool and extension call the program makes; see `Hooks`. */
  hooks?: ToolRuntime.Hooks<Environment<Provided, Extensions>>
  /** Host functions and objects exposed as globals, also importable by Node module name; see `Extension.make`. */
  extensions?: Extensions
  /** Resource limits enforced on each execution. Time counts active time only, across every resume of a run. */
  limits?: ExecutionLimits
}

/** The Effect environment an execution needs: what the tools and the extensions' Effect globals require. */
export type Environment<Provided extends Record<string, unknown>, Extensions extends ReadonlyArray<Extension>> =
  | Services<Provided>
  | Extension.Services<Extensions[number]>

/** Options for one CodeMode execution. */
export type ExecuteOptions<
  Provided extends Record<string, unknown> = {},
  Extensions extends ReadonlyArray<Extension> = [],
> = Options<Provided, Extensions> & {
  /** Source for one program in the supported JavaScript subset. */
  code: string
  /** Read-only JSON values bound in the program's outer global scope (shadowable by top-level declarations). */
  bindings?: Readonly<Record<string, DataValue>>
}

/** A JSON value that can cross the confined interpreter boundary. */
export type DataValue = Schema.Json

/** Schema for a host tool input containing CodeMode source. */
export const Input = Schema.Struct({ code: Schema.String })
export type Input = typeof Input.Type

export const DiagnosticKind = Schema.Literals([
  "ParseError",
  "UnsupportedSyntax",
  "UnknownTool",
  "InvalidToolInput",
  "InvalidToolOutput",
  "InvalidDataValue",
  "ToolCallLimitExceeded",
  "TimeoutExceeded",
  "ToolFailure",
  "ExecutionFailure",
  "Truncated",
])
/** Stable categories produced by program, schema, tool, limit, and truncation diagnostics. */
export type DiagnosticKind = typeof DiagnosticKind.Type

export const Diagnostic = Schema.Struct({
  kind: DiagnosticKind,
  message: Schema.String,
  location: Schema.optionalKey(Schema.Struct({ line: Schema.Number, column: Schema.Number })),
  suggestions: Schema.optionalKey(Schema.Array(Schema.String)),
})
/** A normalized program diagnostic safe to return across an agent tool boundary. */
export type Diagnostic = typeof Diagnostic.Type

const ToolCallSchema = Schema.Struct({ name: Schema.String })
export const Success = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Json,
  warnings: Schema.optionalKey(Schema.Array(Diagnostic)),
  logs: Schema.optionalKey(Schema.Array(Schema.String)),
  truncated: Schema.optionalKey(Schema.Boolean),
  toolCalls: Schema.Array(ToolCallSchema),
})
/** Successful execution after the result has crossed the plain-data boundary. */
export type Success = typeof Success.Type

export const Failure = Schema.Struct({
  ok: Schema.Literal(false),
  error: Diagnostic,
  logs: Schema.optionalKey(Schema.Array(Schema.String)),
  truncated: Schema.optionalKey(Schema.Boolean),
  toolCalls: Schema.Array(ToolCallSchema),
})
/** Failed execution with calls admitted before the diagnostic was produced. */
export type Failure = typeof Failure.Type

/** Schema for the structured success or diagnostic returned by CodeMode execution. */
export const Result = Schema.Union([Success, Failure])
/** Result of executing a CodeMode program. Program failures are data, not Effect failures. */
export type Result = typeof Result.Type

/** A run stopped by `program.suspend`: its whole state, to resume with `Runtime.resume`. */
export type Suspended = {
  readonly ok: "suspended"
  readonly state: Snapshot
}

/** How a run of a program ended: its result, or its saved state once suspended. */
export type Outcome = Result | Suspended

/** Reusable confined runtime over explicit tools and extensions. */
export type Runtime<R = never> = {
  readonly catalog: ReadonlyArray<ToolDescription>
  readonly execute: (
    code: string,
    bindings?: Readonly<Record<string, DataValue>>,
    options?: RunOptions,
  ) => Effect.Effect<Result, never, R>
  /** A program ready to run once; nothing runs until `program.run()`. */
  readonly program: (
    code: string,
    bindings?: Readonly<Record<string, DataValue>>,
    options?: ProgramOptions,
  ) => Program<R>
  /**
   * A suspended run (its `state`, or that state as bytes) as a program to continue in this runtime, which must be the
   * same build with the same extensions. The state is checked when it runs: `run()` fails with a `SnapshotError` when
   * it can't be resumed here.
   */
  readonly resume: (state: Snapshot | Uint8Array, options?: RunOptions) => Program<R, SnapshotError>
}

/**
 * One run of a program. `run()` runs it in the current fiber until it ends or is suspended, and owns its host
 * calls: interrupting `run()` interrupts them. A program runs once: running it again is a defect.
 */
export type Program<R = never, E = never> = {
  readonly run: () => Effect.Effect<Outcome, E, R>
  /**
   * Saves the run's state and stops it, at once, from another fiber: `run()` then returns the same `Suspended`, and so
   * does this. It fails with a `SuspendError`, leaving the run running, while a host call (tool, `search`, `fetch`, or
   * extension call) is in progress, or when the state can't be saved or is over `options.maxBytes`. A run that already
   * ended gives its result. Before `run()` starts, this waits for it to start.
   */
  readonly suspend: (options?: SuspendOptions) => Effect.Effect<Outcome, SuspendError>
}

const resolveExecutionLimits = (limits?: ExecutionLimits): ResolvedExecutionLimits => ({
  timeoutMs: validateLimit("timeoutMs", limits?.timeoutMs, 1),
  maxToolCalls: validateLimit("maxToolCalls", limits?.maxToolCalls, 0),
  maxOutputBytes: validateLimit("maxOutputBytes", limits?.maxOutputBytes, 0),
})

const validateLimit = (name: string, value: number | undefined, minimum: number) => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`)
  }
  return value
}

/** Executes one Effect-native CodeMode program without constructing a reusable runtime. */
export const execute = <
  const Provided extends Record<string, unknown>,
  const Extensions extends ReadonlyArray<Extension> = [],
>(
  options: ExecuteOptions<Provided, Extensions>,
): Effect.Effect<Result, never, Environment<Provided, Extensions>> =>
  make(options).execute(options.code, options.bindings)

/** Creates an Effect-native runtime over explicit, schema-described tools and extensions. */
export function make<
  const Provided extends Record<string, unknown> = {},
  const Extensions extends ReadonlyArray<Extension> = [],
>(options: Options<Provided, Extensions> = {}): Runtime<Environment<Provided, Extensions>> {
  type R = Environment<Provided, Extensions>
  const prepared = ToolRuntime.prepare<R>((options.tools ?? {}) as Tools<Services<Provided>>)
  const limits = resolveExecutionLimits(options.limits)
  const hooks = options.hooks ?? {}
  const extensions: ReadonlyArray<Extension> = options.extensions ?? []
  const bound = new Set([...globalNames, "tools", "search"])
  for (const extension of extensions) {
    for (const name of Object.keys(extension.globals)) {
      if (bound.has(name)) throw new TypeError(`Extension "${extension.name}" global "${name}" is already defined.`)
      bound.add(name)
    }
  }
  // One language runtime for each set of the runtime's extensions a run picks, made when first picked.
  const runtimes = new Map<string, Language.Runtime<R>>()
  const runtimeFor = (selected: ReadonlyArray<Extension> = extensions) => {
    for (const extension of selected) {
      if (!extensions.includes(extension)) {
        throw new TypeError(`Extension "${extension.name}" isn't one this runtime was made with.`)
      }
    }
    // In the runtime's order, so the same extensions picked in any order give the same globals, and resume alike.
    const picked = extensions.filter((extension) => selected.includes(extension))
    const key = picked.map((extension) => extensions.indexOf(extension)).join(",")
    const known = runtimes.get(key)
    if (known !== undefined) return known
    // The tools' and extensions' environment, which the language runtime can't infer through them.
    const made = Language.make({
      globals: (run) => ({
        ...ToolRuntime.globals(prepared, hooks, run, limits.maxToolCalls),
        ...Object.fromEntries(
          picked.flatMap((extension) =>
            Object.entries(extension.globals).map(([name, value]) => [
              name,
              extensionValue(extension, name, value, hooks),
            ]),
          ),
        ),
      }),
      // A later extension's module name wins over an earlier one's.
      modules: Object.assign({}, ...picked.map((extension) => extension.modules ?? {})),
      limits: { timeoutMs: limits.timeoutMs, maxOutputBytes: limits.maxOutputBytes },
      // Arguments cross as JSON would carry them: functions are left out and promises are awaited.
      translate: { functions: "drop", promises: "await" },
    }) as unknown as Language.Runtime<R>
    runtimes.set(key, made)
    return made
  }
  const program = (code: string, bindings?: Readonly<Record<string, DataValue>>, programOptions?: ProgramOptions) =>
    reported(runtimeFor(programOptions?.extensions).program(code, { bindings, runId: programOptions?.runId }))
  return {
    get catalog() {
      return prepared.catalog
    },
    execute: (code, bindings, runOptions) =>
      Effect.suspend(() =>
        Effect.map(program(code, bindings, runOptions).run(), (ended): Result => {
          if (ended.ok !== "suspended") return ended
          return {
            ok: false,
            error: { kind: "ExecutionFailure", message: "The program suspended, which isn't supported here." },
            toolCalls: ToolRuntime.toolCalls(ended.state.header.metadata),
          }
        }),
      ),
    program,
    resume: (state, runOptions) => reported(runtimeFor(runOptions?.extensions).resume(state)),
  }
}

/**
 * An extension's global as host functions: each function, at any depth of a global object, fires the extension hooks
 * around its calls and saves the values it returns with the extension's `snapshot` hooks. Other values pass as they are.
 */
const extensionValue = <R>(
  extension: Extension,
  label: string,
  value: unknown,
  hooks: ToolRuntime.Hooks<R>,
): unknown => {
  if (typeof value === "function") return extensionFunction(extension, label, value, hooks)
  if (typeof value !== "object" || value === null) return value
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, extensionValue(extension, `${label}.${key}`, item, hooks)]),
  )
}

/**
 * One extension function as a host function, synchronous unless it is marked `async`. The `extension.before` hook runs
 * before the function, so a denied call never reaches it, and fails the way the function would: an async one rejects,
 * a sync one throws. `extension.after` sees how the call ended, once what it returned has settled.
 */
const extensionFunction = <R>(
  extension: Extension,
  name: string,
  value: Function,
  hooks: ToolRuntime.Hooks<R>,
): Host.Fn<unknown> => {
  const before = hooks["extension.before"]
  const after = hooks["extension.after"]
  const type = isAsync(value) ? "async" : "sync"
  const snapshot = extension.snapshot
  const named = (run: (args: ReadonlyArray<unknown>) => unknown) => {
    // The program sees the extension function's own name and length.
    Object.defineProperty(run, "name", { value: value.name })
    Object.defineProperty(run, "length", { value: value.length })
    return Host.fn(run, { type, snapshot, constructible: isConstructible(value), takesFunctions: true })
  }
  if (before === undefined && after === undefined) return named((args) => value(...args))
  return named((args) =>
    Effect.gen(function* () {
      const call: ToolRuntime.ExtensionInvocation = { extension: extension.name, name, args }
      if (before !== undefined) yield* before(call)
      let result: unknown
      try {
        result = value(...args)
      } catch (reason) {
        if (after !== undefined) yield* after(call, { status: "failure", error: reason })
        return yield* Effect.fail(reason)
      }
      const settled = Effect.isEffect(result)
        ? (result as Effect.Effect<unknown, unknown, R>)
        : result instanceof Promise
          ? Effect.tryPromise({ try: () => result as Promise<unknown>, catch: (reason) => reason })
          : undefined
      if (settled === undefined) {
        if (after !== undefined) yield* after(call, { status: "success", value: result })
        return result
      }
      const observed = hooked(call, undefined, after, settled)
      // A returned Promise is still pending once the call has run: the program holds a promise for it.
      return type === "sync" && result instanceof Promise ? observed : yield* observed
    }),
  )
}

// A language program whose outcomes report the run's tool calls in place of its metadata.
const reported = <R, E>(program: Language.Program<R, E>): Program<R, E> => ({
  run: () => Effect.map(program.run(), outcome),
  suspend: (options) => Effect.map(program.suspend(options), outcome),
})

// A run's outcome as Code Mode reports it: the tool calls in place of the run's metadata.
const outcome = (ended: Language.Outcome): Outcome => {
  if (ended.ok === "suspended") return ended
  const { metadata, ...result } = ended
  return { ...result, toolCalls: ToolRuntime.toolCalls(metadata) } as Result
}
