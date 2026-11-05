import { Effect, Schema, type Scope } from "effect"
import { fromJson } from "./data.js"
import type { Extension } from "./extension.js"
import type { Json } from "./data.js"
import type { Outcome } from "./interpreter/driver.js"
import { type Execution, resumeProgram, type Setup, startProgram } from "./interpreter/execute.js"
import type { Snapshot } from "./snapshot/snapshot.js"
import { extensionGlobals } from "./interpreter/extensions.js"
import { globalNames } from "./interpreter/globals.js"
import { scanTools } from "./scan.js"
import { type Services, type ToolDescription, ToolRuntime } from "./tool-runtime.js"
import type { Tools } from "./tools.js"

export { scanTools }
export { fromBytes, SnapshotError, toBytes } from "./snapshot/snapshot.js"
import type { SnapshotError } from "./snapshot/snapshot.js"
export type { Header as SnapshotHeader, Snapshot } from "./snapshot/snapshot.js"
export type { Execution, Outcome }

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
  /** How `execution.suspend` saves a run; see `Runtime.execute`. */
  suspend?: SuspendOptions
}

/** How suspending a run settles its host calls and saves its state. */
export type SuspendOptions = {
  /** Milliseconds to wait for running host calls to finish before detaching or abandoning them. Default 50. */
  readonly graceMs?: number
  /** The most bytes a saved state may take; a larger one fails the run instead of suspending it. */
  readonly maxBytes?: number
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

/** A host call a suspended run was waiting on. */
export type Pending = {
  readonly id: number
  /** The tool path, `search`, or an extension function's name. */
  readonly path: string
  readonly args: ReadonlyArray<Json>
  /** The idempotency key, `<run id>:<id>`; a durable tool names its work by it. */
  readonly key: string
  /**
   * `queued`: it never started. `starting`: it may have started, and its outcome is unknown. `started`: a durable
   * tool's work, still running, reattached by its handle on resume.
   */
  readonly status: "queued" | "starting" | "started"
}

/** A run stopped by `run.suspend`: its whole state, to resume with `Runtime.resume`, and the calls it waits on. */
export type Suspended = {
  readonly ok: "suspended"
  readonly state: Snapshot
  readonly pending: ReadonlyArray<Pending>
}

/** Reusable confined runtime over explicit tools. */
export type Runtime<R = never> = {
  readonly catalog: ReadonlyArray<ToolDescription>
  /**
   * Starts a program in the current scope and returns at once: `execution.result` waits for its outcome, and
   * `execution.suspend` saves its state. Closing the scope interrupts the program and cancels its pending durable work.
   * `runId` names its host calls' idempotency keys; a random one by default.
   */
  readonly execute: (
    code: string,
    bindings?: Readonly<Record<string, DataValue>>,
    options?: { readonly runId?: string },
  ) => Effect.Effect<Execution, never, R | Scope.Scope>
  /**
   * Continues a suspended run (its `state`, or that state as bytes) in this runtime, which must be the same build with
   * the same extensions, as `execute` starts one. `outcomes` settles pending calls whose outcome the host knows, by
   * key. Fails with a `SnapshotError` when the state can't be resumed here.
   */
  readonly resume: (
    state: Snapshot | Uint8Array,
    outcomes?: Readonly<Record<string, Outcome>>,
  ) => Effect.Effect<Execution, SnapshotError, R | Scope.Scope>
}

const validateLimit = (name: keyof ExecutionLimits, value: number | undefined, minimum: number): number | undefined => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`)
  }
  return value
}

const resolveExecutionLimits = (limits?: ExecutionLimits): ResolvedExecutionLimits => ({
  timeoutMs: validateLimit("timeoutMs", limits?.timeoutMs, 1),
  maxToolCalls: validateLimit("maxToolCalls", limits?.maxToolCalls, 0),
  maxOutputBytes: validateLimit("maxOutputBytes", limits?.maxOutputBytes, 0),
})

/** Starts one Effect-native CodeMode program without constructing a reusable runtime; see `Runtime.execute`. */
export const execute = <
  const Provided extends Record<string, unknown>,
  const Extensions extends ReadonlyArray<Extension> = [],
>(
  options: ExecuteOptions<Provided, Extensions>,
): Effect.Effect<Execution, never, Environment<Provided, Extensions> | Scope.Scope> =>
  make(options).execute(options.code, options.bindings)

/** Creates an Effect-native runtime over explicit, schema-described tools and extensions. */
export const make = <
  const Provided extends Record<string, unknown> = {},
  const Extensions extends ReadonlyArray<Extension> = [],
>(
  options: Options<Provided, Extensions> = {},
): Runtime<Environment<Provided, Extensions>> => {
  const prepared = ToolRuntime.prepare<Environment<Provided, Extensions>>(
    (options.tools ?? {}) as Tools<Services<Provided>>,
  )
  const limits = resolveExecutionLimits(options.limits)
  const extensions = options.extensions ?? []
  const bound = new Set(globalNames)
  for (const extension of extensions) {
    for (const name of Object.keys(extension.globals)) {
      if (bound.has(name)) throw new TypeError(`Extension "${extension.name}" global "${name}" is already defined.`)
      bound.add(name)
    }
  }
  for (const [name, value] of Object.entries(options.suspend ?? {})) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`suspend.${name} must be a safe integer greater than or equal to 0.`)
    }
  }
  const setup: Setup<Environment<Provided, Extensions>> = {
    prepared,
    limits,
    hooks: options.hooks ?? {},
    globals: extensions.length === 0 ? undefined : (ctx) => extensionGlobals(ctx, extensions),
    lossy: extensions.length > 0,
    suspend: options.suspend,
  }
  const data = (bindings: Readonly<Record<string, DataValue>> | undefined) =>
    bindings === undefined
      ? undefined
      : (ctx: Parameters<typeof fromJson>[0]) =>
          Object.entries(bindings).map(([name, value]) => [name, fromJson(ctx, value)] as const)
  return {
    get catalog() {
      return prepared.catalog
    },
    execute: (code, bindings, runOptions) => startProgram(setup, code, data(bindings), runOptions?.runId),
    resume: (state, outcomes) => resumeProgram(setup, state, outcomes),
  }
}
