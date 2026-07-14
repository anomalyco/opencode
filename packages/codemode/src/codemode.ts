import { Effect, Schema } from "effect"
import { executeWithLimits } from "./interpreter/execute.js"
import { type HostTools, type Services, type ToolDescription, ToolRuntime } from "./tool-runtime.js"
import type { Definition } from "./tool.js"

/** A tool call admitted during an execution. */
export type { ToolCall, ToolCallEnded, ToolCallHooks, ToolCallStarted, ToolDescription } from "./tool-runtime.js"

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

/** Controls how much of the tool catalog is inlined in agent instructions. */
export type DiscoveryOptions = {
  /** Approximate token budget (chars/4, default 2000) for full catalog entries. */
  readonly catalogBudget?: number
}

type ToolTree<R = never> = {
  readonly [name: string]: Definition<R> | ToolTree<R>
}

export type ResolvedExecutionLimits = {
  readonly timeoutMs: number | undefined
  readonly maxToolCalls: number | undefined
  readonly maxOutputBytes: number | undefined
}

/** Options for one CodeMode execution. */
export type ExecuteOptions<Tools extends Record<string, unknown> = {}> = {
  /** Source for one program in the supported JavaScript subset. */
  code: string
  /** Explicit tool tree exposed to the program as `tools`. */
  tools?: Tools & ToolTree<Services<Tools>>
  /** Per-execution overrides for the default resource limits. */
  limits?: ExecutionLimits
  /** Observes decoded tool input immediately before tool execution. */
  onToolCallStart?: (call: ToolRuntime.ToolCallStarted) => Effect.Effect<void, never, Services<Tools>>
  /** Observes each admitted tool call as it settles, with outcome and duration. */
  onToolCallEnd?: (call: ToolRuntime.ToolCallEnded) => Effect.Effect<void, never, Services<Tools>>
}

/** A JSON value that can cross the confined interpreter boundary. */
export type DataValue = Schema.Json

/** Configuration shared by `CodeMode.make` and `CodeMode.execute`. */
export type Options<Tools extends Record<string, unknown> = {}> = Omit<ExecuteOptions<Tools>, "code"> & {
  /** Progressive-disclosure configuration for the agent-facing tool catalog. */
  readonly discovery?: DiscoveryOptions
}

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

/** Reusable confined runtime over one explicit tool tree. */
export type Runtime<R = never> = {
  readonly catalog: () => ReadonlyArray<ToolDescription>
  readonly instructions: () => string
  readonly execute: (code: string) => Effect.Effect<Result, never, R>
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
export const execute = <const Tools extends Record<string, unknown>>(
  options: ExecuteOptions<Tools>,
): Effect.Effect<Result, never, Services<Tools>> => {
  const tools = (options.tools ?? {}) as HostTools<Services<Tools>>
  return executeWithLimits(options, resolveExecutionLimits(options.limits), ToolRuntime.searchIndex(tools))
}

/** Creates an Effect-native runtime over explicit, schema-described tools. */
export const make = <const Tools extends Record<string, unknown> = {}>(
  options: Options<Tools> = {} as Options<Tools>,
): Runtime<Services<Tools>> => {
  const tools = (options.tools ?? {}) as HostTools<Services<Tools>>
  const limits = resolveExecutionLimits(options.limits)
  const prepared = ToolRuntime.prepare(tools, options.discovery?.catalogBudget)

  return {
    catalog: () => prepared.catalog,
    instructions: () => prepared.instructions,
    execute: (code) => executeWithLimits<Tools>({ ...options, code }, limits, prepared.searchIndex),
  }
}
