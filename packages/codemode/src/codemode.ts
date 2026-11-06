import { Effect, Schema, type Scope } from "effect"
import { fromJson } from "./data.js"
import type { Extension } from "./extension.js"
import { executeProgram } from "./interpreter/execute.js"
import { extensionGlobals } from "./interpreter/extensions.js"
import { globalNames } from "./interpreter/globals.js"
import { scanTools } from "./scan.js"
import { fromBytes, SnapshotError, SuspendError, toBytes } from "./suspend-error.js"
import { type Services, type ToolDescription, ToolRuntime } from "./tool-runtime.js"
import type { Tools } from "./tools.js"
import type { VmEngine } from "./vm/index.js"

export { fromBytes, scanTools, SnapshotError, SuspendError, toBytes }
export type SnapshotHeader = VmEngine.SnapshotHeader
export type Snapshot = VmEngine.Snapshot
export type Execution = VmEngine.Execution

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
  /** Interpreter that runs programs. `"vm"` is the experimental bytecode VM; the default is `"legacy"`. */
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

/** A run stopped by `execution.suspend`: its whole state, to resume with `Runtime.resume`. */
export type Suspended = {
  readonly ok: "suspended"
  readonly state: Snapshot
}

/** Reusable confined runtime over explicit tools. */
export type Runtime<R = never> = {
  readonly catalog: ReadonlyArray<ToolDescription>
  readonly execute: (code: string, bindings?: Readonly<Record<string, DataValue>>) => Effect.Effect<Result, never, R>
  /**
   * Starts a program in the current scope and returns at once (experimental, requires `engine: "vm"`):
   * `execution.result` waits for its outcome, and `execution.suspend` saves its state. Closing the scope interrupts the
   * program.
   */
  readonly start: (
    code: string,
    bindings?: Readonly<Record<string, DataValue>>,
  ) => Effect.Effect<Execution, never, R | Scope.Scope>
  /**
   * Continues a suspended run (its `state`, or that state as bytes) in this runtime (experimental, requires
   * `engine: "vm"`), which must be the same build with the same extensions, as `start` starts one. Fails with a
   * `SnapshotError` when the state can't be resumed here.
   */
  readonly resume: (state: Snapshot | Uint8Array) => Effect.Effect<Execution, SnapshotError, R | Scope.Scope>
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
  // Both engines bind the same global names; test/engines.test.ts keeps them in step.
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
  if (options.engine !== "vm") {
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
  let setup: VmEngine.Setup<Environment<Provided, Extensions>> | undefined
  const getSetup = (vm: typeof VmEngine) =>
    (setup ??= {
      prepared,
      limits,
      hooks: options.hooks ?? {},
      globals: extensions.length === 0 ? undefined : (ctx) => vm.extensionGlobals(ctx, extensions),
      lossy: extensions.length > 0,
      suspend: options.suspend,
    })
  const data = (vm: typeof VmEngine, bindings: Readonly<Record<string, DataValue>> | undefined) =>
    bindings === undefined
      ? undefined
      : (ctx: Parameters<typeof vm.fromJson>[0]) =>
          Object.entries(bindings).map(([name, value]) => [name, vm.fromJson(ctx, value)] as const)
  return {
    get catalog() {
      return prepared.catalog
    },
    execute: (code, bindings) =>
      Effect.flatMap(loadVm(), (vm) => vm.finishExecution(vm.startProgram(getSetup(vm), code, data(vm, bindings)))),
    start: (code, bindings) =>
      Effect.flatMap(loadVm(), (vm) => vm.startProgram(getSetup(vm), code, data(vm, bindings))),
    resume: (state) => Effect.flatMap(loadVm(), (vm) => vm.resumeProgram(getSetup(vm), state)),
  }
}

// The VM is loaded on first use so the default engine pulls in none of its code.
let vmLoaded: typeof VmEngine | undefined
let vmEngine: Promise<typeof VmEngine> | undefined
const loadVm = () =>
  vmLoaded !== undefined
    ? Effect.succeed(vmLoaded)
    : Effect.promise(() =>
        (vmEngine ??= import("./vm/index.js").then((mod) => {
          vmLoaded = mod
          return mod
        })),
      )
