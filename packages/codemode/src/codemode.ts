import { Effect, Schema, type Scope } from "effect"
import { fromJson, type Json } from "./data.js"
import type { Extension } from "./extension.js"
import { executeProgram } from "./interpreter/execute.js"
import { extensionGlobals } from "./interpreter/extensions.js"
import { globalNames } from "./interpreter/globals.js"
import { scanTools } from "./scan.js"
import { SuspendError } from "./suspend-error.js"
import type { Handle } from "./tool.js"
import { type Services, type ToolDescription, ToolRuntime } from "./tool-runtime.js"
import type { Tools } from "./tools.js"
import { VmEngine } from "./vm/index.js"

export { scanTools, SuspendError }
export const toBytes = VmEngine.toBytes
export const fromBytes = VmEngine.fromBytes
export const SnapshotError = VmEngine.SnapshotError
export type SnapshotError = VmEngine.SnapshotError
export type SnapshotHeader = VmEngine.SnapshotHeader
export type Snapshot = VmEngine.Snapshot
export type Execution = VmEngine.Execution
export type Outcome = VmEngine.Outcome

/** A tool call admitted during an execution. */
export type {
  CallResult,
  ExtensionInvocation,
  Hooks,
  ToolCall,
  ToolDescription,
  ToolInvocation,
} from "./tool-runtime.js"
export { searchSignature, toolExpression } from "./tool-runtime.js"

/** Schema for the model-facing `execute` tool input. */
export const Input = Schema.Struct({
  code: Schema.String,
})

/** Model-facing `execute` tool input. */
export type Input = typeof Input.Type

/**
 * Resource limits for one CodeMode execution.
 *
 * Omitted limits are unbounded; hosts choose their own defaults.
 */
export type ExecutionLimits = {
  /** Wall-clock timeout in milliseconds; must be a positive safe integer. */
  readonly timeoutMs?: number
  /** Maximum admitted tool calls; must be a non-negative safe integer. */
  readonly maxToolCalls?: number
  /** Maximum UTF-8 bytes retained for result values and console logs; must be a non-negative safe integer. */
  readonly maxOutputBytes?: number
}

export type ResolvedExecutionLimits = {
  readonly timeoutMs: number | undefined
  readonly maxToolCalls: number | undefined
  readonly maxOutputBytes: number | undefined
}

/** Execution engine: the default AST generator interpreter (`"legacy"`) or the experimental bytecode VM (`"vm"`). */
export type Engine = "legacy" | "vm"

/** How suspending a run saves its state (`engine: "vm"` only). */
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
  /** Execution engine (default `"legacy"`). `"vm"` is experimental and enables `Runtime.start` and `Runtime.resume`. */
  engine?: Engine
  /** How `execution.suspend` saves a run (`engine: "vm"` only); see `Runtime.start`. */
  suspend?: SuspendOptions
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

/** Source location in the executed program. Lines and columns are 1-based. */
export const Location = Schema.Struct({
  line: Schema.Int,
  column: Schema.Int,
})

/** Source location in the executed program. Lines and columns are 1-based. */
export type Location = typeof Location.Type

/** Plain data value produced or consumed by a CodeMode program. */
export const DataValue = Schema.Json

/** Plain data value produced or consumed by a CodeMode program. */
export type DataValue = typeof DataValue.Type

/** Classification of a CodeMode diagnostic. */
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

/** Classification of a CodeMode diagnostic. */
export type DiagnosticKind = typeof DiagnosticKind.Type

/** Structured error or warning from parsing, validation, tool execution, or interpretation. */
export const Diagnostic = Schema.Struct({
  kind: DiagnosticKind,
  message: Schema.String,
  location: Schema.optionalKey(Location),
  suggestions: Schema.optionalKey(Schema.Array(Schema.String)),
})

/** Structured error or warning from parsing, validation, tool execution, or interpretation. */
export type Diagnostic = typeof Diagnostic.Type

const ToolCallSchema = Schema.Struct({
  name: Schema.String,
})

/** Result of executing a CodeMode program. Program failures are data, not Effect failures. */
export const Result = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: DataValue,
    warnings: Schema.optionalKey(Schema.Array(Diagnostic)),
    logs: Schema.optionalKey(Schema.Array(Schema.String)),
    truncated: Schema.optionalKey(Schema.Boolean),
    toolCalls: Schema.Array(ToolCallSchema),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Diagnostic,
    logs: Schema.optionalKey(Schema.Array(Schema.String)),
    truncated: Schema.optionalKey(Schema.Boolean),
    toolCalls: Schema.Array(ToolCallSchema),
  }),
])

/** Result of executing a CodeMode program. Program failures are data, not Effect failures. */
export type Result = typeof Result.Type

/** A durable tool call a suspended run waits on: its work runs on, and `resume` needs its outcome, by key. */
export type Pending = {
  /** The idempotency key, `<run id>:<call id>`, which the durable tool named its work by. */
  readonly key: string
  /** The tool's path, as the program called it: `tools.x.y`. */
  readonly path: string
  readonly args: ReadonlyArray<Json>
  /** The handle the durable tool's `start` returned; none when the call suspended the run from its `start`. */
  readonly handle?: Handle
}

/** A run stopped by `execution.suspend`: its whole state, to resume with `Runtime.resume`, and the calls it waits on. */
export type Suspended = {
  readonly ok: "suspended"
  readonly state: Snapshot
  readonly pending: ReadonlyArray<Pending>
}

/** Reusable confined runtime over explicit tools. */
export type Runtime<R = never> = {
  readonly catalog: ReadonlyArray<ToolDescription>
  readonly execute: (code: string, bindings?: Readonly<Record<string, DataValue>>) => Effect.Effect<Result, never, R>
  /**
   * Starts a program in the current scope and returns at once (experimental, requires `engine: "vm"`):
   * `execution.result` waits for its outcome, and `execution.suspend` saves its state. Closing the scope interrupts the
   * program and cancels its pending durable work. `runId` names its host calls' idempotency keys; a random one by
   * default.
   */
  readonly start: (
    code: string,
    bindings?: Readonly<Record<string, DataValue>>,
    options?: { readonly runId?: string },
  ) => Effect.Effect<Execution, never, R | Scope.Scope>
  /**
   * Continues a suspended run (its `state`, or that state as bytes) in this runtime (experimental, requires
   * `engine: "vm"`), which must be the same build with the same extensions, as `start` starts one. `outcomes` settles
   * pending calls whose outcome the host knows, by key. Fails with a `SnapshotError` when the state can't be resumed
   * here.
   */
  readonly resume: (
    state: Snapshot | Uint8Array,
    outcomes?: Readonly<Record<string, Outcome>>,
  ) => Effect.Effect<Execution, SnapshotError, R | Scope.Scope>
}

const validateLimit = (name: keyof ExecutionLimits, value: number | undefined, minimum: number): number | undefined => {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`)
  }
  return value
}

const resolveLimits = (limits: ExecutionLimits | undefined): ResolvedExecutionLimits => ({
  timeoutMs: validateLimit("timeoutMs", limits?.timeoutMs, 1),
  maxToolCalls: validateLimit("maxToolCalls", limits?.maxToolCalls, 0),
  maxOutputBytes: validateLimit("maxOutputBytes", limits?.maxOutputBytes, 0),
})

const defaultEngine = (): Engine =>
  typeof process !== "undefined" &&
  (process.env.CODEMODE_ENGINE === "vm" || process.env.CODEMODE_ROUNDTRIP === "1")
    ? "vm"
    : "legacy"

/** Executes one Effect-native CodeMode program without constructing a reusable runtime. */
export const execute = <
  const Provided extends Record<string, unknown>,
  const Extensions extends ReadonlyArray<Extension> = [],
>(
  options: ExecuteOptions<Provided, Extensions>,
): Effect.Effect<Result, never, Environment<Provided, Extensions>> =>
  make(options).execute(options.code, options.bindings)

/** Creates an Effect-native runtime over explicit, schema-described tools and extensions. */
export const make = <
  const Provided extends Record<string, unknown>,
  const Extensions extends ReadonlyArray<Extension> = [],
>(
  options: Options<Provided, Extensions> = {},
): Runtime<Environment<Provided, Extensions>> => {
  const limits = resolveLimits(options.limits)
  const prepared = ToolRuntime.prepare<Environment<Provided, Extensions>>(
    (options.tools ?? {}) as Tools<Environment<Provided, Extensions>>,
  )
  const extensions = options.extensions ?? []
  const engine = options.engine ?? defaultEngine()
  const bound = new Set(engine === "vm" ? VmEngine.globalNames : globalNames)
  for (const extension of extensions) {
    for (const name of Object.keys(extension.globals)) {
      if (bound.has(name)) {
        throw new TypeError(`Extension "${extension.name}" global "${name}" is already defined.`)
      }
      bound.add(name)
    }
  }
  for (const [name, value] of Object.entries(options.suspend ?? {})) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`suspend.${name} must be a safe integer greater than or equal to 0.`)
    }
  }
  if (engine === "legacy") {
    return {
      get catalog() {
        return prepared.catalog
      },
      execute: (code, bindings) =>
        executeProgram(code, prepared, limits, options.hooks ?? {}, (ctx) => [
          ...Object.entries(bindings ?? {}).map(([name, value]) => [name, fromJson(ctx, value)] as const),
          ...extensionGlobals(ctx, extensions),
        ]),
      start: () => {
        throw new Error('CodeMode.Runtime.start requires `engine: "vm"`.')
      },
      resume: () => {
        throw new Error('CodeMode.Runtime.resume requires `engine: "vm"`.')
      },
    }
  }
  const setup: VmEngine.Setup<Environment<Provided, Extensions>> = {
    prepared,
    limits,
    hooks: options.hooks ?? {},
    globals: extensions.length === 0 ? undefined : (ctx) => VmEngine.extensionGlobals(ctx, extensions),
    lossy: extensions.some((extension) => extension.snapshot === undefined),
    suspend: options.suspend,
  }
  const data = (bindings: Readonly<Record<string, DataValue>> | undefined) =>
    bindings === undefined
      ? undefined
      : (ctx: Parameters<typeof VmEngine.fromJson>[0]) =>
          Object.entries(bindings).map(([name, value]) => [name, VmEngine.fromJson(ctx, value)] as const)
  return {
    get catalog() {
      return prepared.catalog
    },
    execute: (code, bindings) => VmEngine.finishExecution(VmEngine.startProgram(setup, code, data(bindings))),
    start: (code, bindings, runOptions) => VmEngine.startProgram(setup, code, data(bindings), runOptions?.runId),
    resume: (state, outcomes) => VmEngine.resumeProgram(setup, state, outcomes),
  }
}
