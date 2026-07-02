import { parse } from "acorn"
import { Cause, Effect, Exit, Fiber, Schema, Semaphore } from "effect"
import { DiagnosticCategory, ModuleKind, ScriptTarget, flattenDiagnosticMessageText, transpileModule } from "typescript"
import {
  copyIn,
  copyOut,
  dataByteLength,
  isBlockedMember,
  ToolReference,
  ToolRuntime,
  ToolRuntimeError,
  type HostTools,
  type SafeObject,
  type ToolCall,
  type ToolDescription,
  type Services,
} from "./tool-runtime.js"
import type { Definition } from "./tool.js"
import { ToolError } from "./tool-error.js"
import { isSandboxValue, SandboxDate, SandboxMap, SandboxPromise, SandboxRegExp, SandboxSet } from "./values.js"

/** A tool call admitted during an execution. */
export type { ToolCall, ToolCallStarted, ToolDescription } from "./tool-runtime.js"
export { ToolError, toolError } from "./tool-error.js"

/** Resource budgets enforced independently during each CodeMode program execution. */
export type ExecutionLimits = {
  /** Maximum wall-clock execution time in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum number of tool calls admitted by the runtime. */
  readonly maxToolCalls?: number
  /**
   * Maximum UTF-8 bytes of model-facing output: the serialized result value plus captured
   * logs. Excess output is truncated with an explanatory marker instead of failing.
   */
  readonly maxOutputBytes?: number
}

/**
 * Internal execution knobs kept as fixed defaults behind the public limits.
 * Not part of the public contract; exposed only for tests and embedders that must tune
 * interpreter internals.
 *
 * @internal
 */
export type InternalExecutionLimits = ExecutionLimits & {
  /** Maximum interpreter work, including collection and string traversal. */
  readonly maxOperations?: number
  /** Maximum number of tool calls executing simultaneously. */
  readonly maxConcurrency?: number
  /** Maximum UTF-8 source size. */
  readonly maxSourceBytes?: number
  /** Maximum size of program values and the final result. */
  readonly maxDataBytes?: number
  /** Maximum retained tool-call audit data. */
  readonly maxAuditBytes?: number
  /** Maximum nesting depth for arrays and objects crossing data boundaries. */
  readonly maxValueDepth?: number
  /** Maximum array length or object field count. */
  readonly maxCollectionLength?: number
}

/** Controls how much of the tool catalog is inlined in agent instructions. */
export type DiscoveryOptions = {
  /**
   * Byte budget for inlined full tool signatures in agent instructions. Every namespace is
   * always listed with its tool count; as many full signatures as fit this budget are inlined
   * (cheapest-first within a namespace, namespaces alphabetical), and the instructions state
   * whether the list is COMPLETE or PARTIAL. `tools.$codemode.search` is always registered.
   */
  readonly maxInlineCatalogBytes?: number
}

type ToolTree<R = never> = {
  readonly [name: string]: Definition<R> | ToolTree<R>
}

type ResolvedExecutionLimits = {
  readonly timeoutMs: number
  readonly maxToolCalls: number
  readonly maxOutputBytes: number
  readonly maxOperations: number
  readonly maxConcurrency: number
  readonly maxSourceBytes: number
  readonly maxDataBytes: number
  readonly maxAuditBytes: number
  readonly maxValueDepth: number
  readonly maxCollectionLength: number
}

/** Options for one CodeMode execution. */
export type ExecuteOptions<Tools extends Record<string, unknown> = {}> = {
  /** Source for one program in the supported JavaScript subset. */
  code: string
  /** Explicit tool tree exposed to the program as `tools`. */
  tools?: Tools & ToolTree<any>
  /** Per-execution overrides for the default resource limits. */
  limits?: ExecutionLimits
  /** Observes decoded tool input immediately before tool execution. */
  onToolCallStart?: (call: ToolRuntime.ToolCallStarted) => Effect.Effect<void, never, Services<Tools>>
  /** Observes each admitted tool call as it settles, with outcome and duration. */
  onToolCallEnd?: (call: ToolRuntime.ToolCallEnded) => Effect.Effect<void, never, Services<Tools>>
}

/** A normalized program diagnostic safe to return across an agent tool boundary. */
export type Diagnostic = {
  readonly kind: DiagnosticKind
  readonly message: string
  readonly location?: { readonly line: number; readonly column: number }
  readonly suggestions?: ReadonlyArray<string>
}

/** A JSON value that can cross the confined interpreter boundary. */
export type DataValue = Schema.Json

/** Successful execution after the result has crossed the plain-data boundary. */
export type ExecuteSuccess = {
  readonly ok: true
  readonly value: DataValue
  readonly logs?: ReadonlyArray<string>
  /** Present when the value or logs were truncated to fit `maxOutputBytes`. */
  readonly truncated?: boolean
  readonly toolCalls: ReadonlyArray<ToolCall>
}

/** Failed execution with calls admitted before the diagnostic was produced. */
export type ExecuteFailure = {
  readonly ok: false
  readonly error: Diagnostic
  readonly logs?: ReadonlyArray<string>
  /** Present when the logs were truncated to fit `maxOutputBytes`. */
  readonly truncated?: boolean
  readonly toolCalls: ReadonlyArray<ToolCall>
}

/** Result of executing a CodeMode program. Program failures are data, not Effect failures. */
export type ExecuteResult = ExecuteSuccess | ExecuteFailure

/** Reusable CodeMode configuration shared by `execute` and `agentTool`. */
export type CodeModeOptions<Tools extends Record<string, unknown> = {}> = Omit<ExecuteOptions<Tools>, "code"> & {
  /** Progressive-disclosure configuration for the agent-facing tool catalog. */
  readonly discovery?: DiscoveryOptions
}

/** Input schema for the single agent-facing tool produced by `runtime.agentTool()`. */
export const ExecuteInputSchema = Schema.Struct({ code: Schema.String })

const DiagnosticKindSchema = Schema.Literals([
  "ParseError", "UnsupportedSyntax", "UnknownTool", "InvalidToolInput", "InvalidToolOutput", "InvalidDataValue",
  "OperationLimitExceeded", "ToolCallLimitExceeded", "AuditLimitExceeded", "TimeoutExceeded",
  "ToolFailure", "ExecutionFailure",
])

/** Structured success or diagnostic result schema returned by CodeMode execution. */
export const ExecuteResultSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Json,
    logs: Schema.optionalKey(Schema.Array(Schema.String)),
    truncated: Schema.optionalKey(Schema.Boolean),
    toolCalls: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.Struct({
      kind: DiagnosticKindSchema,
      message: Schema.String,
      location: Schema.optionalKey(Schema.Struct({ line: Schema.Number, column: Schema.Number })),
      suggestions: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
    logs: Schema.optionalKey(Schema.Array(Schema.String)),
    truncated: Schema.optionalKey(Schema.Boolean),
    toolCalls: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
])

/** Agent-facing projection of a configured CodeMode runtime. */
export type AgentToolDefinition<R = never> = {
  readonly name: "code"
  readonly description: string
  readonly input: typeof ExecuteInputSchema
  readonly output: typeof ExecuteResultSchema
  readonly execute: (input: { readonly code: string }) => Effect.Effect<ExecuteResult, never, R>
}

/** Reusable confined runtime over one explicit tool tree. */
export type CodeModeRuntime<R = never> = {
  /** Lists schema-described tool paths provided by the host. */
  readonly catalog: () => ReadonlyArray<ToolDescription>
  /** Builds model-facing syntax guidance and visible tool signatures. */
  readonly instructions: () => string
  /** Projects the configured runtime as one agent-facing `code` tool. */
  readonly agentTool: () => AgentToolDefinition<R>
  /** Executes a program using this runtime's configured host tools. */
  readonly execute: (code: string) => Effect.Effect<ExecuteResult, never, R>
}

type SourcePosition = {
  line: number
  column: number
}

type SourceLocation = {
  start: SourcePosition
  end: SourcePosition
}

type AstNode = {
  type: string
  loc?: SourceLocation
  [key: string]: unknown
}

type ProgramNode = AstNode & {
  type: "Program"
  body: Array<AstNode>
}

type Binding = {
  mutable: boolean
  value: unknown
  // Absent means initialized. `false` marks a parameter binding seeded into its scope but not
  // yet bound, so a default that forward-references a later parameter sees a TDZ error (as in JS)
  // rather than silently resolving to an outer binding of the same name.
  initialized?: boolean
}

type StatementResult =
  | { kind: "none" }
  | { kind: "value"; value: unknown }
  | { kind: "return"; value: unknown }
  | { kind: "break" }
  | { kind: "continue" }

type MemberReference = {
  target: SafeObject | Array<unknown>
  key: string | number
}

class CodeModeFunction {
  constructor(
    readonly parameters: ReadonlyArray<AstNode>,
    readonly body: AstNode,
    readonly capturedScopes: ReadonlyArray<Map<string, Binding>>,
  ) {}
}

class IntrinsicReference {
  constructor(
    readonly receiver: unknown,
    readonly name: string,
  ) {}
}

// A read-only computed member (e.g. `str.length`, a character index) — not assignable.
class ComputedValue {
  constructor(readonly value: unknown) {}
}

class PromiseNamespace {}

type PromiseMethodName = "all" | "allSettled" | "race" | "resolve" | "reject"

class PromiseMethodReference {
  constructor(readonly name: PromiseMethodName) {}
}

// A built-in global namespace (`Object`, `Math`, `JSON`, `Array`, ...); members resolve to a
// GlobalMethodReference, except known constants (e.g. `Math.PI`) which resolve to a value.
type GlobalNamespaceName = "Object" | "Math" | "JSON" | "Array" | "console" | "Date" | "RegExp" | "Map" | "Set"

class GlobalNamespace {
  constructor(readonly name: GlobalNamespaceName) {}
}

class GlobalMethodReference {
  constructor(readonly namespace: GlobalNamespaceName | "Number" | "String", readonly name: string) {}
}

// A built-in callable global (`Number`, `String`, `Boolean`, `parseInt`, `parseFloat`).
class CoercionFunction {
  constructor(readonly name: "Number" | "String" | "Boolean" | "parseInt" | "parseFloat") {}
}

class ProgramThrow {
  constructor(readonly value: unknown) {}
}

/** Stable categories produced by program, schema, tool, and budget failures. */
export type DiagnosticKind =
  | "ParseError"
  | "UnsupportedSyntax"
  | "UnknownTool"
  | "InvalidToolInput"
  | "InvalidToolOutput"
  | "InvalidDataValue"
  | "OperationLimitExceeded"
  | "ToolCallLimitExceeded"
  | "AuditLimitExceeded"
  | "TimeoutExceeded"
  | "ToolFailure"
  | "ExecutionFailure"

const arrayMethods = new Set([
  "map", "filter", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "includes", "join",
  "reduce", "reduceRight", "flatMap", "forEach", "sort", "toSorted", "slice", "concat", "indexOf", "lastIndexOf",
  "at", "flat", "reverse", "toReversed", "with", "push", "pop", "shift", "unshift",
])
const retryableArrayMethods = new Set(["splice", "fill", "copyWithin", "keys", "values", "entries"])

/**
 * Array methods whose cost is O(1) (or bounded by the argument count), so they must
 * NOT be charged the receiver's length. Charging `push` per element would make an
 * accumulation loop quadratic in the operation budget and trip it on legitimate code.
 */
const cheapArrayMethods = new Set(["push", "pop", "at"])

const mathConstants = new Set(["PI", "E", "LN2", "LN10", "LOG2E", "LOG10E", "SQRT2", "SQRT1_2"])

const numberMethods = new Set(["toFixed", "toPrecision", "toExponential", "toString"])

const stringMethods = new Set([
  "toLowerCase", "toUpperCase", "trim", "trimStart", "trimEnd", "split", "slice", "substring", "substr",
  "includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "replace", "replaceAll",
  "repeat", "padStart", "padEnd", "charAt", "charCodeAt", "codePointAt", "at", "concat", "toString",
  "match", "matchAll", "search",
])

const numberConstants = new Set(["MAX_SAFE_INTEGER", "MIN_SAFE_INTEGER", "MAX_VALUE", "MIN_VALUE", "EPSILON"])

const numberStatics = new Set(["isInteger", "isFinite", "isNaN", "isSafeInteger", "parseInt", "parseFloat"])

const stringStatics = new Set(["fromCharCode", "fromCodePoint"])

const consoleMethods = new Set(["log", "info", "debug", "warn", "error", "dir", "table"])

const promiseStatics = new Set<PromiseMethodName>(["all", "allSettled", "race", "resolve", "reject"])

const errorConstructors = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError"])

const valueConstructors = new Set(["Date", "RegExp", "Map", "Set"])

const dateMethods = new Set([
  "getTime", "valueOf", "toISOString", "toJSON", "toString",
  "getFullYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes", "getSeconds", "getMilliseconds",
  "getUTCFullYear", "getUTCMonth", "getUTCDate", "getUTCDay", "getUTCHours", "getUTCMinutes", "getUTCSeconds", "getUTCMilliseconds",
  "getTimezoneOffset",
])
const dateStatics = new Set(["now", "parse", "UTC"])

const regexpMethods = new Set(["test", "exec", "toString"])
// Read-only host regex fields surfaced as plain values.
const regexpProperties = new Set(["source", "flags", "lastIndex", "global", "ignoreCase", "multiline", "sticky", "unicode", "dotAll"])

const mapMethods = new Set(["get", "set", "has", "delete", "clear", "forEach", "keys", "values", "entries"])
const setMethods = new Set(["add", "has", "delete", "clear", "forEach", "keys", "values", "entries"])

const OptionalShortCircuit: unique symbol = Symbol("codemode.optional-short-circuit")

const supportedSyntaxMessage =
  "Supported orchestration syntax: tools.* calls (they return promises — resolve them with await), data literals, destructuring, optional chaining, template literals, conditionals, switch, loops (incl. for...of and for...in over object/array/tools keys), arrow functions, spread, try/catch, array methods (map/filter/find/findIndex/some/every/reduce/flatMap/forEach/sort/slice/concat/indexOf/lastIndexOf/at/flat/reverse/includes/join), string methods (incl. match/matchAll/replace/split with regular expressions), Date/RegExp/Map/Set, Object/Math/JSON helpers, captured console.log/warn/error/dir/table, and Promise.all/allSettled/race/resolve/reject over arrays mixing promises and plain values for parallel tool calls (promise chaining with .then/.catch is not supported — use await with try/catch)."

const unsupportedSyntax = (kind: string, node: AstNode): InterpreterRuntimeError =>
  new InterpreterRuntimeError(`Syntax '${kind}' is not supported in CodeMode. ${supportedSyntaxMessage}`, node, "UnsupportedSyntax", [supportedSyntaxMessage])

const defaultExecutionLimits = (): ResolvedExecutionLimits => ({
  timeoutMs: 10_000,
  maxToolCalls: 100,
  maxOutputBytes: 32_000,
  maxOperations: 100_000,
  maxConcurrency: 8,
  maxSourceBytes: 32_000,
  maxDataBytes: 256_000,
  maxAuditBytes: 1_000_000,
  maxValueDepth: 32,
  maxCollectionLength: 10_000,
})

const resolveLimit = (name: keyof InternalExecutionLimits, value: number | undefined, fallback: number, minimum: number): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`)
  }
  return value
}

const resolveExecutionLimits = (publicLimits?: ExecutionLimits): ResolvedExecutionLimits => {
  const defaults = defaultExecutionLimits()
  // The public contract is the three documented knobs; the remaining internal knobs are still
  // read (and validated) when supplied through InternalExecutionLimits, primarily by tests.
  const limits = publicLimits as InternalExecutionLimits | undefined
  return {
    timeoutMs: resolveLimit("timeoutMs", limits?.timeoutMs, defaults.timeoutMs, 1),
    maxToolCalls: resolveLimit("maxToolCalls", limits?.maxToolCalls, defaults.maxToolCalls, 0),
    maxOutputBytes: resolveLimit("maxOutputBytes", limits?.maxOutputBytes, defaults.maxOutputBytes, 0),
    maxOperations: resolveLimit("maxOperations", limits?.maxOperations, defaults.maxOperations, 0),
    maxConcurrency: resolveLimit("maxConcurrency", limits?.maxConcurrency, defaults.maxConcurrency, 1),
    maxSourceBytes: resolveLimit("maxSourceBytes", limits?.maxSourceBytes, defaults.maxSourceBytes, 0),
    maxDataBytes: resolveLimit("maxDataBytes", limits?.maxDataBytes, defaults.maxDataBytes, 0),
    maxAuditBytes: resolveLimit("maxAuditBytes", limits?.maxAuditBytes, defaults.maxAuditBytes, 0),
    maxValueDepth: resolveLimit("maxValueDepth", limits?.maxValueDepth, defaults.maxValueDepth, 0),
    maxCollectionLength: resolveLimit("maxCollectionLength", limits?.maxCollectionLength, defaults.maxCollectionLength, 0),
  }
}

class InterpreterRuntimeError extends Error {
  readonly node?: AstNode

  constructor(message: string, node?: AstNode, readonly kind: DiagnosticKind = "ExecutionFailure", readonly suggestions?: ReadonlyArray<string>) {
    super(message)
    this.name = "InterpreterRuntimeError"

    if (node) {
      this.node = node
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const asNode = (value: unknown, context: string): AstNode => {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new InterpreterRuntimeError(`Invalid AST node while reading ${context}.`)
  }

  return value as AstNode
}

const getArray = (node: AstNode, key: string): Array<unknown> => {
  const value = node[key]
  if (!Array.isArray(value)) {
    throw new InterpreterRuntimeError(`Expected '${key}' to be an array.`, node)
  }

  return value
}

const getString = (node: AstNode, key: string): string => {
  const value = node[key]
  if (typeof value !== "string") {
    throw new InterpreterRuntimeError(`Expected '${key}' to be a string.`, node)
  }

  return value
}

const getBoolean = (node: AstNode, key: string): boolean => {
  const value = node[key]
  if (typeof value !== "boolean") {
    throw new InterpreterRuntimeError(`Expected '${key}' to be a boolean.`, node)
  }

  return value
}

const getOptionalNode = (node: AstNode, key: string): AstNode | undefined => {
  const value = node[key]
  if (value === undefined || value === null) {
    return undefined
  }

  return asNode(value, key)
}

const getNode = (node: AstNode, key: string): AstNode => {
  const value = node[key]
  return asNode(value, key)
}

const parseProgram = (code: string): ProgramNode => {
  const transpiled = transpileModule(`async function __codemode__() {\n${code}\n}`, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
    },
  })
  const diagnostic = transpiled.diagnostics?.find((item) => item.category === DiagnosticCategory.Error)

  if (diagnostic) {
    throw new InterpreterRuntimeError(
      `Failed to parse TypeScript: ${flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
      undefined,
      "ParseError",
    )
  }

  const bodyStart = transpiled.outputText.indexOf("{") + 1
  const bodyEnd = transpiled.outputText.lastIndexOf("}")
  const executableCode = transpiled.outputText.slice(bodyStart, bodyEnd)
  const parsed = parse(executableCode, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    locations: true,
  }) as unknown

  if (!isRecord(parsed) || parsed.type !== "Program" || !Array.isArray(parsed.body)) {
    throw new InterpreterRuntimeError("Failed to parse script as a Program node.")
  }

  return parsed as ProgramNode
}

const formatLocation = (node?: AstNode): string => {
  if (!node || !node.loc) {
    return ""
  }

  const location = sourceLocation(node)
  return ` (line ${location.line}, col ${location.column})`
}

const sourceLocation = (node: AstNode): { readonly line: number; readonly column: number } => ({
  line: Math.max(1, (node.loc?.start.line ?? 2) - 1),
  column: Math.max(1, (node.loc?.start.column ?? 4) - 3),
})

const publicErrorMessage = (message: string): string =>
  message.replace(/\/(?:Users|home|private|tmp|var\/folders)\/[^\s"'`]+/g, "<redacted-path>")

const normalizeError = (error: unknown): Diagnostic => {
  if (error instanceof InterpreterRuntimeError) {
    return {
      kind: error.kind,
      message: `${error.message}${formatLocation(error.node)}`,
      ...(error.node?.loc ? { location: sourceLocation(error.node) } : {}),
      ...(error.suggestions ? { suggestions: error.suggestions } : {}),
    }
  }

  if (error instanceof ToolRuntimeError) {
    return {
      kind: error.kind,
      message: error.message,
      ...(error.suggestions.length > 0 ? { suggestions: error.suggestions } : {}),
    }
  }

  if (error instanceof ToolError) {
    return { kind: "ToolFailure", message: publicErrorMessage(error.message) }
  }

  if (error instanceof ProgramThrow) {
    const value = error.value
    let message: string
    if (containsRuntimeReference(value)) {
      // A thrown tool/function reference must not leak its internal structure.
      message = "a non-data value"
    } else if (typeof value === "string") {
      message = value
    } else if (value !== null && typeof value === "object" && typeof (value as { message?: unknown }).message === "string") {
      message = (value as { message: string }).message
    } else {
      try {
        message = JSON.stringify(copyOut(value)) ?? String(value)
      } catch {
        message = String(value)
      }
    }
    return { kind: "ExecutionFailure", message: `Uncaught: ${message}` }
  }

  if (error instanceof RangeError && /call stack|recursion/i.test(error.message)) {
    return {
      kind: "ExecutionFailure",
      message: "Execution exceeded the maximum nesting depth.",
    }
  }

  if (error instanceof Error) {
    return {
      kind: error.name === "SyntaxError" ? "ParseError" : "ExecutionFailure",
      message: publicErrorMessage(error.message),
    }
  }

  // A non-Error thrown by a host tool (raw string / number / Symbol) still routes through
  // path redaction so filesystem paths can never leak through the catch-all branch.
  return {
    kind: "ExecutionFailure",
    message: publicErrorMessage(String(error)),
  }
}

// The plain value a program observes for a settled failure — shared by `catch` bindings,
// `Promise.allSettled` rejection reasons, and race-loser diagnostics. A thrown program value
// passes through as-is (so `throw new Error(m)` yields its `{ name, message }` object); every
// other failure becomes a plain `{ message }` object. Interpreter errors use their raw message
// so the program never sees the transpiled-source "(line N, col N)" coordinates that
// normalizeError appends — without disturbing a host/tool message that legitimately ends that
// way. Other error kinds carry no appended location, so normalizeError is used as-is.
const caughtErrorValue = (thrown: unknown): unknown =>
  thrown instanceof ProgramThrow
    ? thrown.value
    : Object.assign(Object.create(null) as SafeObject, {
        message: thrown instanceof InterpreterRuntimeError ? thrown.message : normalizeError(thrown).message,
      })

// ── Built-in method/global implementations ───────────────────────────────────
// These mirror the corresponding JavaScript operations over Data Values. They are
// pure (string/Object/Math/JSON/coercion) and so live as free functions; array
// Methods that run CodeMode callbacks live on the interpreter (they need invokeFunction).

const boundedData = (value: unknown, label: string, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  const copied = copyIn(value, label, limits)
  if (dataByteLength(copied) > limits.maxDataBytes) {
    throw new InterpreterRuntimeError(`${label} exceeds the maximum data size of ${limits.maxDataBytes} bytes.`, node, "InvalidDataValue")
  }
  return copied
}

const isRuntimeReference = (value: unknown): boolean =>
    value instanceof CodeModeFunction || value instanceof ToolReference || value instanceof IntrinsicReference ||
    value instanceof GlobalNamespace || value instanceof GlobalMethodReference || value instanceof PromiseNamespace ||
    value instanceof PromiseMethodReference || value instanceof SandboxPromise || value instanceof CoercionFunction ||
    isSandboxValue(value)

const containsRuntimeReference = (value: unknown, seen = new Set<object>()): boolean => {
  if (isRuntimeReference(value)) return true
  if (value === null || typeof value !== "object") return false
  if (seen.has(value)) return false
  seen.add(value)
  const contains = Array.isArray(value)
    ? value.some((item) => containsRuntimeReference(item, seen))
    : Object.values(value).some((item) => containsRuntimeReference(item, seen))
  seen.delete(value)
  return contains
}

// Like containsRuntimeReference, but sandbox value types (Date/RegExp/Map/Set) count as data:
// operators and switch treat them as ordinary object operands (identity equality, ToPrimitive
// coercion) rather than rejecting them as opaque interpreter machinery.
const containsOpaqueReference = (value: unknown, seen = new Set<object>()): boolean => {
  if (isSandboxValue(value)) return false
  if (isRuntimeReference(value)) return true
  if (value === null || typeof value !== "object") return false
  if (seen.has(value)) return false
  seen.add(value)
  const contains = Array.isArray(value)
    ? value.some((item) => containsOpaqueReference(item, seen))
    : Object.values(value).some((item) => containsOpaqueReference(item, seen))
  seen.delete(value)
  return contains
}

// `typeof` never throws in JS; map every interpreter value to its JS-visible category.
// A SandboxPromise falls through to the final `typeof value` and reports "object", exactly
// like a real JS promise.
const typeofValue = (value: unknown): string => {
  if (
    value instanceof CodeModeFunction || value instanceof CoercionFunction || value instanceof IntrinsicReference ||
    value instanceof GlobalMethodReference || value instanceof PromiseMethodReference || value instanceof PromiseNamespace
  ) return "function"
  if (value instanceof ToolReference) return value.path.length > 0 ? "function" : "object"
  if (value instanceof GlobalNamespace) {
    return value.name === "Math" || value.name === "JSON" || value.name === "console" ? "object" : "function"
  }
  return typeof value
}

const runtimeValueBytes = (
  value: unknown,
  label: string,
  node: AstNode,
  limits: ResolvedExecutionLimits,
  depth = 0,
  seen = new Set<object>(),
): number => {
  if (depth > limits.maxValueDepth) {
    throw new InterpreterRuntimeError(`${label} exceeds the maximum value depth of ${limits.maxValueDepth}.`, node, "InvalidDataValue")
  }
  // Sandbox values are charged real sizes (a Map/Set can hold arbitrary program data, so a
  // zero-cost reference would be an unaccounted-memory hole), and their walks are cycle-checked.
  if (value instanceof SandboxDate) return 26
  if (value instanceof SandboxRegExp) return dataByteLength(value.regex.source) + value.regex.flags.length + 2
  if (value instanceof SandboxMap || value instanceof SandboxSet) {
    if (seen.has(value)) throw new InterpreterRuntimeError(`${label} contains a circular value.`, node, "InvalidDataValue")
    seen.add(value)
    const entries = value instanceof SandboxMap
      ? Array.from(value.map.entries())
      : Array.from(value.set.values(), (item): [unknown, unknown] => [item, null])
    if (entries.length > limits.maxCollectionLength) {
      throw new InterpreterRuntimeError(`${label} exceeds the maximum collection length of ${limits.maxCollectionLength}.`, node, "InvalidDataValue")
    }
    let bytes = 2
    for (const [key, item] of entries) {
      bytes += runtimeValueBytes(key, label, node, limits, depth + 1, seen) + runtimeValueBytes(item, label, node, limits, depth + 1, seen) + 2
    }
    seen.delete(value)
    return bytes
  }
  if (isRuntimeReference(value)) return 0
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return dataByteLength(value)
  }
  if (typeof value !== "object") {
    throw new InterpreterRuntimeError(`${label} must contain data or CodeMode references only.`, node, "InvalidDataValue")
  }
  if (seen.has(value)) throw new InterpreterRuntimeError(`${label} contains a circular value.`, node, "InvalidDataValue")
  seen.add(value)
  let bytes = 2
  if (Array.isArray(value)) {
    if (value.length > limits.maxCollectionLength) {
      throw new InterpreterRuntimeError(`${label} exceeds the maximum collection length of ${limits.maxCollectionLength}.`, node, "InvalidDataValue")
    }
    for (const item of value) bytes += runtimeValueBytes(item, label, node, limits, depth + 1, seen) + 1
  } else {
    const entries = Object.entries(value)
    if (entries.length > limits.maxCollectionLength) {
      throw new InterpreterRuntimeError(`${label} exceeds the maximum collection length of ${limits.maxCollectionLength}.`, node, "InvalidDataValue")
    }
    for (const [key, item] of entries) {
      if (isBlockedMember(key)) throw new InterpreterRuntimeError(`${label} contains blocked property '${key}'.`, node, "InvalidDataValue")
      bytes += dataByteLength(key) + runtimeValueBytes(item, label, node, limits, depth + 1, seen) + 1
    }
  }
  seen.delete(value)
  return bytes
}

const boundedProgramValue = (value: unknown, label: string, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  if (runtimeValueBytes(value, label, node, limits) > limits.maxDataBytes) {
    throw new InterpreterRuntimeError(`${label} exceeds the maximum data size of ${limits.maxDataBytes} bytes.`, node, "InvalidDataValue")
  }
  return value
}

// A cheap proxy for the work an O(n) built-in performed, used to charge the operation budget.
const workUnits = (value: unknown): number => {
  if (typeof value === "string" || Array.isArray(value)) return value.length
  if (value !== null && typeof value === "object") return Object.keys(value).length
  return 1
}

// A string method's pattern argument as a host regex: a sandbox regex passes its own host
// instance through (so `g` lastIndex semantics follow the spec across calls); a string becomes
// a pattern, exactly as String.prototype.match/matchAll/search do (`extraFlags` adds matchAll's
// implicit `g`). Invalid patterns fail as catchable program errors.
const toHostRegex = (arg: unknown, method: string, node: AstNode, extraFlags = ""): RegExp => {
  if (arg instanceof SandboxRegExp) return arg.regex
  if (typeof arg === "string") {
    try {
      return new RegExp(arg, extraFlags)
    } catch (error) {
      throw new InterpreterRuntimeError(`Invalid regular expression in String.${method}: ${error instanceof Error ? error.message : String(error)}`, node)
    }
  }
  throw new InterpreterRuntimeError(`String.${method} expects a regular expression or string pattern.`, node)
}

// A host match result as a sandbox value: a plain array of the full match and captures, with
// `index` and named `groups` attached as own array properties (readable, and dropped at data
// boundaries exactly like JSON.stringify drops them in JS). `input` is omitted — it duplicates
// the whole subject string per match.
const matchToValue = (match: RegExpMatchArray): Array<unknown> => {
  const result: Array<unknown> = Array.from(match, (group) => group)
  if (match.index !== undefined) (result as Record<string, unknown> & Array<unknown>).index = match.index
  if (match.groups) {
    const groups: SafeObject = Object.create(null) as SafeObject
    for (const [key, group] of Object.entries(match.groups)) {
      if (!isBlockedMember(key)) groups[key] = group
    }
    ;(result as Record<string, unknown> & Array<unknown>).groups = groups
  }
  return result
}

const invokeStringMethod = (value: string, name: string, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  const str = (index: number): string => {
    const arg = args[index]
    if (typeof arg !== "string") throw new InterpreterRuntimeError(`String.${name} expects argument ${index + 1} to be a string.`, node)
    return arg
  }
  const num = (index: number): number => {
    const arg = args[index]
    if (typeof arg !== "number") throw new InterpreterRuntimeError(`String.${name} expects argument ${index + 1} to be a number.`, node)
    return arg
  }
  const optNum = (index: number): number | undefined => (args[index] === undefined ? undefined : num(index))
  const optStr = (index: number): string | undefined => (args[index] === undefined ? undefined : str(index))
  const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength
  const limitString = (bytes: number): void => {
    if (bytes > limits.maxDataBytes) {
      throw new InterpreterRuntimeError(`String.${name} exceeds the maximum data size of ${limits.maxDataBytes} bytes.`, node, "InvalidDataValue")
    }
  }
  const replacementCount = (search: string): number => {
    if (search === "") return value.length + 1
    let count = 0
    let offset = 0
    while ((offset = value.indexOf(search, offset)) !== -1) {
      count += 1
      offset += search.length
    }
    return count
  }

  let result: unknown
  switch (name) {
    case "toLowerCase": result = value.toLowerCase(); break
    case "toUpperCase": result = value.toUpperCase(); break
    case "trim": result = value.trim(); break
    case "trimStart": result = value.trimStart(); break
    case "trimEnd": result = value.trimEnd(); break
    case "split": {
      if (args.length === 0) {
        result = [value]
        break
      }
      if (args[0] instanceof SandboxRegExp) {
        const parts = value.split((args[0] as SandboxRegExp).regex, optNum(1))
        if (parts.length > limits.maxCollectionLength) {
          throw new InterpreterRuntimeError(`String.split exceeds the maximum collection length of ${limits.maxCollectionLength}.`, node, "InvalidDataValue")
        }
        result = parts
        break
      }
      const separator = str(0)
      const requestedLimit = optNum(1)
      const effectiveLimit = requestedLimit === undefined ? undefined : requestedLimit >>> 0
      const maximumParts = separator === "" ? value.length : replacementCount(separator) + 1
      const parts = effectiveLimit === undefined ? maximumParts : Math.min(maximumParts, effectiveLimit)
      if (parts > limits.maxCollectionLength) {
        throw new InterpreterRuntimeError(`String.split exceeds the maximum collection length of ${limits.maxCollectionLength}.`, node, "InvalidDataValue")
      }
      result = value.split(separator, effectiveLimit)
      break
    }
    case "slice": result = value.slice(optNum(0), optNum(1)); break
    case "includes": result = value.includes(str(0), optNum(1)); break
    case "startsWith": result = value.startsWith(str(0), optNum(1)); break
    case "endsWith": result = value.endsWith(str(0), optNum(1)); break
    case "indexOf": result = value.indexOf(str(0), optNum(1)); break
    case "lastIndexOf": result = value.lastIndexOf(str(0), optNum(1)); break
    case "replace":
    case "replaceAll": {
      if (args[0] instanceof CodeModeFunction || args[1] instanceof CodeModeFunction) {
        throw new InterpreterRuntimeError(`String.${name} does not support function replacers in CodeMode; use match/matchAll and rebuild the string instead.`, node, "UnsupportedSyntax", [supportedSyntaxMessage])
      }
      if (args[0] instanceof SandboxRegExp) {
        const pattern = (args[0] as SandboxRegExp).regex
        const replacement = str(1)
        if (name === "replaceAll" && !pattern.global) {
          throw new InterpreterRuntimeError("String.replaceAll requires a regular expression with the global (g) flag.", node)
        }
        // Growth cannot be pre-computed for patterns; the input and replacement are already
        // byte-bounded, so bound the produced string instead.
        const replaced = name === "replace" ? value.replace(pattern, replacement) : value.replaceAll(pattern, replacement)
        limitString(byteLength(replaced))
        result = replaced
        break
      }
      if (name === "replace") {
        result = value.replace(str(0), str(1))
        break
      }
      const search = str(0)
      const replacement = str(1)
      const growth = Math.max(0, byteLength(replacement) - byteLength(search))
      limitString(byteLength(value) + replacementCount(search) * growth)
      result = value.replaceAll(search, replacement)
      break
    }
    case "match": {
      const pattern = toHostRegex(args[0], name, node)
      const matched = value.match(pattern)
      if (matched === null) return null
      // A global match is a plain array of matched strings; a non-global match carries
      // index/groups own properties, so bypass the copying data checkpoint to keep them.
      if (pattern.global) return boundedData(matched, "String.match result", node, limits)
      return boundedProgramValue(matchToValue(matched), "String.match result", node, limits)
    }
    case "matchAll": {
      const pattern = toHostRegex(args[0], name, node, "g")
      if (!pattern.global) {
        throw new InterpreterRuntimeError("String.matchAll requires a regular expression with the global (g) flag.", node)
      }
      // Materialized as an array (not an iterator); each entry is a match array with
      // index/groups own properties. Match count is bounded by the subject length.
      const matches = Array.from(value.matchAll(pattern), matchToValue)
      if (matches.length > limits.maxCollectionLength) {
        throw new InterpreterRuntimeError(`String.matchAll exceeds the maximum collection length of ${limits.maxCollectionLength}.`, node, "InvalidDataValue")
      }
      return boundedProgramValue(matches, "String.matchAll result", node, limits)
    }
    case "search": {
      result = value.search(toHostRegex(args[0], name, node))
      break
    }
    case "repeat": {
      const count = num(0)
      if (!Number.isFinite(count) || count < 0) throw new InterpreterRuntimeError("String.repeat expects a finite non-negative count.", node)
      limitString(byteLength(value) * Math.floor(count))
      result = value.repeat(count)
      break
    }
    case "padStart": {
      const length = num(0)
      limitString(Math.max(0, length))
      result = value.padStart(length, optStr(1))
      break
    }
    case "padEnd": {
      const length = num(0)
      limitString(Math.max(0, length))
      result = value.padEnd(length, optStr(1))
      break
    }
    case "charAt": result = value.charAt(optNum(0) ?? 0); break
    case "at": result = value.at(optNum(0) ?? 0); break
    case "substring": result = value.substring(optNum(0) ?? 0, optNum(1)); break
    case "substr": result = value.substr(optNum(0) ?? 0, optNum(1)); break
    // JS charCodeAt returns NaN out of range; NaN flows as an ordinary in-sandbox value
    // (normalized to null only at the data boundary — see copyOut), so return it as-is.
    case "charCodeAt": result = value.charCodeAt(optNum(0) ?? 0); break
    case "codePointAt": result = value.codePointAt(optNum(0) ?? 0); break
    case "toString": result = value; break
    case "concat": {
      const pieces = args.map((_, index) => str(index))
      limitString(byteLength(value) + pieces.reduce((size, piece) => size + byteLength(piece), 0))
      result = value.concat(...pieces)
      break
    }
    default: throw new InterpreterRuntimeError(`String method '${name}' is not available in CodeMode.`, node)
  }
  return boundedData(result, `String.${name} result`, node, limits)
}

const invokeNumberMethod = (value: number, name: string, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  const optNum = (index: number): number | undefined => {
    const arg = args[index]
    if (arg === undefined) return undefined
    if (typeof arg !== "number") throw new InterpreterRuntimeError(`Number.${name} expects a number argument.`, node)
    return arg
  }
  let result: unknown
  switch (name) {
    case "toFixed": result = value.toFixed(optNum(0)); break
    case "toExponential": result = value.toExponential(optNum(0)); break
    case "toPrecision": {
      const digits = optNum(0)
      result = digits === undefined ? value.toString() : value.toPrecision(digits)
      break
    }
    case "toString": {
      const radix = optNum(0)
      if (radix !== undefined && (radix < 2 || radix > 36)) {
        throw new InterpreterRuntimeError("Number.toString radix must be between 2 and 36.", node)
      }
      result = value.toString(radix)
      break
    }
    default: throw new InterpreterRuntimeError(`Number method '${name}' is not available in CodeMode.`, node)
  }
  return boundedData(result, `Number.${name} result`, node, limits)
}

// JavaScript's String(...) without tripping over CodeMode's null-prototype data objects.
const coerceToString = (value: unknown): string => {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  // Sandbox values stringify deterministically: Date as ISO (not the host's locale/timezone
  // toString), RegExp as its literal form, Map/Set with their JS Object.prototype tags.
  if (value instanceof SandboxDate) return Number.isFinite(value.time) ? new Date(value.time).toISOString() : "Invalid Date"
  if (value instanceof SandboxRegExp) return `/${value.regex.source}/${value.regex.flags}`
  if (value instanceof SandboxMap) return "[object Map]"
  if (value instanceof SandboxSet) return "[object Set]"
  if (typeof value === "object") {
    return Array.isArray(value)
      ? value.map((item) => (item === null || item === undefined ? "" : coerceToString(item))).join(",")
      : "[object Object]"
  }
  return String(value)
}

const coerceToNumber = (value: unknown): number => {
  if (value instanceof SandboxDate) return value.time
  if (isSandboxValue(value)) return Number.NaN
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Number.NaN : Number(value)
}

const invokeCoercion = (ref: CoercionFunction, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  // Sandbox values coerce before the data checkpoint (which would JSON-serialize them):
  // Number(date) is its time value, String(date) its ISO form, Boolean(x) is true.
  const raw = args[0]
  if (isSandboxValue(raw)) {
    if (ref.name === "Boolean") return true
    if (ref.name === "Number") return coerceToNumber(raw)
    if (ref.name === "String") return coerceToString(raw)
    if (ref.name === "parseInt") return parseInt(coerceToString(raw))
    return parseFloat(coerceToString(raw))
  }
  const value = boundedData(args[0], `${ref.name} input`, node, limits)
  if (ref.name === "Number") return coerceToNumber(value)
  if (ref.name === "Boolean") return Boolean(value)
  if (ref.name === "parseInt") {
    const radix = args[1]
    if (radix !== undefined && typeof radix !== "number") throw new InterpreterRuntimeError("parseInt expects a numeric radix.", node)
    return parseInt(coerceToString(value), radix)
  }
  if (ref.name === "parseFloat") return parseFloat(coerceToString(value))
  return coerceToString(value)
}

const invokeObjectMethod = (name: string, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  const requireObject = (): Record<string, unknown> => {
    const value = boundedData(args[0], `Object.${name} input`, node, limits)
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new InterpreterRuntimeError(`Object.${name} expects a data object.`, node)
    }
    return value as Record<string, unknown>
  }
  const guardedSet = (out: Record<string, unknown>, key: string, item: unknown): void => {
    if (isBlockedMember(key)) throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, node)
    out[key] = item
  }
  switch (name) {
    case "keys": {
      // Object.keys(array) yields index strings (["0", "1", ...]) exactly as in JS; objects
      // yield their own enumerable keys. (Tool references never reach here — the interpreter
      // resolves them against the host tool tree first.)
      const value = boundedData(args[0], "Object.keys input", node, limits)
      if (Array.isArray(value)) return Object.keys(value)
      if (value === null || typeof value !== "object") {
        throw new InterpreterRuntimeError("Object.keys expects a data object or array.", node)
      }
      return Object.keys(value)
    }
    case "values": return Object.values(requireObject())
    case "entries": return Object.entries(requireObject()).map(([key, item]) => [key, item])
    case "hasOwn": return Object.hasOwn(requireObject(), String(args[1]))
    case "assign": {
      const out: Record<string, unknown> = Object.create(null)
      for (const source of args) {
        if (source === null || source === undefined) continue
        const value = boundedData(source, "Object.assign input", node, limits)
        if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InterpreterRuntimeError("Object.assign expects data objects.", node)
        for (const [key, item] of Object.entries(value)) guardedSet(out, key, item)
      }
      return out
    }
    case "fromEntries": {
      // A Map is the idiomatic fromEntries source; use its entries directly (the data
      // checkpoint would serialize a Map to {}).
      if (args[0] instanceof SandboxMap) {
        const out: Record<string, unknown> = Object.create(null)
        for (const [key, item] of (args[0] as SandboxMap).map.entries()) guardedSet(out, coerceToString(key), item)
        return out
      }
      const pairs = boundedData(args[0], "Object.fromEntries input", node, limits)
      if (!Array.isArray(pairs)) throw new InterpreterRuntimeError("Object.fromEntries expects an array of [key, value] pairs.", node)
      const out: Record<string, unknown> = Object.create(null)
      for (const pair of pairs) {
        if (!Array.isArray(pair)) throw new InterpreterRuntimeError("Object.fromEntries expects [key, value] pairs.", node)
        guardedSet(out, String(pair[0]), pair[1])
      }
      return out
    }
    default: throw new InterpreterRuntimeError(`Object.${name} is not available in CodeMode.`, node)
  }
}

const invokeMathMethod = (name: string, args: Array<unknown>, node: AstNode): number => {
  const nums = args.map((arg) => {
    if (typeof arg !== "number") throw new InterpreterRuntimeError(`Math.${name} expects number arguments.`, node)
    return arg
  })
  const [a = Number.NaN, b = Number.NaN] = nums
  switch (name) {
    case "max": return Math.max(...nums)
    case "min": return Math.min(...nums)
    case "abs": return Math.abs(a)
    case "floor": return Math.floor(a)
    case "ceil": return Math.ceil(a)
    case "round": return Math.round(a)
    case "trunc": return Math.trunc(a)
    case "sign": return Math.sign(a)
    case "sqrt": return Math.sqrt(a)
    case "cbrt": return Math.cbrt(a)
    case "pow": return Math.pow(a, b)
    case "hypot": return Math.hypot(...nums)
    case "log": return Math.log(a)
    case "log2": return Math.log2(a)
    case "log10": return Math.log10(a)
    case "exp": return Math.exp(a)
    default: throw new InterpreterRuntimeError(`Math.${name} is not available in CodeMode.`, node)
  }
}

const invokeJsonMethod = (name: string, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  switch (name) {
    case "stringify": {
      const replacer = args[1]
      if (Array.isArray(replacer) || replacer instanceof CodeModeFunction) {
        throw new InterpreterRuntimeError("JSON.stringify replacers are not supported in CodeMode.", node, "UnsupportedSyntax", [supportedSyntaxMessage])
      }
      const space = args[2]
      const indent = typeof space === "number" || typeof space === "string" ? space : undefined
      // copyIn first so only Data Values serialize, never a CodeModeFunction/ToolReference.
      return JSON.stringify(copyOut(copyIn(args[0], "JSON.stringify value", limits)), null, indent)
    }
    case "parse": {
      const text = args[0]
      if (typeof text !== "string") throw new InterpreterRuntimeError("JSON.parse expects a string.", node)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new InterpreterRuntimeError("JSON.parse received invalid JSON.", node)
      }
      return copyIn(parsed, "JSON.parse result", limits)
    }
    default: throw new InterpreterRuntimeError(`JSON.${name} is not available in CodeMode.`, node)
  }
}

const invokeArrayStatic = (name: string, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  switch (name) {
    case "isArray":
      return Array.isArray(args[0])
    case "of":
      return [...args]
    case "from": {
      if (args.length > 1) {
        throw new InterpreterRuntimeError(
          "Array.from(...) does not support a map function in CodeMode; call .map() on the result instead.",
          node,
          "UnsupportedSyntax",
          [supportedSyntaxMessage],
        )
      }
      // Map/Set materialize directly (the data checkpoint would serialize them to {}).
      if (args[0] instanceof SandboxMap) return Array.from((args[0] as SandboxMap).map.entries(), ([key, item]) => [key, item])
      if (args[0] instanceof SandboxSet) return Array.from((args[0] as SandboxSet).set.values())
      const source = boundedData(args[0], "Array.from input", node, limits)
      if (typeof source === "string") return Array.from(source)
      if (Array.isArray(source)) return [...source]
      if (source !== null && typeof source === "object" && typeof (source as { length?: unknown }).length === "number") {
        return Array.from(source as ArrayLike<unknown>)
      }
      throw new InterpreterRuntimeError("Array.from expects an array, string, Map, Set, or array-like value.", node)
    }
    default:
      throw new InterpreterRuntimeError(`Array.${name} is not available in CodeMode.`, node)
  }
}

const invokeNumberStatic = (name: string, args: Array<unknown>, node: AstNode): unknown => {
  const value = args[0]
  switch (name) {
    case "isInteger": return Number.isInteger(value)
    case "isFinite": return Number.isFinite(value)
    case "isNaN": return Number.isNaN(value)
    case "isSafeInteger": return Number.isSafeInteger(value)
    case "parseInt": {
      const radix = args[1]
      if (radix !== undefined && typeof radix !== "number") throw new InterpreterRuntimeError("Number.parseInt expects a numeric radix.", node)
      return parseInt(coerceToString(value), radix)
    }
    case "parseFloat": return parseFloat(coerceToString(value))
    default: throw new InterpreterRuntimeError(`Number.${name} is not available in CodeMode.`, node)
  }
}

const invokeStringStatic = (name: string, args: Array<unknown>, node: AstNode): unknown => {
  const codes = args.map((arg) => {
    if (typeof arg !== "number") throw new InterpreterRuntimeError(`String.${name} expects number arguments.`, node)
    return arg
  })
  switch (name) {
    case "fromCharCode": return String.fromCharCode(...codes)
    case "fromCodePoint": return String.fromCodePoint(...codes)
    default: throw new InterpreterRuntimeError(`String.${name} is not available in CodeMode.`, node)
  }
}

const invokeDateStatic = (name: string, args: Array<unknown>, node: AstNode): number => {
  switch (name) {
    case "now": return Date.now()
    case "parse": return Date.parse(coerceToString(args[0]))
    case "UTC": {
      const parts = args.map((arg) => coerceToNumber(arg))
      return Date.UTC(...(parts as Parameters<typeof Date.UTC>))
    }
    default: throw new InterpreterRuntimeError(`Date.${name} is not available in CodeMode.`, node)
  }
}

const invokeDateMethod = (value: SandboxDate, name: string, node: AstNode): unknown => {
  const hosted = new Date(value.time)
  switch (name) {
    case "getTime": case "valueOf": return value.time
    case "toISOString": {
      if (!Number.isFinite(value.time)) throw new InterpreterRuntimeError("Invalid time value.", node)
      return hosted.toISOString()
    }
    // toJSON of an invalid date is null in JS (never a throw); toString stays ISO for
    // determinism across host timezones/locales.
    case "toJSON": return Number.isFinite(value.time) ? hosted.toISOString() : null
    case "toString": return coerceToString(value)
    case "getFullYear": return hosted.getFullYear()
    case "getMonth": return hosted.getMonth()
    case "getDate": return hosted.getDate()
    case "getDay": return hosted.getDay()
    case "getHours": return hosted.getHours()
    case "getMinutes": return hosted.getMinutes()
    case "getSeconds": return hosted.getSeconds()
    case "getMilliseconds": return hosted.getMilliseconds()
    case "getUTCFullYear": return hosted.getUTCFullYear()
    case "getUTCMonth": return hosted.getUTCMonth()
    case "getUTCDate": return hosted.getUTCDate()
    case "getUTCDay": return hosted.getUTCDay()
    case "getUTCHours": return hosted.getUTCHours()
    case "getUTCMinutes": return hosted.getUTCMinutes()
    case "getUTCSeconds": return hosted.getUTCSeconds()
    case "getUTCMilliseconds": return hosted.getUTCMilliseconds()
    case "getTimezoneOffset": return hosted.getTimezoneOffset()
    default: throw new InterpreterRuntimeError(`Date method '${name}' is not available in CodeMode.`, node)
  }
}

const invokeRegExpMethod = (value: SandboxRegExp, name: string, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  switch (name) {
    // test/exec run on the sandbox regex's own host instance, so `g`-flag lastIndex advances
    // across calls per the spec.
    case "test": return value.regex.test(coerceToString(args[0]))
    case "exec": {
      const matched = value.regex.exec(coerceToString(args[0]))
      if (matched === null) return null
      return boundedProgramValue(matchToValue(matched), "RegExp.exec result", node, limits)
    }
    case "toString": return coerceToString(value)
    default: throw new InterpreterRuntimeError(`RegExp method '${name}' is not available in CodeMode.`, node)
  }
}

const invokeGlobalMethod = (ref: GlobalMethodReference, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  if (ref.namespace === "console") throw new InterpreterRuntimeError(`console.${ref.name} is not available in CodeMode.`, node)
  if (ref.namespace === "Object") return invokeObjectMethod(ref.name, args, node, limits)
  if (ref.namespace === "Math") return invokeMathMethod(ref.name, args, node)
  if (ref.namespace === "Array") return invokeArrayStatic(ref.name, args, node, limits)
  if (ref.namespace === "Number") return invokeNumberStatic(ref.name, args, node)
  if (ref.namespace === "String") return invokeStringStatic(ref.name, args, node)
  if (ref.namespace === "Date") {
    if (!dateStatics.has(ref.name)) throw new InterpreterRuntimeError(`Date.${ref.name} is not available in CodeMode.`, node)
    return invokeDateStatic(ref.name, args, node)
  }
  if (ref.namespace === "RegExp" || ref.namespace === "Map" || ref.namespace === "Set") {
    throw new InterpreterRuntimeError(`${ref.namespace}.${ref.name} is not available in CodeMode.`, node)
  }
  return invokeJsonMethod(ref.name, args, node, limits)
}

// Iterable spread sources: arrays, strings (code points), Maps (entry pairs), and Sets (values).
const spreadItems = (spread: unknown): Array<unknown> | undefined => {
  if (Array.isArray(spread)) return spread
  if (typeof spread === "string") return Array.from(spread)
  if (spread instanceof SandboxMap) return Array.from(spread.map.entries(), ([key, item]): Array<unknown> => [key, item])
  if (spread instanceof SandboxSet) return Array.from(spread.set.values())
  return undefined
}

// Every identifier a parameter pattern binds, used to seed TDZ slots before defaults run.
const collectPatternNames = (pattern: AstNode, out: Array<string> = []): Array<string> => {
  switch (pattern.type) {
    case "Identifier":
      out.push(getString(pattern, "name"))
      break
    case "AssignmentPattern":
      collectPatternNames(getNode(pattern, "left"), out)
      break
    case "RestElement":
      collectPatternNames(getNode(pattern, "argument"), out)
      break
    case "ArrayPattern":
      for (const element of getArray(pattern, "elements")) {
        if (element !== null) collectPatternNames(asNode(element, "elements"), out)
      }
      break
    case "ObjectPattern":
      for (const property of getArray(pattern, "properties")) {
        const prop = asNode(property, "properties")
        collectPatternNames(prop.type === "RestElement" ? getNode(prop, "argument") : getNode(prop, "value"), out)
      }
      break
  }
  return out
}

class Interpreter<R> {
  private scopes: Array<Map<string, Binding>>
  private readonly limits: ResolvedExecutionLimits
  private readonly invokeTool: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
  // Enumerable namespace/tool names at a node of the host tool tree, threaded from
  // ToolRuntime.make like invokeTool: the interpreter never holds the tree itself.
  private readonly toolKeys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
  private readonly budget: { operations: number }
  private readonly logs: Array<string>
  private readonly logBudget: { bytes: number }
  private lastValue: unknown
  // Caps how many eagerly forked tool calls run at once (the parallel-call concurrency limit).
  private readonly callPermits: Semaphore.Semaphore
  // Fiber-backed promises whose settlement no program construct has observed yet. Successful
  // program completion drains these (like a runtime waiting on in-flight work at exit) and
  // surfaces a never-awaited failure as an unhandled-rejection diagnostic.
  private readonly pendingSettlements = new Set<SandboxPromise>()
  // Cached byte size (and, for objects, key count) of each live container, maintained incrementally
  // by the mutation helpers so appending in a loop is O(1)/op rather than re-walking the whole
  // container each time (which made push/index-assign/key-assign loops O(n^2) — a CPU DoS). These
  // are a fast path under the authoritative copyIn/copyOut boundary checks, never a replacement.
  private readonly containerSizes = new WeakMap<object, number>()
  private readonly objectCounts = new WeakMap<object, number>()

  constructor(
    limits: ResolvedExecutionLimits,
    invokeTool: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>,
    toolKeys: (path: ReadonlyArray<string>) => ReadonlyArray<string>,
    budget: { operations: number } = { operations: 0 },
    logs: Array<string> = [],
    logBudget: { bytes: number } = { bytes: 0 },
  ) {
    const globalScope = new Map<string, Binding>()
    this.scopes = [globalScope]
    this.limits = limits
    this.invokeTool = invokeTool
    this.toolKeys = toolKeys
    this.budget = budget
    this.logs = logs
    this.logBudget = logBudget
    this.lastValue = undefined
    this.callPermits = Semaphore.makeUnsafe(limits.maxConcurrency)
    globalScope.set("tools", { mutable: false, value: new ToolReference([]) })
    globalScope.set("Promise", { mutable: false, value: new PromiseNamespace() })
    globalScope.set("undefined", { mutable: false, value: undefined })
    globalScope.set("Object", { mutable: false, value: new GlobalNamespace("Object") })
    globalScope.set("Math", { mutable: false, value: new GlobalNamespace("Math") })
    globalScope.set("JSON", { mutable: false, value: new GlobalNamespace("JSON") })
    globalScope.set("Number", { mutable: false, value: new CoercionFunction("Number") })
    globalScope.set("String", { mutable: false, value: new CoercionFunction("String") })
    globalScope.set("Boolean", { mutable: false, value: new CoercionFunction("Boolean") })
    globalScope.set("Array", { mutable: false, value: new GlobalNamespace("Array") })
    globalScope.set("console", { mutable: false, value: new GlobalNamespace("console") })
    globalScope.set("parseInt", { mutable: false, value: new CoercionFunction("parseInt") })
    globalScope.set("parseFloat", { mutable: false, value: new CoercionFunction("parseFloat") })
    globalScope.set("Date", { mutable: false, value: new GlobalNamespace("Date") })
    globalScope.set("RegExp", { mutable: false, value: new GlobalNamespace("RegExp") })
    globalScope.set("Map", { mutable: false, value: new GlobalNamespace("Map") })
    globalScope.set("Set", { mutable: false, value: new GlobalNamespace("Set") })
    // NaN/Infinity flow as ordinary in-sandbox values (normalized to null only at the data
    // boundary — see copyOut), so their global bindings must exist too, e.g. `reduce(max, -Infinity)`.
    globalScope.set("NaN", { mutable: false, value: NaN })
    globalScope.set("Infinity", { mutable: false, value: Infinity })
  }

  run(program: ProgramNode): Effect.Effect<unknown, unknown, R> {
    const self = this
    // Run the program body in its own module scope on top of the builtin global scope, so
    // top-level declarations (`let undefined = 5`, `const Object = ...`) shadow builtins like
    // JS module scope, instead of colliding with the seeded globals.
    this.pushScope()
    return Effect.gen(function*() {
      self.hoistFunctions(program.body)
      let value: unknown = undefined
      let returned = false
      for (const statement of program.body) {
        const result = yield* self.evaluateStatement(statement)

        if (result.kind === "return") {
          value = result.value
          returned = true
          break
        }

        if (result.kind === "break" || result.kind === "continue") {
          throw new InterpreterRuntimeError(`Unexpected '${result.kind}' outside of a loop.`, statement)
        }

        if (result.kind === "value") {
          self.lastValue = result.value
        }
      }
      if (!returned) value = self.lastValue

      // The program body runs inside an implicit async function, so a returned promise
      // resolves before crossing the data boundary — `return tools.ns.tool(...)` works
      // without an explicit await, exactly as in JS.
      if (value instanceof SandboxPromise) value = yield* self.settlePromise(value)
      yield* self.drainPendingSettlements()
      return value
    }).pipe(Effect.ensuring(Effect.sync(() => self.popScope())))
  }

  // Awaits every fiber-backed promise the program abandoned (fire-and-forget tool calls), so
  // their work completes before the execution ends — mirroring a JS runtime waiting on
  // in-flight I/O at exit. A failure nobody could have handled becomes an unhandled-rejection
  // diagnostic (interrupted calls, e.g. Promise.race losers, are ignored).
  private drainPendingSettlements(): Effect.Effect<void, unknown, never> {
    const self = this
    return Effect.gen(function*() {
      for (const promise of [...self.pendingSettlements]) {
        const exit = yield* self.observePromise(promise)
        if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) continue
        const failure = normalizeError(Cause.squash(exit.cause))
        throw new InterpreterRuntimeError(
          `Unhandled rejection from an un-awaited tool call: ${failure.message}`,
          undefined,
          failure.kind,
          ["Await tool calls — `const result = await tools.ns.tool(...)` — so failures can be caught and handled."],
        )
      }
    })
  }

  // Eagerly starts a tool call on a supervised child fiber (so the execution timeout and
  // scope teardown interrupt it) gated by the concurrency semaphore, and wraps the fiber in a
  // first-class promise value. `startImmediately` makes the runtime admit the call — charging
  // the tool-call budget and firing onToolCallStart — at the call site, before any await.
  private createToolCallPromise(path: ReadonlyArray<string>, args: Array<unknown>): Effect.Effect<SandboxPromise, never, R> {
    const self = this
    return Effect.map(
      Effect.forkChild(
        this.callPermits.withPermit(Effect.suspend(() => self.invokeTool(path, args))),
        { startImmediately: true },
      ),
      (fiber) => {
        const promise = new SandboxPromise(fiber)
        self.pendingSettlements.add(promise)
        return promise
      },
    )
  }

  // The promise's settlement as an Exit, marking it observed for unhandled-rejection tracking.
  // Fiber settlement is idempotent, so observing the same promise repeatedly (await twice,
  // Promise.all([p, p])) never re-runs the underlying call.
  private observePromise(promise: SandboxPromise): Effect.Effect<Exit.Exit<unknown, unknown>> {
    this.pendingSettlements.delete(promise)
    return promise.fiber !== undefined ? Fiber.await(promise.fiber) : Effect.exit(promise.immediate ?? Effect.void)
  }

  // `await promise`: succeed with the fulfilled value or re-raise the failure so try/catch
  // observes it exactly like a synchronous throw at the await site.
  private settlePromise(promise: SandboxPromise, node?: AstNode): Effect.Effect<unknown, unknown, never> {
    const self = this
    return Effect.flatMap(this.observePromise(promise), (exit) => self.unwrapPromiseExit(promise, exit, node))
  }

  private unwrapPromiseExit(promise: SandboxPromise | undefined, exit: Exit.Exit<unknown, unknown>, node?: AstNode): Effect.Effect<unknown, unknown> {
    if (Exit.isSuccess(exit)) return Effect.succeed(exit.value)
    // A call Promise.race interrupted after losing settles as a catchable program failure;
    // any other interruption is execution teardown (timeout/host) and must keep propagating
    // as interruption rather than becoming program-visible data.
    if (promise?.interrupted === true && Cause.hasInterruptsOnly(exit.cause)) {
      return Effect.fail(new InterpreterRuntimeError("This tool call was interrupted because another value settled a Promise.race first.", node))
    }
    return Effect.failCause(exit.cause)
  }

  private evaluateStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    this.recordOperation(node)

    switch (node.type) {
      case "ExpressionStatement":
        return Effect.map(this.evaluateExpression(getNode(node, "expression")), (value) => ({ kind: "value", value }))
      case "VariableDeclaration":
        return Effect.map(this.evaluateVariableDeclaration(node), () => ({ kind: "none" }))
      case "ReturnStatement": {
        const argumentNode = getOptionalNode(node, "argument")
        return argumentNode
          ? Effect.map(this.evaluateExpression(argumentNode), (value) => ({ kind: "return", value }))
          : Effect.succeed({ kind: "return", value: undefined })
      }
      case "BlockStatement":
        return this.evaluateBlock(node)
      case "IfStatement":
        return this.evaluateIfStatement(node)
      case "SwitchStatement":
        return this.evaluateSwitchStatement(node)
      case "WhileStatement":
        return this.evaluateWhileStatement(node)
      case "DoWhileStatement":
        return this.evaluateDoWhileStatement(node)
      case "ForStatement":
        return this.evaluateForStatement(node)
      case "ForOfStatement":
        return this.evaluateForOfStatement(node)
      case "ForInStatement":
        return this.evaluateForInStatement(node)
      case "BreakStatement":
        return Effect.succeed(this.evaluateBreakStatement(node))
      case "ContinueStatement":
        return Effect.succeed(this.evaluateContinueStatement(node))
      case "ThrowStatement":
        return this.evaluateThrowStatement(node)
      case "TryStatement":
        return this.evaluateTryStatement(node)
      case "EmptyStatement":
        return Effect.succeed({ kind: "none" })
      case "FunctionDeclaration":
        return Effect.succeed({ kind: "none" }) // bound ahead of time by hoistFunctions
      default:
        throw unsupportedSyntax(node.type, node)
    }
  }

  private evaluateBlock(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    this.pushScope()
    const self = this
    return Effect.gen(function*() {
      const body = getArray(node, "body")
      self.hoistFunctions(body)

      for (const statementValue of body) {
        const statement = asNode(statementValue, "body")
        const result = yield* self.evaluateStatement(statement)

        if (result.kind === "value") {
          self.lastValue = result.value
          continue
        }

        if (result.kind !== "none") {
          return result
        }
      }

      return { kind: "none" } satisfies StatementResult
    }).pipe(Effect.ensuring(Effect.sync(() => self.popScope())))
  }

  private createFunction(node: AstNode): CodeModeFunction {
    if (node.generator === true) {
      throw new InterpreterRuntimeError("Generator functions are not supported in CodeMode.", node, "UnsupportedSyntax", [supportedSyntaxMessage])
    }
    return new CodeModeFunction(
      getArray(node, "params").map((parameter, index) => asNode(parameter, `params[${index}]`)),
      getNode(node, "body"),
      this.scopes.slice(),
    )
  }

  // Function declarations are hoisted: bound in their scope before the body runs, so a
  // program can call a helper defined further down (matching JavaScript).
  private hoistFunctions(statements: Array<unknown>): void {
    for (const statementValue of statements) {
      if (!isRecord(statementValue) || statementValue.type !== "FunctionDeclaration") continue
      const node = statementValue as AstNode
      this.declare(getString(getNode(node, "id"), "name"), this.createFunction(node), true, node)
    }
  }

  private evaluateIfStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const testNode = getNode(node, "test")
    const consequentNode = getNode(node, "consequent")
    const alternateNode = getOptionalNode(node, "alternate")

    return Effect.flatMap(this.evaluateExpression(testNode), (test) =>
      test ? this.evaluateStatement(consequentNode) : alternateNode ? this.evaluateStatement(alternateNode) : Effect.succeed({ kind: "none" }))
  }

  private evaluateSwitchStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const self = this
    this.pushScope()
    return Effect.gen(function*() {
      const discriminant = yield* self.evaluateExpression(getNode(node, "discriminant"))
      if (containsOpaqueReference(discriminant)) {
        throw new InterpreterRuntimeError("Switch discriminants must be data values in CodeMode.", node, "InvalidDataValue")
      }
      const cases = getArray(node, "cases").map((value, index) => asNode(value, `cases[${index}]`))
      let defaultIndex: number | undefined
      let selected: number | undefined
      for (const [index, branch] of cases.entries()) {
        const test = getOptionalNode(branch, "test")
        if (!test) {
          defaultIndex = index
          continue
        }
        const candidate = yield* self.evaluateExpression(test)
        if (containsOpaqueReference(candidate)) {
          throw new InterpreterRuntimeError("Switch case values must be data values in CodeMode.", test, "InvalidDataValue")
        }
        if (candidate === discriminant) {
          selected = index
          break
        }
      }
      const start = selected ?? defaultIndex
      if (start === undefined) return { kind: "none" } satisfies StatementResult
      for (let index = start; index < cases.length; index += 1) {
        for (const statementValue of getArray(cases[index]!, "consequent")) {
          const result = yield* self.evaluateStatement(asNode(statementValue, "consequent"))
          if (result.kind === "break") return { kind: "none" } satisfies StatementResult
          if (result.kind === "return" || result.kind === "continue") return result
          if (result.kind === "value") self.lastValue = result.value
        }
      }
      return { kind: "none" } satisfies StatementResult
    }).pipe(Effect.ensuring(Effect.sync(() => self.popScope())))
  }

  private evaluateWhileStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const testNode = getNode(node, "test")
    const bodyNode = getNode(node, "body")

    const self = this
    return Effect.gen(function*() {
      while (yield* self.evaluateExpression(testNode)) {
        const result = yield* self.evaluateStatement(bodyNode)

        if (result.kind === "continue") {
          continue
        }

        if (result.kind === "break") {
        return { kind: "none" } satisfies StatementResult
        }

        if (result.kind === "return") {
          return result
        }

        if (result.kind === "value") {
          self.lastValue = result.value
        }
      }

      return { kind: "none" } satisfies StatementResult
    })
  }

  private evaluateDoWhileStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const bodyNode = getNode(node, "body")
    const testNode = getNode(node, "test")

    const self = this
    return Effect.gen(function*() {
      do {
        const result = yield* self.evaluateStatement(bodyNode)

        if (result.kind === "continue") {
          continue
        }

        if (result.kind === "break") {
          return { kind: "none" } satisfies StatementResult
        }

        if (result.kind === "return") {
          return result
        }

        if (result.kind === "value") {
          self.lastValue = result.value
        }
      } while (yield* self.evaluateExpression(testNode))

      return { kind: "none" } satisfies StatementResult
    })
  }

  private evaluateForStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    this.pushScope()
    const self = this
    return Effect.gen(function*() {
      const initNode = getOptionalNode(node, "init")
      const testNode = getOptionalNode(node, "test")
      const updateNode = getOptionalNode(node, "update")
      const bodyNode = getNode(node, "body")

      if (initNode) {
        if (initNode.type === "VariableDeclaration") {
          yield* self.evaluateVariableDeclaration(initNode)
        } else {
          yield* self.evaluateExpression(initNode)
        }
      }

      const perIterationBindings = initNode?.type === "VariableDeclaration" && getString(initNode, "kind") !== "var"
        ? Array.from(self.currentScope().keys())
        : []

      while (testNode ? yield* self.evaluateExpression(testNode) : true) {
        let iterationScope: Map<string, Binding> | undefined
        if (perIterationBindings.length > 0) {
          iterationScope = new Map(perIterationBindings.map((name) => {
            const binding = self.currentScope().get(name)!
            return [name, { ...binding }]
          }))
          self.scopes.push(iterationScope)
        }
        const result = yield* self.evaluateStatement(bodyNode).pipe(
          Effect.ensuring(Effect.sync(() => {
            if (iterationScope) self.popScope()
          })),
        )

        if (result.kind === "return") {
          return result
        }

        if (result.kind === "break") {
          return { kind: "none" } satisfies StatementResult
        }

        if (result.kind === "value") {
          self.lastValue = result.value
        }

        if (iterationScope) {
          const loopScope = self.currentScope()
          for (const name of perIterationBindings) {
            loopScope.set(name, { ...iterationScope.get(name)! })
          }
        }

        if (updateNode) {
          yield* self.evaluateExpression(updateNode)
        }

        if (result.kind === "continue") {
          continue
        }
      }

      return { kind: "none" } satisfies StatementResult
    }).pipe(Effect.ensuring(Effect.sync(() => self.popScope())))
  }

  private evaluateForOfStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    if (getBoolean(node, "await")) {
      throw new InterpreterRuntimeError("for await...of is not supported.", node)
    }

    const self = this
    return Effect.gen(function*() {
      const left = getNode(node, "left")
      const right = yield* self.evaluateExpression(getNode(node, "right"))
      const body = getNode(node, "body")

      // Arrays iterate in place; strings iterate code points; Maps iterate [key, value]
      // pairs and Sets iterate values over a snapshot (mutation during iteration is safe).
      const iterable = Array.isArray(right) ? right : spreadItems(right)
      if (iterable === undefined) {
        throw new InterpreterRuntimeError("for...of requires an array, string, Map, or Set value in CodeMode.", node)
      }
      if (iterable !== right) self.recordWork(iterable.length, node)

      let declaration: { readonly pattern: AstNode; readonly mutable: boolean } | undefined
      let assignmentName: string | undefined

      if (left.type === "VariableDeclaration") {
        const declarations = getArray(left, "declarations")
        if (declarations.length !== 1) {
          throw new InterpreterRuntimeError("for...of supports one declared binding.", left)
        }

        const declarator = asNode(declarations[0], "declarations[0]")
        declaration = { pattern: getNode(declarator, "id"), mutable: getString(left, "kind") !== "const" }
      } else if (left.type === "Identifier") {
        assignmentName = getString(left, "name")
      } else {
        throw new InterpreterRuntimeError("Unsupported for...of binding.", left)
      }

      for (const value of iterable) {
        if (declaration) {
          self.pushScope()
          yield* self.declarePattern(declaration.pattern, value, declaration.mutable, left)
        } else if (assignmentName) {
          self.setIdentifierValue(assignmentName, value, left)
        }

        const result = yield* self.evaluateStatement(body).pipe(
          Effect.ensuring(Effect.sync(() => {
            if (declaration) self.popScope()
          })),
        )

        if (result.kind === "return") {
          return result
        }

        if (result.kind === "break") {
          return { kind: "none" }
        }

        if (result.kind === "value") {
          self.lastValue = result.value
        }

        if (result.kind === "continue") {
          continue
        }
      }

      return { kind: "none" }
    })
  }

  // Own enumerable string keys of a value, shared by `for...in` and `Object.keys` over tool
  // references: plain data objects enumerate their own keys, arrays their index strings (plus
  // any own non-index properties, e.g. match results' index/groups — exactly Object.keys in
  // JS), and a tool reference the namespace/tool names at its path in the host tool tree.
  // Returns undefined for everything else so callers can raise a contextual error.
  private enumerableKeys(value: unknown, node: AstNode): Array<string> | undefined {
    if (value instanceof ToolReference) {
      const keys = [...this.toolKeys(value.path)]
      this.recordWork(keys.length, node)
      return keys
    }
    if (Array.isArray(value)) {
      this.recordWork(value.length, node)
      return Object.keys(value)
    }
    if (value !== null && typeof value === "object" && !isRuntimeReference(value)) {
      const keys = Object.keys(value)
      this.recordWork(keys.length, node)
      return keys
    }
    return undefined
  }

  private evaluateForInStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const self = this
    return Effect.gen(function*() {
      const left = getNode(node, "left")
      const right = yield* self.evaluateExpression(getNode(node, "right"))
      const body = getNode(node, "body")

      // Keys are snapshotted up front (mutation during iteration is safe): plain objects
      // enumerate their own keys, arrays their index strings, and tool references the
      // namespace/tool names at that node — the same enumeration Object.keys performs.
      // Anything else (strings, Maps, Sets, numbers, null, ...) is a deliberate error rather
      // than real JS's surprising behavior (indices for strings, zero iterations for
      // Maps/Sets/null): the hint points at the constructs that do what the program means.
      const keys = self.enumerableKeys(right, node)
      if (keys === undefined) {
        throw new InterpreterRuntimeError(
          "for...in requires a plain object, array, or tools reference in CodeMode. Use for...of for arrays/strings/Maps/Sets, or Object.keys(value) for a key list.",
          node,
        )
      }

      let declaration: { readonly pattern: AstNode; readonly mutable: boolean } | undefined
      let assignmentName: string | undefined

      if (left.type === "VariableDeclaration") {
        const declarations = getArray(left, "declarations")
        if (declarations.length !== 1) {
          throw new InterpreterRuntimeError("for...in supports one declared binding.", left)
        }

        const declarator = asNode(declarations[0], "declarations[0]")
        declaration = { pattern: getNode(declarator, "id"), mutable: getString(left, "kind") !== "const" }
      } else if (left.type === "Identifier") {
        assignmentName = getString(left, "name")
      } else {
        throw new InterpreterRuntimeError("Unsupported for...in binding.", left)
      }

      for (const key of keys) {
        if (declaration) {
          self.pushScope()
          yield* self.declarePattern(declaration.pattern, key, declaration.mutable, left)
        } else if (assignmentName) {
          self.setIdentifierValue(assignmentName, key, left)
        }

        const result = yield* self.evaluateStatement(body).pipe(
          Effect.ensuring(Effect.sync(() => {
            if (declaration) self.popScope()
          })),
        )

        if (result.kind === "return") {
          return result
        }

        if (result.kind === "break") {
          return { kind: "none" }
        }

        if (result.kind === "value") {
          self.lastValue = result.value
        }

        if (result.kind === "continue") {
          continue
        }
      }

      return { kind: "none" }
    })
  }

  private evaluateBreakStatement(node: AstNode): StatementResult {
    const labelNode = getOptionalNode(node, "label")

    if (labelNode) {
      throw new InterpreterRuntimeError("Labeled break is not supported in v1.", node)
    }

    return { kind: "break" }
  }

  private evaluateContinueStatement(node: AstNode): StatementResult {
    const labelNode = getOptionalNode(node, "label")

    if (labelNode) {
      throw new InterpreterRuntimeError("Labeled continue is not supported in v1.", node)
    }

    return { kind: "continue" }
  }

  private evaluateThrowStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const argument = getNode(node, "argument")
    return Effect.flatMap(this.evaluateExpression(argument), (value) => Effect.fail(new ProgramThrow(value)))
  }

  private evaluateTryStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const body = getNode(node, "block")
    const handler = getOptionalNode(node, "handler")
    const finalizer = getOptionalNode(node, "finalizer")
    const self = this

    const attempted = Effect.matchCauseEffect(this.evaluateStatement(body), {
      onFailure: (cause) => {
        if (cause.reasons.some(Cause.isInterruptReason) || !handler) {
          return Effect.failCause(cause)
        }

        // The program sees a plain { message } error (or the thrown value itself) — see
        // caughtErrorValue, shared with Promise.allSettled rejection reasons.
        const caught = caughtErrorValue(Cause.squash(cause))
        const parameter = getOptionalNode(handler, "param")
        self.pushScope()
        return Effect.gen(function*() {
          if (parameter) yield* self.declarePattern(parameter, caught, true, handler)
          return yield* self.evaluateStatement(getNode(handler, "body"))
        }).pipe(
          Effect.ensuring(Effect.sync(() => self.popScope())),
        )
      },
      onSuccess: Effect.succeed,
    })

    if (!finalizer) return attempted

    const isAbrupt = (result: StatementResult): boolean =>
      result.kind === "return" || result.kind === "break" || result.kind === "continue"

    return Effect.matchCauseEffect(attempted, {
      onFailure: (cause) =>
        cause.reasons.some(Cause.isInterruptReason)
          ? Effect.failCause(cause)
          : Effect.flatMap(this.evaluateStatement(finalizer), (final) =>
              isAbrupt(final) ? Effect.succeed(final) : Effect.failCause(cause)),
      onSuccess: (result) =>
        Effect.flatMap(this.evaluateStatement(finalizer), (final) =>
          isAbrupt(final) ? Effect.succeed(final) : Effect.succeed(result)),
    })
  }

  private evaluateVariableDeclaration(node: AstNode): Effect.Effect<void, unknown, R> {
    const kind = getString(node, "kind")
    const declarations = getArray(node, "declarations")
    const self = this
    return Effect.gen(function*() {
      for (const declarationValue of declarations) {
        const declaration = asNode(declarationValue, "declarations")

        if (declaration.type !== "VariableDeclarator") {
          throw new InterpreterRuntimeError("Unsupported variable declaration shape.", declaration)
        }

        const init = getOptionalNode(declaration, "init")
        const value = init ? yield* self.evaluateExpression(init) : undefined
        yield* self.declarePattern(getNode(declaration, "id"), value, kind !== "const", declaration)
      }
    })
  }

  private declarePattern(pattern: AstNode, value: unknown, mutable: boolean, node: AstNode): Effect.Effect<void, unknown, R> {
    const self = this
    return Effect.gen(function*() {
      if (pattern.type === "Identifier") {
        self.declare(getString(pattern, "name"), value, mutable, node)
        return
      }

      // Default values: `x = expr` / `{ a = 1 }` — the default is evaluated only when the value is undefined.
      if (pattern.type === "AssignmentPattern") {
        const resolved = value === undefined ? yield* self.evaluateExpression(getNode(pattern, "right")) : value
        yield* self.declarePattern(getNode(pattern, "left"), resolved, mutable, node)
        return
      }

      if (pattern.type === "ObjectPattern") {
        if (value === null || typeof value !== "object" || Array.isArray(value) || isRuntimeReference(value)) {
          throw new InterpreterRuntimeError("Object destructuring requires a data object value.", pattern, "InvalidDataValue")
        }

        const consumed = new Set<string>()
        for (const propertyValue of getArray(pattern, "properties")) {
          const property = asNode(propertyValue, "properties")

          // Object rest: `{ a, ...others }` — gather the not-yet-consumed own keys.
          if (property.type === "RestElement") {
            const rest: SafeObject = Object.create(null) as SafeObject
            for (const [key, item] of Object.entries(value as SafeObject)) {
              if (!consumed.has(key) && !isBlockedMember(key)) rest[key] = item
            }
            yield* self.declarePattern(getNode(property, "argument"), rest, mutable, property)
            continue
          }

          if (property.type !== "Property" || getBoolean(property, "computed") || getString(property, "kind") !== "init") {
            throw new InterpreterRuntimeError("Only named object destructuring properties are supported.", property)
          }

          const keyNode = getNode(property, "key")
          const key = keyNode.type === "Identifier" ? getString(keyNode, "name") : String(keyNode.value)
          if (isBlockedMember(key)) {
            throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, keyNode)
          }
          consumed.add(key)
          yield* self.declarePattern(getNode(property, "value"), (value as SafeObject)[key], mutable, property)
        }
        return
      }

      if (pattern.type === "ArrayPattern") {
        if (!Array.isArray(value)) {
          throw new InterpreterRuntimeError("Array destructuring requires an array value.", pattern)
        }

        for (const [index, item] of getArray(pattern, "elements").entries()) {
          if (item === null) continue
          const element = asNode(item, `elements[${index}]`)
          // Array rest: `[head, ...tail]` — binds the remaining elements (must be last).
          if (element.type === "RestElement") {
            yield* self.declarePattern(getNode(element, "argument"), value.slice(index), mutable, element)
            break
          }
          yield* self.declarePattern(element, value[index], mutable, pattern)
        }
        return
      }

      throw new InterpreterRuntimeError(`Unsupported binding pattern '${pattern.type}'.`, pattern)
    })
  }

  private evaluateExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    this.recordOperation(node)

    switch (node.type) {
      case "Literal": {
        // A regex literal parses as a Literal node carrying { pattern, flags }; construct the
        // sandbox regex from those (the host `value` instance is never exposed).
        const regex = node.regex
        if (isRecord(regex) && typeof regex.pattern === "string") {
          return Effect.sync(() => this.constructRegExp([regex.pattern, typeof regex.flags === "string" ? regex.flags : ""], node))
        }
        return Effect.sync(() => boundedData(node.value, "Literal", node, this.limits))
      }
      case "Identifier":
        return Effect.sync(() => this.getIdentifierValue(getString(node, "name"), node))
      case "BinaryExpression":
        return this.evaluateBinaryExpression(node)
      case "LogicalExpression":
        return this.evaluateLogicalExpression(node)
      case "UnaryExpression":
        return this.evaluateUnaryExpression(node)
      case "AssignmentExpression":
        return this.evaluateAssignmentExpression(node)
      case "CallExpression":
        return this.evaluateCallExpression(node)
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return Effect.sync(() => this.createFunction(node))
      case "MemberExpression":
        return this.readMember(node)
      case "ChainExpression":
        return Effect.map(this.evaluateExpression(getNode(node, "expression")), (value) =>
          value === OptionalShortCircuit ? undefined : value)
      case "ObjectExpression":
        return this.evaluateObjectExpression(node)
      case "ArrayExpression":
        return this.evaluateArrayExpression(node)
      case "TemplateLiteral":
        return this.evaluateTemplateLiteral(node)
      case "ConditionalExpression":
        return this.evaluateConditionalExpression(node)
      case "UpdateExpression":
        return this.evaluateUpdateExpression(node)
      case "AwaitExpression": {
        // `await` resolves a promise value; awaiting anything else is a passthrough no-op,
        // matching real JS semantics for non-thenables.
        const self = this
        return Effect.flatMap(this.evaluateExpression(getNode(node, "argument")), (value) =>
          value instanceof SandboxPromise ? self.settlePromise(value, node) : Effect.succeed(value))
      }
      case "NewExpression":
        return this.evaluateNewExpression(node)
      default:
        throw unsupportedSyntax(node.type, node)
    }
  }

  private evaluateNewExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const callee = getNode(node, "callee")
    if (callee.type !== "Identifier") {
      throw unsupportedSyntax("NewExpression", node)
    }
    const name = getString(callee, "name")
    const argNodes = getArray(node, "arguments")
    const self = this
    if (name === "Promise") {
      throw new InterpreterRuntimeError(
        "new Promise(...) is not supported in CodeMode; tool calls already return promises — call the tool and await the result.",
        node,
        "UnsupportedSyntax",
        [supportedSyntaxMessage],
      )
    }
    if (errorConstructors.has(name)) {
      return Effect.gen(function*() {
        const arg = argNodes.length > 0 ? yield* self.evaluateExpression(asNode(argNodes[0], "arguments[0]")) : undefined
        const message = arg === undefined ? "" : coerceToString(arg)
        const errorValue: SafeObject = Object.create(null) as SafeObject
        errorValue.name = name
        errorValue.message = message
        return errorValue
      })
    }
    if (valueConstructors.has(name)) {
      return Effect.gen(function*() {
        const args = yield* self.evaluateCallArguments(argNodes)
        switch (name) {
          case "Date": return self.constructDate(args)
          case "RegExp": return self.constructRegExp(args, node)
          case "Map": return self.constructMap(args[0], node)
          default: return self.constructSet(args[0], node)
        }
      })
    }
    throw unsupportedSyntax("NewExpression", node)
  }

  private constructDate(args: Array<unknown>): SandboxDate {
    if (args.length === 0) return new SandboxDate(Date.now())
    if (args.length === 1) {
      const arg = args[0]
      if (arg instanceof SandboxDate) return new SandboxDate(arg.time)
      if (typeof arg === "number") return new SandboxDate(new Date(arg).getTime())
      if (typeof arg === "string") return new SandboxDate(Date.parse(arg))
      return new SandboxDate(Number.NaN)
    }
    // new Date(year, month, day?, hours?, ...) — local-time component form.
    const parts = args.map((arg) => coerceToNumber(arg))
    return new SandboxDate(new Date(...(parts as [number, number])).getTime())
  }

  private constructRegExp(args: Array<unknown>, node: AstNode): SandboxRegExp {
    const first = args[0]
    const pattern = first instanceof SandboxRegExp ? first.regex.source : first === undefined ? "" : coerceToString(first)
    const flagsArg = args[1]
    if (flagsArg !== undefined && typeof flagsArg !== "string") {
      throw new InterpreterRuntimeError("RegExp flags must be a string.", node)
    }
    const flags = flagsArg ?? (first instanceof SandboxRegExp ? first.regex.flags : "")
    boundedData(pattern, "RegExp pattern", node, this.limits)
    this.recordWork(pattern.length, node)
    try {
      return new SandboxRegExp(pattern, flags)
    } catch (error) {
      throw new InterpreterRuntimeError(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`, node)
    }
  }

  private constructMap(init: unknown, node: AstNode): SandboxMap {
    const target = new SandboxMap()
    if (init === undefined || init === null) return target
    const entries = Array.isArray(init)
      ? init
      : init instanceof SandboxMap
        ? Array.from(init.map.entries(), ([key, item]): Array<unknown> => [key, item])
        : undefined
    if (entries === undefined) {
      throw new InterpreterRuntimeError("new Map(...) expects an array of [key, value] pairs, a Map, or no argument.", node)
    }
    this.recordWork(entries.length, node)
    for (const pair of entries) {
      if (!Array.isArray(pair)) {
        throw new InterpreterRuntimeError("new Map(...) expects [key, value] pairs.", node)
      }
      this.mapSet(target, pair[0], pair[1], node)
    }
    return target
  }

  private constructSet(init: unknown, node: AstNode): SandboxSet {
    const target = new SandboxSet()
    if (init === undefined || init === null) return target
    const items = Array.isArray(init)
      ? init
      : init instanceof SandboxSet
        ? Array.from(init.set.values())
        : typeof init === "string"
          ? Array.from(init)
          : undefined
    if (items === undefined) {
      throw new InterpreterRuntimeError("new Set(...) expects an array, Set, string, or no argument.", node)
    }
    this.recordWork(items.length, node)
    for (const item of items) this.setAdd(target, item, node)
    return target
  }

  // Map/Set mutations maintain the instance's incremental byte total (the same fast path the
  // array/object mutation helpers use) and enforce collection-length and data-size limits
  // before mutating; the authoritative copyIn/copyOut boundary checks remain underneath.
  private mapSet(target: SandboxMap, key: unknown, value: unknown, node: AstNode): void {
    const valueBytes = this.nestedValueBytes(value, "Map entry", node)
    if (target.map.has(key)) {
      const previous = this.nestedValueBytes(target.map.get(key), "Map entry", node)
      const next = target.bytes - previous + valueBytes
      if (next > this.limits.maxDataBytes) {
        throw new InterpreterRuntimeError(`Map exceeds the maximum data size of ${this.limits.maxDataBytes} bytes.`, node, "InvalidDataValue")
      }
      target.bytes = next
    } else {
      if (target.map.size >= this.limits.maxCollectionLength) {
        throw new InterpreterRuntimeError(`Map exceeds the maximum collection length of ${this.limits.maxCollectionLength}.`, node, "InvalidDataValue")
      }
      const next = target.bytes + this.nestedValueBytes(key, "Map entry", node) + valueBytes + 2
      if (next > this.limits.maxDataBytes) {
        throw new InterpreterRuntimeError(`Map exceeds the maximum data size of ${this.limits.maxDataBytes} bytes.`, node, "InvalidDataValue")
      }
      target.bytes = next
    }
    target.map.set(key, value)
  }

  private setAdd(target: SandboxSet, value: unknown, node: AstNode): void {
    if (target.set.has(value)) return
    if (target.set.size >= this.limits.maxCollectionLength) {
      throw new InterpreterRuntimeError(`Set exceeds the maximum collection length of ${this.limits.maxCollectionLength}.`, node, "InvalidDataValue")
    }
    const next = target.bytes + this.nestedValueBytes(value, "Set entry", node) + 2
    if (next > this.limits.maxDataBytes) {
      throw new InterpreterRuntimeError(`Set exceeds the maximum data size of ${this.limits.maxDataBytes} bytes.`, node, "InvalidDataValue")
    }
    target.bytes = next
    target.set.add(value)
  }

  private evaluateBinaryExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    const self = this
    return Effect.gen(function*() {
      const lhs = (yield* self.evaluateExpression(getNode(node, "left"))) as any
      const rhs = (yield* self.evaluateExpression(getNode(node, "right"))) as any
      if (containsOpaqueReference(lhs) || containsOpaqueReference(rhs)) {
        throw new InterpreterRuntimeError("Binary operators require data values in CodeMode.", node, "InvalidDataValue")
      }
      // Data objects/arrays are null-prototype, so JS's ToPrimitive throws an opaque host
      // "No default value" TypeError when an operator coerces them. Coerce to their JS string
      // form first (as String(x) / template literals do) so operators behave like JavaScript.
      // A Date follows its ToPrimitive hints: string for `+` (concatenation), its time value
      // for arithmetic and ordering — so `end - start` and `a < b` work as in JS.
      // Identity (=== / !==) and the right operand of `in` keep their raw object value.
      const coerceOperand = (operand: unknown): unknown => {
        if (operand instanceof SandboxDate) return operator === "+" ? coerceToString(operand) : operand.time
        return operand !== null && typeof operand === "object" ? coerceToString(operand) : operand
      }
      const bothObjects = lhs !== null && typeof lhs === "object" && rhs !== null && typeof rhs === "object"
      const l = coerceOperand(lhs) as any
      const r = coerceOperand(rhs) as any
      let result: unknown
      switch (operator) {
        case "+": result = l + r; break
        case "-": result = l - r; break
        case "*": result = l * r; break
        case "/": result = l / r; break
        case "%": result = l % r; break
        case "**": result = l ** r; break
        // Two objects compare by identity in JS (no ToPrimitive); only object-vs-primitive coerces.
        case "==": result = bothObjects ? lhs === rhs : l == r; break
        case "===": result = lhs === rhs; break
        case "!=": result = bothObjects ? lhs !== rhs : l != r; break
        case "!==": result = lhs !== rhs; break
        case "<": result = l < r; break
        case "<=": result = l <= r; break
        case ">": result = l > r; break
        case ">=": result = l >= r; break
        case "&": result = l & r; break
        case "|": result = l | r; break
        case "^": result = l ^ r; break
        case "<<": result = l << r; break
        case ">>": result = l >> r; break
        case ">>>": result = l >>> r; break
        case "in":
          if (rhs === null || typeof rhs !== "object") {
            throw new InterpreterRuntimeError("The 'in' operator requires a data object on the right-hand side.", node)
          }
          // Own properties only, so arrays don't leak the host Array.prototype (map/constructor/...).
          result = Object.hasOwn(rhs as object, coerceOperand(lhs) as PropertyKey); break
        default: throw new InterpreterRuntimeError(`Unsupported binary operator '${operator}'.`, node)
      }
      return boundedData(result, "Binary expression result", node, self.limits)
    })
  }

  private evaluateLogicalExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    return Effect.flatMap(this.evaluateExpression(getNode(node, "left")), (left) => {
      if (operator === "&&") return left ? this.evaluateExpression(getNode(node, "right")) : Effect.succeed(left)
      if (operator === "||") return left ? Effect.succeed(left) : this.evaluateExpression(getNode(node, "right"))
      if (operator === "??") return left !== null && left !== undefined ? Effect.succeed(left) : this.evaluateExpression(getNode(node, "right"))
      throw new InterpreterRuntimeError(`Unsupported logical operator '${operator}'.`, node)
    })
  }

  private evaluateUnaryExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    const argument = getNode(node, "argument")
    // `typeof undeclaredIdentifier` is `"undefined"` in JS (never a ReferenceError), so
    // feature-detection guards like `typeof x !== "undefined"` don't crash. Short-circuit before
    // evaluating the argument; a declared-but-TDZ binding still falls through to the normal throw.
    if (operator === "typeof" && argument.type === "Identifier" && !this.resolveBinding(getString(argument, "name"))) {
      return Effect.succeed("undefined")
    }
    return Effect.map(this.evaluateExpression(argument), (value) => {
      // `typeof` and `!` never throw in JS — they observe any value (functions and runtime
      // references included) without coercing it, so feature detection and negation work.
      if (operator === "typeof") return typeofValue(value)
      if (operator === "!") return !value
      if (containsOpaqueReference(value)) {
        throw new InterpreterRuntimeError("Unary operators require data values in CodeMode.", node, "InvalidDataValue")
      }
      const rhs = value as any
      // Numeric/bitwise unary operators ToPrimitive their operand; a Date yields its time value
      // (`+date` is the epoch-ms idiom), other null-prototype data objects/arrays coerce to
      // their JS string form first (see evaluateBinaryExpression).
      const operand = rhs instanceof SandboxDate
        ? (rhs.time as any)
        : rhs !== null && typeof rhs === "object"
          ? (coerceToString(rhs) as any)
          : rhs
      let result: unknown
      switch (operator) {
        case "+": result = +operand; break
        case "-": result = -operand; break
        case "~": result = ~operand; break
        default: throw new InterpreterRuntimeError(`Unsupported unary operator '${operator}'.`, node)
      }
      return boundedData(result, "Unary expression result", node, this.limits)
    })
  }

  private evaluateAssignmentExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const left = getNode(node, "left")
    const operator = getString(node, "operator")
    const self = this
    return Effect.gen(function*() {
      if (operator === "??=" || operator === "||=" || operator === "&&=") {
        return yield* self.evaluateLogicalAssignment(node, left, operator)
      }
      const rightValue = yield* self.evaluateExpression(getNode(node, "right"))
      if (left.type === "Identifier") {
        const name = getString(left, "name")
        if (operator === "=") return self.setIdentifierValue(name, rightValue, left)
        const next = boundedData(self.applyCompoundAssignment(operator, self.getIdentifierValue(name, left), rightValue, node), "Assignment result", node, self.limits)
        return self.setIdentifierValue(name, next, left)
      }
      if (left.type === "MemberExpression") {
        if (operator === "=") return yield* self.writeMember(left, rightValue)
        return yield* self.modifyMember(left, (current) => {
          const next = boundedData(self.applyCompoundAssignment(operator, current, rightValue, node), "Assignment result", node, self.limits)
          return Effect.succeed({ write: true, next, result: next })
        })
      }
      throw new InterpreterRuntimeError("Assignment target must be an Identifier or MemberExpression.", left)
    })
  }

  private evaluateLogicalAssignment(node: AstNode, left: AstNode, operator: string): Effect.Effect<unknown, unknown, R> {
    const self = this
    const shouldAssign = (current: unknown): boolean =>
      operator === "??=" ? current === null || current === undefined : operator === "||=" ? !current : Boolean(current)
    if (left.type === "Identifier") {
      const name = getString(left, "name")
      return Effect.gen(function*() {
        const current = self.getIdentifierValue(name, left)
        if (!shouldAssign(current)) return current
        const rightValue = yield* self.evaluateExpression(getNode(node, "right"))
        return self.setIdentifierValue(name, rightValue, left)
      })
    }
    if (left.type === "MemberExpression") {
      // Resolve the member exactly once; evaluate the RHS only if we actually assign.
      return self.modifyMember(left, (current) =>
        shouldAssign(current)
          ? Effect.map(self.evaluateExpression(getNode(node, "right")), (rightValue) => ({ write: true, next: rightValue, result: rightValue }))
          : Effect.succeed({ write: false, next: current, result: current }))
    }
    throw new InterpreterRuntimeError("Assignment target must be an Identifier or MemberExpression.", left)
  }

  private evaluateUpdateExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    const argument = getNode(node, "argument")
    const prefix = getBoolean(node, "prefix")

    const increment = operator === "++" ? 1 : operator === "--" ? -1 : undefined

    if (increment === undefined) {
      throw new InterpreterRuntimeError(`Unsupported update operator '${operator}'.`, node)
    }

    if (argument.type === "Identifier") {
      return Effect.sync(() => {
        const name = getString(argument, "name")
        const current = Number(this.getIdentifierValue(name, argument))
        const next = boundedData(current + increment, "Update result", node, this.limits) as number
        this.setIdentifierValue(name, next, argument)
        return prefix ? next : current
      })
    }

    if (argument.type === "MemberExpression") {
      return this.modifyMember(argument, (current) => {
        const value = Number(current)
        const next = boundedData(value + increment, "Update result", node, this.limits) as number
        return Effect.succeed({ write: true, next, result: prefix ? next : value })
      })
    }

    throw new InterpreterRuntimeError("Update target must be an Identifier or MemberExpression.", argument)
  }

  private evaluateCallExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const callee = getNode(node, "callee")
    const argNodes = getArray(node, "arguments")

    const self = this
    return Effect.gen(function*() {
      const callable = yield* self.evaluateExpression(callee)
      if (callable === OptionalShortCircuit) return OptionalShortCircuit
      if ((callable === null || callable === undefined) && node.optional === true) return OptionalShortCircuit

      const args = yield* self.evaluateCallArguments(argNodes)

      if (callable instanceof ToolReference) {
        if (callable.path.length === 0) throw new InterpreterRuntimeError("The tools root is not callable.", callee)
        // An un-awaited tool call is a first-class promise value; the call itself starts now.
        return yield* self.createToolCallPromise(callable.path, args)
      }
      if (callable instanceof PromiseMethodReference) {
        return yield* self.invokePromiseMethod(callable, args, node)
      }
      if (callable instanceof CodeModeFunction) {
        return yield* self.invokeFunction(callable, args)
      }
      if (callable instanceof IntrinsicReference) {
        return yield* self.invokeIntrinsic(callable, args, node)
      }
      if (callable instanceof GlobalMethodReference) {
        if (callable.namespace === "console") return self.invokeConsole(callable.name, args, node)
        if (callable.namespace === "Object" && args[0] instanceof ToolReference) {
          return self.invokeObjectMethodOnTools(callable.name, args[0] as ToolReference, node)
        }
        const globalResult = invokeGlobalMethod(callable, args, node, self.limits)
        self.recordWork(workUnits(globalResult), node)
        return boundedData(globalResult, `${callable.namespace}.${callable.name} result`, node, self.limits)
      }
      if (callable instanceof CoercionFunction) {
        const coercionResult = invokeCoercion(callable, args, node, self.limits)
        self.recordWork(workUnits(coercionResult), node)
        return boundedData(coercionResult, `${callable.name} result`, node, self.limits)
      }
        throw new InterpreterRuntimeError("Only tools are callable in CodeMode.", callee)
    })
  }

  // Object.* over a tool reference: `Object.keys(tools)` / `Object.keys(tools.ns)` enumerate
  // namespace/tool names from the host tool tree — the discovery idiom a model reaches for
  // first. Every other Object helper cannot produce data from a tool reference, so it fails
  // with a pointer at the working idioms instead of the generic plain-objects-only message.
  private invokeObjectMethodOnTools(name: string, ref: ToolReference, node: AstNode): unknown {
    if (name === "keys") {
      const keys = this.enumerableKeys(ref, node)!
      return boundedData(keys, "Object.keys result", node, this.limits)
    }
    throw new InterpreterRuntimeError(
      `Object.${name}(...) cannot read tool references: they are not plain data. Use Object.keys(tools) for names, or tools.$codemode.search({ query }) for signatures.`,
      node,
      "InvalidDataValue",
    )
  }

  private invokeConsole(name: string, args: Array<unknown>, node: AstNode): undefined {
    if (!consoleMethods.has(name)) throw new InterpreterRuntimeError(`console.${name} is not available in CodeMode.`, node)
    const line = publicErrorMessage(this.formatConsoleMessage(name, args, node))
    const bytes = dataByteLength(line)
    if (this.logBudget.bytes + bytes > this.limits.maxAuditBytes) {
      throw new InterpreterRuntimeError(`Execution exceeds its log limit of ${this.limits.maxAuditBytes} bytes.`, node, "AuditLimitExceeded")
    }
    this.logBudget.bytes += bytes
    this.logs.push(line)
    return undefined
  }

  private formatConsoleMessage(name: string, args: Array<unknown>, node: AstNode): string {
    if (name === "dir") return args.length === 0 ? "undefined" : this.formatConsoleArgument(args[0], node)
    if (name === "table") return this.formatConsoleTable(args[0], args[1], node)
    const prefix = name === "warn" ? "[warn] " : name === "error" ? "[error] " : name === "debug" ? "[debug] " : ""
    return `${prefix}${args.map((arg) => this.formatConsoleArgument(arg, node)).join(" ")}`
  }

  private formatConsoleArgument(value: unknown, node: AstNode): string {
    if (value === undefined) return "undefined"
    // Sandbox values print debugger-friendly forms (their boundary JSON would lose the content).
    if (value instanceof SandboxPromise) return "[Promise (await it to get its value)]"
    if (value instanceof SandboxDate) return coerceToString(value)
    if (value instanceof SandboxRegExp) return coerceToString(value)
    if (value instanceof SandboxMap) {
      return `Map(${value.map.size}) ${this.formatConsoleArgument(Array.from(value.map.entries(), ([key, item]): Array<unknown> => [key, item]), node)}`
    }
    if (value instanceof SandboxSet) {
      return `Set(${value.set.size}) ${this.formatConsoleArgument(Array.from(value.set.values()), node)}`
    }
    if (containsRuntimeReference(value)) return "[CodeMode reference]"
    const copied = copyOut(copyIn(value, "console argument", this.limits), true)
    if (typeof copied === "string") return copied
    if (copied === null || typeof copied === "number" || typeof copied === "boolean") return String(copied)
    try {
      return JSON.stringify(copied) ?? String(copied)
    } catch {
      throw new InterpreterRuntimeError("console argument must contain data only.", node, "InvalidDataValue")
    }
  }

  private formatConsoleTable(value: unknown, columnsArgument: unknown, node: AstNode): string {
    if (value === undefined) return "undefined"
    if (containsRuntimeReference(value)) return "[CodeMode reference]"
    const data = copyOut(copyIn(value, "console.table argument", this.limits), true)
    const columns = this.consoleTableColumns(columnsArgument, node)
    const rows = this.consoleTableRows(data, columns)
    const keys = columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row.values))))
    const header = ["(index)", ...keys].join("\t")
    return [header, ...rows.map((row) => [row.index, ...keys.map((key) => this.formatConsoleTableCell(row.values[key]))].join("\t"))].join("\n")
  }

  private consoleTableColumns(value: unknown, node: AstNode): ReadonlyArray<string> | undefined {
    if (value === undefined) return undefined
    if (containsRuntimeReference(value)) return undefined
    const columns = copyOut(copyIn(value, "console.table columns", this.limits), true)
    return Array.isArray(columns) ? columns.map((column) => String(column)) : undefined
  }

  private consoleTableRows(data: unknown, columns: ReadonlyArray<string> | undefined): Array<{ readonly index: string; readonly values: Record<string, unknown> }> {
    if (Array.isArray(data)) {
      return data.map((item, index) => ({ index: String(index), values: this.consoleTableValues(item, columns) }))
    }
    if (data !== null && typeof data === "object") {
      return Object.entries(data).map(([index, item]) => ({ index, values: this.consoleTableValues(item, columns) }))
    }
    return [{ index: "0", values: { Value: data } }]
  }

  private consoleTableValues(value: unknown, columns: ReadonlyArray<string> | undefined): Record<string, unknown> {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const source = value as Record<string, unknown>
      if (columns !== undefined) return Object.fromEntries(columns.map((column) => [column, source[column]]))
      return Object.fromEntries(Object.entries(source))
    }
    return { Value: value }
  }

  private formatConsoleTableCell(value: unknown): string {
    if (value === undefined) return ""
    if (typeof value === "string") return value
    if (value === null || typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value) ?? String(value)
  }

  private evaluateCallArguments(argNodes: Array<unknown>): Effect.Effect<Array<unknown>, unknown, R> {
    const self = this
    return Effect.gen(function*() {
      const args: Array<unknown> = []
      for (const [index, arg] of argNodes.entries()) {
        const argNode = asNode(arg, `arguments[${index}]`)
        if (argNode.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(getNode(argNode, "argument"))
          const items = spreadItems(spread)
          if (items === undefined) throw new InterpreterRuntimeError("Spread arguments require an array, string, Map, or Set in CodeMode.", argNode)
          if (args.length + items.length > self.limits.maxCollectionLength) {
            throw new InterpreterRuntimeError(`Call arguments exceed the maximum collection length of ${self.limits.maxCollectionLength}.`, argNode, "InvalidDataValue")
          }
          args.push(...items)
          self.recordWork(items.length, argNode)
        } else {
          args.push(yield* self.evaluateExpression(argNode))
          if (args.length > self.limits.maxCollectionLength) {
            throw new InterpreterRuntimeError(`Call arguments exceed the maximum collection length of ${self.limits.maxCollectionLength}.`, argNode, "InvalidDataValue")
          }
        }
      }
      return args
    })
  }

  // Promise.* over ordinary runtime values. Combinators accept ANY array (or spreadable
  // collection) mixing promise values and plain data — built inline, beforehand, via spread,
  // whatever — because tool calls already run eagerly on their own fibers; the combinators
  // only observe settlements. Joining is therefore sequential (no extra fibers) without
  // costing parallelism, and the concurrency cap stays where the work is: the fork semaphore.
  private invokePromiseMethod(ref: PromiseMethodReference, args: Array<unknown>, node: AstNode): Effect.Effect<unknown, unknown, R> {
    const self = this
    if (ref.name === "resolve") {
      // Promise.resolve of a promise is that promise (JS flattens); anything else is a
      // promise already fulfilled with the value.
      const value = args[0]
      return Effect.succeed(value instanceof SandboxPromise ? value : new SandboxPromise(undefined, Effect.succeed(value)))
    }
    if (ref.name === "reject") {
      return Effect.sync(() => new SandboxPromise(undefined, Effect.fail(new ProgramThrow(args[0]))))
    }

    const items = Array.isArray(args[0]) ? args[0] : spreadItems(args[0])
    if (items === undefined) {
      throw new InterpreterRuntimeError(
        `Promise.${ref.name} expects an array of promises or plain values (e.g. Promise.${ref.name}(items.map((item) => tools.ns.tool(item)))).`,
        node,
      )
    }
    this.recordWork(items.length, node)

    switch (ref.name) {
      case "all": {
        // Mark every promise element observed up-front (Promise.all handles all of its
        // members' failures, as in JS), then join in index order; the first failure rejects
        // the whole call while unrelated in-flight members keep running.
        const settles = items.map((item) => (item instanceof SandboxPromise ? this.settlePromise(item, node) : Effect.succeed(item)))
        return Effect.gen(function*() {
          const values: Array<unknown> = []
          for (const settle of settles) values.push(yield* settle)
          return boundedProgramValue(values, "Promise.all result", node, self.limits)
        })
      }
      case "allSettled": {
        const observations = items.map((item) =>
          item instanceof SandboxPromise
            ? Effect.map(this.observePromise(item), (exit) => ({ promise: item as SandboxPromise | undefined, exit }))
            : Effect.succeed({ promise: undefined as SandboxPromise | undefined, exit: Exit.succeed(item as unknown) }))
        return Effect.gen(function*() {
          const outcomes: Array<unknown> = []
          for (const observation of observations) {
            const { exit, promise } = yield* observation
            if (Exit.isSuccess(exit)) {
              outcomes.push(Object.assign(Object.create(null) as SafeObject, { status: "fulfilled", value: exit.value }))
              continue
            }
            const raceInterrupted = promise?.interrupted === true && Cause.hasInterruptsOnly(exit.cause)
            if (Cause.hasInterruptsOnly(exit.cause) && !raceInterrupted) {
              // Execution teardown (timeout/host interruption), not a program-level rejection.
              return yield* Effect.failCause(exit.cause)
            }
            const thrown = raceInterrupted
              ? new InterpreterRuntimeError("This tool call was interrupted because another value settled a Promise.race first.", node)
              : Cause.squash(exit.cause)
            outcomes.push(Object.assign(Object.create(null) as SafeObject, { status: "rejected", reason: caughtErrorValue(thrown) }))
          }
          return boundedProgramValue(outcomes, "Promise.allSettled result", node, self.limits)
        })
      }
      case "race": {
        if (items.length === 0) {
          throw new InterpreterRuntimeError("Promise.race([]) would never settle; provide at least one promise or value.", node)
        }
        const observations = items.map((item, index) =>
          item instanceof SandboxPromise
            ? Effect.map(this.observePromise(item), (exit) => ({ index, exit }))
            : Effect.succeed({ index, exit: Exit.succeed(item as unknown) }))
        return Effect.gen(function*() {
          // First settlement (fulfilled OR rejected) wins; the observations never fail, so
          // racing them yields exactly that. Losing in-flight calls are then interrupted.
          const winner = yield* Effect.raceAll(observations)
          for (const [index, item] of items.entries()) {
            if (index === winner.index || !(item instanceof SandboxPromise) || item.fiber === undefined) continue
            item.interrupted = true
            yield* Fiber.interrupt(item.fiber)
          }
          const winningItem = items[winner.index]
          return yield* self.unwrapPromiseExit(winningItem instanceof SandboxPromise ? winningItem : undefined, winner.exit, node)
        })
      }
    }
  }

  private invokeFunction(fn: CodeModeFunction, args: Array<unknown>): Effect.Effect<unknown, unknown, R> {
    const self = this
    return Effect.suspend(() => {
      const savedScopes = self.scopes
      self.scopes = [...fn.capturedScopes, new Map<string, Binding>()]
      const run = Effect.gen(function*() {
        // Seed every parameter name into the scope as a TDZ slot first, so a default that
        // references another parameter resolves to that (uninitialized) param rather than
        // silently falling through to an outer binding of the same name — matching JS.
        const paramScope = self.currentScope()
        for (const parameter of fn.parameters) {
          for (const name of collectPatternNames(parameter)) {
            paramScope.set(name, { mutable: true, value: undefined, initialized: false })
          }
        }
        for (const [index, parameter] of fn.parameters.entries()) {
          if (parameter.type === "RestElement") {
            yield* self.declarePattern(getNode(parameter, "argument"), args.slice(index), true, parameter)
            break
          }
          yield* self.declarePattern(parameter, args[index], true, parameter)
        }

        if (fn.body.type === "BlockStatement") {
          const result = yield* self.evaluateStatement(fn.body)
          return result.kind === "return" || result.kind === "value" ? result.value : undefined
        }

        return yield* self.evaluateExpression(fn.body)
      })
      return run.pipe(Effect.ensuring(Effect.sync(() => { self.scopes = savedScopes })))
    })
  }

  private invokeIntrinsic(ref: IntrinsicReference, args: Array<unknown>, node: AstNode): Effect.Effect<unknown, unknown, R> {
    if (typeof ref.receiver === "string") {
      this.recordWork(ref.receiver.length, node)
      const result = invokeStringMethod(ref.receiver, ref.name, args, node, this.limits)
      if (typeof result === "string") this.recordWork(result.length, node)
      return Effect.succeed(result)
    }
    if (typeof ref.receiver === "number") {
      return Effect.succeed(invokeNumberMethod(ref.receiver, ref.name, args, node, this.limits))
    }
    if (Array.isArray(ref.receiver)) {
      if (!cheapArrayMethods.has(ref.name)) this.recordWork(ref.receiver.length, node)
      const self = this
      return Effect.map(this.invokeArrayMethod(ref.receiver, ref.name, args, node), (result) => {
        if (Array.isArray(result)) self.recordWork(result.length, node)
        return result
      })
    }
    if (ref.receiver instanceof SandboxDate) {
      return Effect.succeed(invokeDateMethod(ref.receiver, ref.name, node))
    }
    if (ref.receiver instanceof SandboxRegExp) {
      // Regex work scales with the subject; the pattern itself runs on the host engine.
      this.recordWork(typeof args[0] === "string" ? args[0].length : 1, node)
      return Effect.succeed(invokeRegExpMethod(ref.receiver, ref.name, args, node, this.limits))
    }
    if (ref.receiver instanceof SandboxMap) {
      return this.invokeMapMethod(ref.receiver, ref.name, args, node)
    }
    if (ref.receiver instanceof SandboxSet) {
      return this.invokeSetMethod(ref.receiver, ref.name, args, node)
    }
    throw new InterpreterRuntimeError(`Method '${ref.name}' is not available in CodeMode.`, node)
  }

  // Runs a Map/Set callback (forEach) accepting a user function or a builtin coercion,
  // mirroring the array-method callback contract.
  private applyCollectionCallback(callback: unknown, name: string, node: AstNode): (args: Array<unknown>) => Effect.Effect<unknown, unknown, R> {
    if (!(callback instanceof CodeModeFunction) && !(callback instanceof CoercionFunction)) {
      throw new InterpreterRuntimeError(`${name} expects a function callback.`, node)
    }
    return (callbackArgs) =>
      callback instanceof CoercionFunction
        ? Effect.succeed(invokeCoercion(callback, callbackArgs, node, this.limits))
        : this.invokeFunction(callback, callbackArgs)
  }

  private invokeMapMethod(target: SandboxMap, name: string, args: Array<unknown>, node: AstNode): Effect.Effect<unknown, unknown, R> {
    const self = this
    switch (name) {
      case "get": return Effect.succeed(target.map.get(args[0]))
      case "has": return Effect.succeed(target.map.has(args[0]))
      case "set": return Effect.sync(() => {
        this.recordOperation(node)
        this.mapSet(target, args[0], args[1], node)
        return target
      })
      case "delete": return Effect.sync(() => {
        if (!target.map.has(args[0])) return false
        target.bytes -= this.nestedValueBytes(args[0], "Map entry", node) + this.nestedValueBytes(target.map.get(args[0]), "Map entry", node) + 2
        return target.map.delete(args[0])
      })
      case "clear": return Effect.sync(() => {
        target.map.clear()
        target.bytes = 2
        return undefined
      })
      case "keys": return Effect.sync(() => {
        this.recordWork(target.map.size, node)
        return boundedProgramValue(Array.from(target.map.keys()), "Map.keys result", node, this.limits)
      })
      case "values": return Effect.sync(() => {
        this.recordWork(target.map.size, node)
        return boundedProgramValue(Array.from(target.map.values()), "Map.values result", node, this.limits)
      })
      case "entries": return Effect.sync(() => {
        this.recordWork(target.map.size, node)
        return boundedProgramValue(Array.from(target.map.entries(), ([key, item]): Array<unknown> => [key, item]), "Map.entries result", node, this.limits)
      })
      case "forEach": {
        const apply = this.applyCollectionCallback(args[0], "Map.forEach", node)
        return Effect.gen(function*() {
          self.recordWork(target.map.size, node)
          // Snapshot iteration, matching the array-method callback contract.
          for (const [key, item] of Array.from(target.map.entries())) yield* apply([item, key, target])
          return undefined
        })
      }
      default: throw new InterpreterRuntimeError(`Map method '${name}' is not available in CodeMode.`, node)
    }
  }

  private invokeSetMethod(target: SandboxSet, name: string, args: Array<unknown>, node: AstNode): Effect.Effect<unknown, unknown, R> {
    const self = this
    switch (name) {
      case "has": return Effect.succeed(target.set.has(args[0]))
      case "add": return Effect.sync(() => {
        this.recordOperation(node)
        this.setAdd(target, args[0], node)
        return target
      })
      case "delete": return Effect.sync(() => {
        if (!target.set.has(args[0])) return false
        target.bytes -= this.nestedValueBytes(args[0], "Set entry", node) + 2
        return target.set.delete(args[0])
      })
      case "clear": return Effect.sync(() => {
        target.set.clear()
        target.bytes = 2
        return undefined
      })
      case "keys":
      case "values": return Effect.sync(() => {
        this.recordWork(target.set.size, node)
        return boundedProgramValue(Array.from(target.set.values()), `Set.${name} result`, node, this.limits)
      })
      case "entries": return Effect.sync(() => {
        this.recordWork(target.set.size, node)
        return boundedProgramValue(Array.from(target.set.values(), (item): Array<unknown> => [item, item]), "Set.entries result", node, this.limits)
      })
      case "forEach": {
        const apply = this.applyCollectionCallback(args[0], "Set.forEach", node)
        return Effect.gen(function*() {
          self.recordWork(target.set.size, node)
          for (const item of Array.from(target.set.values())) yield* apply([item, item, target])
          return undefined
        })
      }
      default: throw new InterpreterRuntimeError(`Set method '${name}' is not available in CodeMode.`, node)
    }
  }

  private invokeArrayMethod(target: Array<unknown>, name: string, args: Array<unknown>, node: AstNode): Effect.Effect<unknown, unknown, R> {
    const boundedCollection = (items: Array<unknown>): Array<unknown> => {
      if (items.length > this.limits.maxCollectionLength) {
        throw new InterpreterRuntimeError(`Array.${name} exceeds the maximum collection length of ${this.limits.maxCollectionLength}.`, node, "InvalidDataValue")
      }
      return boundedProgramValue(items, `Array.${name} result`, node, this.limits) as Array<unknown>
    }
    const optNumber = (value: unknown, label: string): number | undefined => {
      if (value === undefined) return undefined
      if (typeof value !== "number") throw new InterpreterRuntimeError(`Array.${name} expects ${label} to be a number.`, node)
      return value
    }
    switch (name) {
      case "join": {
        if (args.length > 1 || (args.length === 1 && typeof args[0] !== "string")) {
          throw new InterpreterRuntimeError("Array.join expects zero arguments or one string separator.", node)
        }
        const input = boundedData(target, "Array.join input", node, this.limits) as Array<unknown>
        return Effect.succeed(boundedData(input.map((item) => coerceToString(item ?? "")).join(args.length === 0 ? "," : args[0] as string), "Array.join result", node, this.limits))
      }
      case "includes":
        if (args.length === 0 || args.length > 2) throw new InterpreterRuntimeError("Array.includes expects a value and optional start index.", node)
        return Effect.succeed(target.includes(args[0], optNumber(args[1], "start index")))
      case "indexOf":
        return Effect.succeed(target.indexOf(args[0], optNumber(args[1], "start index")))
      case "lastIndexOf":
        return Effect.succeed(args[1] === undefined ? target.lastIndexOf(args[0]) : target.lastIndexOf(args[0], optNumber(args[1], "start index")))
      case "at":
        return Effect.succeed(target.at(optNumber(args[0], "index") ?? 0))
      case "slice":
        return Effect.succeed(boundedCollection(target.slice(optNumber(args[0], "start"), optNumber(args[1], "end"))))
      case "concat":
        return Effect.succeed(boundedCollection(target.concat(...args)))
      case "flat":
        return Effect.succeed(boundedCollection(target.flat(optNumber(args[0], "depth") ?? 1)))
      case "reverse":
        return Effect.succeed(boundedCollection([...target].reverse()))
      case "sort":
      case "toSorted":
        return this.sortArray(target, args[0], node)
      case "toReversed":
        return Effect.succeed(boundedCollection([...target].reverse()))
      case "with": {
        const index = optNumber(args[0], "index") ?? 0
        const resolved = index < 0 ? target.length + index : index
        if (resolved < 0 || resolved >= target.length) {
          throw new InterpreterRuntimeError("Array.with index is out of range.", node)
        }
        const copied = [...target]
        copied[resolved] = args[1]
        return Effect.succeed(boundedCollection(copied))
      }
      case "push": {
        if (target.length + args.length > this.limits.maxCollectionLength) {
          throw new InterpreterRuntimeError(`Array.push exceeds the maximum collection length of ${this.limits.maxCollectionLength}.`, node, "InvalidDataValue")
        }
        // Validate before mutating (so no rollback is needed) and charge only the new elements,
        // keeping a push loop O(1)/element instead of re-walking the whole array each call.
        let added = 0
        for (const item of args) {
          this.rejectCircularInsertion(target, item, "Array.push result", node)
          added += this.nestedValueBytes(item, "Array.push result", node) + 1
        }
        this.growContainerBytes(target, added, node, "Array.push result")
        target.push(...args)
        return Effect.succeed(target.length)
      }
      case "unshift": {
        if (target.length + args.length > this.limits.maxCollectionLength) {
          throw new InterpreterRuntimeError(`Array.unshift exceeds the maximum collection length of ${this.limits.maxCollectionLength}.`, node, "InvalidDataValue")
        }
        let added = 0
        for (const item of args) {
          this.rejectCircularInsertion(target, item, "Array.unshift result", node)
          added += this.nestedValueBytes(item, "Array.unshift result", node) + 1
        }
        this.growContainerBytes(target, added, node, "Array.unshift result")
        target.unshift(...args)
        return Effect.succeed(target.length)
      }
      // Removals only shrink the array; drop the cached size so the next growth recomputes it.
      case "pop":
        this.containerSizes.delete(target)
        return Effect.succeed(target.pop())
      case "shift":
        this.containerSizes.delete(target)
        return Effect.succeed(target.shift())
    }

    const callback = args[0]
    if (!(callback instanceof CodeModeFunction) && !(callback instanceof CoercionFunction)) {
      throw new InterpreterRuntimeError(`Array.${name} expects a function callback.`, node)
    }
    const self = this
    // Accept a user arrow function or a builtin coercion callable (Boolean/String/Number), so the
    // idioms `filter(Boolean)` / `map(String)` / `map(Number)` work as in JS. Coercions are
    // synchronous; only CodeModeFunctions can await tool calls.
    const apply = (callbackArgs: Array<unknown>): Effect.Effect<unknown, unknown, R> =>
      callback instanceof CoercionFunction
        ? Effect.succeed(invokeCoercion(callback, callbackArgs, node, self.limits))
        : self.invokeFunction(callback, callbackArgs)
    return Effect.gen(function*() {
      // Iterate a snapshot taken at call time so a callback that mutates the array can't
      // self-extend the loop — matching JS, where elements appended during iteration are not visited.
      const items = target.slice()
      switch (name) {
        case "map": {
          const values: Array<unknown> = []
          for (const [index, item] of items.entries()) values.push(yield* apply([item, index, items]))
          return boundedCollection(values)
        }
        case "flatMap": {
          const values: Array<unknown> = []
          for (const [index, item] of items.entries()) {
            const mapped = yield* apply([item, index, items])
            if (Array.isArray(mapped)) values.push(...mapped)
            else values.push(mapped)
            boundedCollection(values)
          }
          return boundedCollection(values)
        }
        case "filter": {
          const values: Array<unknown> = []
          for (const [index, item] of items.entries()) {
            if (yield* apply([item, index, items])) values.push(item)
          }
          return boundedCollection(values)
        }
        case "find":
          for (const [index, item] of items.entries()) {
            if (yield* apply([item, index, items])) return item
          }
          return undefined
        case "findIndex":
          for (const [index, item] of items.entries()) {
            if (yield* apply([item, index, items])) return index
          }
          return -1
        case "some":
          for (const [index, item] of items.entries()) {
            if (yield* apply([item, index, items])) return true
          }
          return false
        case "every":
          for (const [index, item] of items.entries()) {
            if (!(yield* apply([item, index, items]))) return false
          }
          return true
        case "forEach":
          for (const [index, item] of items.entries()) yield* apply([item, index, items])
          return undefined
        case "reduce": {
          let accumulator: unknown
          let start: number
          if (args.length >= 2) {
            accumulator = args[1]
            start = 0
          } else {
            if (items.length === 0) throw new InterpreterRuntimeError("Array.reduce of an empty array with no initial value.", node)
            accumulator = items[0]
            start = 1
          }
          for (let index = start; index < items.length; index += 1) {
            accumulator = yield* apply([accumulator, items[index], index, items])
          }
          return accumulator
        }
        case "reduceRight": {
          let accumulator: unknown
          let start: number
          if (args.length >= 2) {
            accumulator = args[1]
            start = items.length - 1
          } else {
            if (items.length === 0) throw new InterpreterRuntimeError("Array.reduceRight of an empty array with no initial value.", node)
            accumulator = items[items.length - 1]
            start = items.length - 2
          }
          for (let index = start; index >= 0; index -= 1) {
            accumulator = yield* apply([accumulator, items[index], index, items])
          }
          return accumulator
        }
        case "findLast":
          for (let index = items.length - 1; index >= 0; index -= 1) {
            if (yield* apply([items[index], index, items])) return items[index]
          }
          return undefined
        case "findLastIndex":
          for (let index = items.length - 1; index >= 0; index -= 1) {
            if (yield* apply([items[index], index, items])) return index
          }
          return -1
      }
      throw new InterpreterRuntimeError(`Array method '${name}' is not available in CodeMode.`, node)
    })
  }

  private sortArray(target: Array<unknown>, comparator: unknown, node: AstNode): Effect.Effect<Array<unknown>, unknown, R> {
    if (comparator !== undefined && !(comparator instanceof CodeModeFunction)) {
      throw new InterpreterRuntimeError("Array.sort expects an arrow function comparator.", node)
    }
    if (!(comparator instanceof CodeModeFunction)) {
      return Effect.sync(() => boundedProgramValue(
        [...target].sort((a, b) => {
          const left = coerceToString(a)
          const right = coerceToString(b)
          return left < right ? -1 : left > right ? 1 : 0
        }),
        "Array.sort result",
        node,
        this.limits,
      ) as Array<unknown>)
    }
    const self = this
    const mergeSort = (items: Array<unknown>): Effect.Effect<Array<unknown>, unknown, R> => {
      if (items.length <= 1) return Effect.succeed(items)
      const midpoint = Math.floor(items.length / 2)
      return Effect.gen(function*() {
        const left = yield* mergeSort(items.slice(0, midpoint))
        const right = yield* mergeSort(items.slice(midpoint))
        const merged: Array<unknown> = []
        let leftIndex = 0
        let rightIndex = 0
        while (leftIndex < left.length && rightIndex < right.length) {
          // Coerce the comparator's result like JS ToNumber (data objects -> NaN, never a host
          // crash) and treat NaN as 0 — the spec's "no consistent order" → keep the left element.
          const order = coerceToNumber(yield* self.invokeFunction(comparator, [left[leftIndex], right[rightIndex]]))
          if (Number.isNaN(order) || order <= 0) merged.push(left[leftIndex++])
          else merged.push(right[rightIndex++])
        }
        return [...merged, ...left.slice(leftIndex), ...right.slice(rightIndex)]
      })
    }
    // Per spec, undefined elements sort to the end and the comparator is never called on them.
    const defined = target.filter((item) => item !== undefined)
    const undefinedCount = target.length - defined.length
    return Effect.map(mergeSort(defined), (items) =>
      boundedProgramValue([...items, ...Array(undefinedCount).fill(undefined)], "Array.sort result", node, this.limits) as Array<unknown>)
  }

  private evaluateObjectExpression(node: AstNode): Effect.Effect<Record<string, unknown>, unknown, R> {
    const objectValue: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    const keys = new Set<string>()
    const properties = getArray(node, "properties")
    const self = this
    return Effect.gen(function*() {
      for (const propertyValue of properties) {
        const property = asNode(propertyValue, "properties")

        if (property.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(getNode(property, "argument"))
          // JS treats `{ ...null }` / `{ ...undefined }` as a no-op, so the common
          // `{ ...maybeOpts, override }` merge works when the operand is absent. Sandbox values
          // (Date/RegExp/Map/Set) have no own enumerable properties in JS, so they are no-ops too.
          if (spread === null || spread === undefined || isSandboxValue(spread)) continue
          if (typeof spread !== "object" || Array.isArray(spread) || isRuntimeReference(spread)) {
            throw new InterpreterRuntimeError("Object spread requires a data object in CodeMode.", property, "InvalidDataValue")
          }
          for (const [key, value] of Object.entries(spread)) {
            if (isBlockedMember(key)) throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, property)
            objectValue[key] = value
            keys.add(key)
            if (keys.size > self.limits.maxCollectionLength) {
              throw new InterpreterRuntimeError(`Object expression exceeds the maximum collection length of ${self.limits.maxCollectionLength}.`, property, "InvalidDataValue")
            }
          }
          continue
        }

        if (property.type !== "Property") {
          throw new InterpreterRuntimeError("Only standard object properties are supported.", property)
        }

        if (getString(property, "kind") !== "init") {
          throw new InterpreterRuntimeError("Only init object properties are supported.", property)
        }

        const keyNode = getNode(property, "key")
        const valueNode = getNode(property, "value")
        const computed = getBoolean(property, "computed")

        let key: PropertyKey

        if (computed) {
          key = self.toPropertyKey(yield* self.evaluateExpression(keyNode), keyNode)
        } else if (keyNode.type === "Identifier") {
          key = getString(keyNode, "name")
        } else if (keyNode.type === "Literal") {
          key = self.toPropertyKey(keyNode.value, keyNode)
        } else {
          throw new InterpreterRuntimeError("Unsupported object property key shape.", keyNode)
        }

        if (isBlockedMember(String(key))) {
          throw new InterpreterRuntimeError(`Property '${String(key)}' is not available in CodeMode.`, keyNode)
        }
        objectValue[String(key)] = yield* self.evaluateExpression(valueNode)
        keys.add(String(key))
        if (keys.size > self.limits.maxCollectionLength) {
          throw new InterpreterRuntimeError(`Object expression exceeds the maximum collection length of ${self.limits.maxCollectionLength}.`, property, "InvalidDataValue")
        }
      }

      return boundedProgramValue(objectValue, "Object expression result", node, self.limits) as Record<string, unknown>
    })
  }

  private evaluateArrayExpression(node: AstNode): Effect.Effect<Array<unknown>, unknown, R> {
    const elements = getArray(node, "elements")
    const values: Array<unknown> = []

    const self = this
    return Effect.gen(function*() {
      for (const elementValue of elements) {
        if (elementValue === null) {
          values.push(undefined)
          if (values.length > self.limits.maxCollectionLength) {
            throw new InterpreterRuntimeError(`Array expression exceeds the maximum collection length of ${self.limits.maxCollectionLength}.`, node, "InvalidDataValue")
          }
          continue
        }
        const element = asNode(elementValue, "elements")
        if (element.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(getNode(element, "argument"))
          const items = spreadItems(spread)
          if (items === undefined) throw new InterpreterRuntimeError("Array spread requires an array, string, Map, or Set in CodeMode.", element)
          values.push(...items)
          self.recordWork(items.length, element)
        } else {
          values.push(yield* self.evaluateExpression(element))
        }
        if (values.length > self.limits.maxCollectionLength) {
          throw new InterpreterRuntimeError(`Array expression exceeds the maximum collection length of ${self.limits.maxCollectionLength}.`, node, "InvalidDataValue")
        }
      }
      return boundedProgramValue(values, "Array expression result", node, self.limits) as Array<unknown>
    })
  }

  private evaluateTemplateLiteral(node: AstNode): Effect.Effect<string, unknown, R> {
    const quasis = getArray(node, "quasis")
    const expressions = getArray(node, "expressions")

    let output = ""

    const self = this
    return Effect.gen(function*() {
      for (let index = 0; index < quasis.length; index += 1) {
        const quasi = asNode(quasis[index], "quasis")
        const rawValue = quasi.value

        if (!isRecord(rawValue) || typeof rawValue.cooked !== "string") {
          throw new InterpreterRuntimeError("Invalid template literal quasi.", quasi)
        }

        output += rawValue.cooked
        boundedData(output, "Template literal result", node, self.limits)

        if (index < expressions.length) {
          const raw = yield* self.evaluateExpression(asNode(expressions[index], "expressions"))
          // Sandbox values stringify directly (ISO date, /regex/ form) — the data checkpoint
          // would JSON-serialize them first (a regex would render "[object Object]" via {}).
          const value = isSandboxValue(raw) ? raw : boundedData(raw, "Template interpolation", node, self.limits)
          output += coerceToString(value)
          boundedData(output, "Template literal result", node, self.limits)
        }
      }

      return output
    })
  }

  private evaluateConditionalExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    return Effect.flatMap(this.evaluateExpression(getNode(node, "test")), (test) =>
      this.evaluateExpression(getNode(node, test ? "consequent" : "alternate")))
  }

  private applyCompoundAssignment(
    operator: string,
    current: unknown,
    incoming: unknown,
    node: AstNode,
  ): unknown {
    const lhs = current as any
    const rhs = incoming as any

    switch (operator) {
      case "+=":
        return lhs + rhs
      case "-=":
        return lhs - rhs
      case "*=":
        return lhs * rhs
      case "/=":
        return lhs / rhs
      case "%=":
        return lhs % rhs
      case "**=":
        return lhs ** rhs
      case "&=":
        return lhs & rhs
      case "|=":
        return lhs | rhs
      case "^=":
        return lhs ^ rhs
      case "<<=":
        return lhs << rhs
      case ">>=":
        return lhs >> rhs
      case ">>>=":
        return lhs >>> rhs
      default:
        throw new InterpreterRuntimeError(`Unsupported assignment operator '${operator}'.`, node)
    }
  }

  private getMemberReference(node: AstNode): Effect.Effect<MemberReference | ToolReference | PromiseMethodReference | IntrinsicReference | GlobalMethodReference | ComputedValue | typeof OptionalShortCircuit | undefined, unknown, R> {
    const objectNode = getNode(node, "object")
    const propertyNode = getNode(node, "property")
    const computed = getBoolean(node, "computed")
    const optional = node.optional === true
    const self = this
    return Effect.gen(function*() {
      const objectValue = yield* self.evaluateExpression(objectNode)
      if (objectValue === OptionalShortCircuit) return OptionalShortCircuit
      if ((objectValue === null || objectValue === undefined) && optional) return OptionalShortCircuit

      const key = computed
        ? self.toPropertyKey(yield* self.evaluateExpression(propertyNode), propertyNode)
        : propertyNode.type === "Identifier"
          ? getString(propertyNode, "name")
          : self.toPropertyKey(yield* self.evaluateExpression(propertyNode), propertyNode)

      if (objectValue instanceof ToolReference) {
        if (typeof key !== "string" || isBlockedMember(key)) {
          throw new InterpreterRuntimeError("Tool paths must use safe string property names.", propertyNode)
        }
        return new ToolReference([...objectValue.path, key])
      }

      if (objectValue instanceof PromiseNamespace) {
        if (typeof key === "string" && promiseStatics.has(key as PromiseMethodName)) {
          return new PromiseMethodReference(key as PromiseMethodName)
        }
        throw new InterpreterRuntimeError(
          `Promise.${String(key)} is not available in CodeMode. Available: Promise.all, Promise.allSettled, Promise.race, Promise.resolve, and Promise.reject; consume promises with await.`,
          propertyNode,
        )
      }

      if (objectValue instanceof GlobalNamespace) {
        if (typeof key !== "string" || isBlockedMember(key)) {
          throw new InterpreterRuntimeError(`${objectValue.name}.${String(key)} is not available in CodeMode.`, propertyNode)
        }
        if (objectValue.name === "Math" && mathConstants.has(key)) {
          return new ComputedValue((Math as unknown as Record<string, number>)[key])
        }
        return new GlobalMethodReference(objectValue.name, key)
      }

      if (typeof objectValue === "string") {
        if (key === "length") return new ComputedValue(objectValue.length)
        if (typeof key === "number") return new ComputedValue(objectValue[key])
        if (typeof key === "string" && /^\d+$/.test(key)) return new ComputedValue(objectValue[Number(key)])
        if (typeof key === "string" && stringMethods.has(key)) return new IntrinsicReference(objectValue, key)
        // Unknown property on a string reads as `undefined`, matching JS (`"x".foo === undefined`),
        // instead of throwing — so defensive access like `result?.login ?? result` on a JSON-string
        // tool result doesn't crash. (Optional chaining only guards null/undefined receivers, so a
        // real string still reaches here.) Only the method allowlist above yields callables.
        return new ComputedValue(undefined)
      }

      if (typeof objectValue === "number") {
        if (typeof key === "string" && numberMethods.has(key)) return new IntrinsicReference(objectValue, key)
        // Unknown property on a number reads as `undefined`, matching JS, rather than throwing.
        return new ComputedValue(undefined)
      }

      // Number / String expose a small allowlist of statics; everything else stays opaque.
      if (objectValue instanceof CoercionFunction && typeof key === "string" && !isBlockedMember(key)) {
        if (objectValue.name === "Number" && numberConstants.has(key)) {
          return new ComputedValue((Number as unknown as Record<string, number>)[key])
        }
        if (objectValue.name === "Number" && numberStatics.has(key)) return new GlobalMethodReference("Number", key)
        if (objectValue.name === "String" && stringStatics.has(key)) return new GlobalMethodReference("String", key)
      }

      // Sandbox value types expose their method/property allowlists; any other key reads as
      // `undefined`, consistent with unknown-property reads on strings/numbers/arrays.
      if (objectValue instanceof SandboxDate) {
        if (typeof key === "string" && dateMethods.has(key)) return new IntrinsicReference(objectValue, key)
        return new ComputedValue(undefined)
      }
      if (objectValue instanceof SandboxRegExp) {
        if (typeof key === "string" && regexpProperties.has(key)) {
          return new ComputedValue((objectValue.regex as unknown as Record<string, unknown>)[key])
        }
        if (typeof key === "string" && regexpMethods.has(key)) return new IntrinsicReference(objectValue, key)
        return new ComputedValue(undefined)
      }
      if (objectValue instanceof SandboxMap) {
        if (key === "size") return new ComputedValue(objectValue.map.size)
        if (typeof key === "string" && mapMethods.has(key)) return new IntrinsicReference(objectValue, key)
        return new ComputedValue(undefined)
      }
      if (objectValue instanceof SandboxSet) {
        if (key === "size") return new ComputedValue(objectValue.set.size)
        if (typeof key === "string" && setMethods.has(key)) return new IntrinsicReference(objectValue, key)
        return new ComputedValue(undefined)
      }

      // Any property access on a promise is a confused program (`p.then(...)`, `p.value`);
      // reading `undefined` here would hide the missing await, so both paths get an explicit,
      // await-hinting error instead of the forgiving unknown-property fallthrough.
      if (objectValue instanceof SandboxPromise) {
        if (key === "then" || key === "catch" || key === "finally") {
          throw new InterpreterRuntimeError(
            `Promise.prototype.${String(key)} is not supported in CodeMode; use await instead (with try/catch to handle failures) — e.g. \`const result = await tools.ns.tool(...)\`.`,
            propertyNode,
            "UnsupportedSyntax",
            [supportedSyntaxMessage],
          )
        }
        throw new InterpreterRuntimeError(
          "This value is an un-awaited Promise and has no readable properties; await it first — e.g. `const result = await tools.ns.tool(...)`.",
          objectNode,
          "InvalidDataValue",
        )
      }

      if (isRuntimeReference(objectValue)) {
        throw new InterpreterRuntimeError("CodeMode runtime references are opaque and do not expose properties.", objectNode, "InvalidDataValue")
      }

      if (typeof objectValue !== "object" || objectValue === null) {
        throw new InterpreterRuntimeError("Cannot access a property on a non-object value.", objectNode)
      }

      if (typeof key === "string" && isBlockedMember(key)) {
        throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, propertyNode)
      }

      if (Array.isArray(objectValue)) {
        if (key !== "length" && !(typeof key === "string" && arrayMethods.has(key)) && (typeof key !== "number" && !/^\d+$/.test(key))) {
          // Own non-index properties read through (match results carry index/groups); like JS,
          // they are readable in place and dropped by JSON at data boundaries.
          if (typeof key === "string" && Object.hasOwn(objectValue, key)) {
            return new ComputedValue((objectValue as Record<string, unknown> & Array<unknown>)[key])
          }
          if (typeof key === "string" && retryableArrayMethods.has(key)) {
            throw new InterpreterRuntimeError(
              `Array.${key}(...) is not supported in CodeMode. Rewrite using map/filter/find/some/every/includes/join or a for...of loop.`,
              propertyNode,
              "UnsupportedSyntax",
              [supportedSyntaxMessage],
            )
          }
          // Unknown property on an array reads as `undefined`, matching JS (`[1,2].foo === undefined`),
          // instead of throwing — so defensive access under optional chaining behaves as expected. The
          // retryable-method hint above still fires for real methods we don't support (e.g. splice).
          return new ComputedValue(undefined)
        }
        return { target: objectValue, key }
      }

      return { target: objectValue as SafeObject, key }
    })
  }

  private readMember(node: AstNode): Effect.Effect<unknown, unknown, R> {
    return Effect.map(this.getMemberReference(node), (reference) => {
      if (reference === OptionalShortCircuit) return OptionalShortCircuit
      if (reference instanceof ComputedValue) return reference.value
      if (
        reference === undefined ||
        reference instanceof ToolReference ||
        reference instanceof PromiseMethodReference ||
        reference instanceof IntrinsicReference ||
        reference instanceof GlobalMethodReference
      ) return reference
      if (Array.isArray(reference.target)) {
        if (typeof reference.key === "string" && arrayMethods.has(reference.key)) {
          return new IntrinsicReference(reference.target, reference.key)
        }
        return reference.key === "length" ? reference.target.length : reference.target[Number(reference.key)]
      }
      return reference.target[String(reference.key)]
    })
  }

  private writeMember(node: AstNode, value: unknown): Effect.Effect<unknown, unknown, R> {
    return this.modifyMember(node, () => Effect.succeed({ write: true, next: value, result: value }))
  }

  // Resolves the member reference EXACTLY ONCE (so a side-effecting object/key expression
  // runs once), then lets `compute` decide whether to write — enabling compound assignment,
  // updates, plain writes, and short-circuiting logical assignment to share one safe path.
  private modifyMember(
    node: AstNode,
    compute: (current: unknown) => Effect.Effect<{ write: boolean; next: unknown; result: unknown }, unknown, R>,
  ): Effect.Effect<unknown, unknown, R> {
    const self = this
    return Effect.gen(function*() {
      const reference = yield* self.getMemberReference(node)
      if (
        reference === OptionalShortCircuit ||
        reference instanceof ComputedValue ||
        reference === undefined ||
        reference instanceof ToolReference ||
        reference instanceof PromiseMethodReference ||
        reference instanceof IntrinsicReference ||
        reference instanceof GlobalMethodReference
      ) {
        throw new InterpreterRuntimeError("Only data fields may be assigned in CodeMode.", node)
      }
      if (Array.isArray(reference.target)) {
        if (reference.key === "length") throw new InterpreterRuntimeError("Array length cannot be assigned in CodeMode.", node)
        if (typeof reference.key === "string" && arrayMethods.has(reference.key)) {
          throw new InterpreterRuntimeError("Array methods cannot be assigned in CodeMode.", node)
        }
      }
      const key = Array.isArray(reference.target) ? Number(reference.key) : String(reference.key)
      const current = (reference.target as Record<PropertyKey, unknown>)[key]
      const { write, next, result } = yield* compute(current)
      if (write) self.assignToReference(reference, key, next, node)
      return result
    })
  }

  // Writes `next` to a resolved member, enforcing index/capacity/byte limits and rolling
  // back the mutation if the bound is exceeded (so a caught error can't leave it grown).
  // Byte size of a container, cached after the first walk and maintained incrementally by the
  // mutation helpers. O(1) on a cache hit; O(container) once on the first touch.
  private cachedContainerBytes(container: object, node: AstNode): number {
    const cached = this.containerSizes.get(container)
    if (cached !== undefined) return cached
    const bytes = runtimeValueBytes(container, "value", node, this.limits)
    this.recordWork(workUnits(container), node)
    this.containerSizes.set(container, bytes)
    return bytes
  }

  // Bytes a value contributes when nested one level inside a container; also enforces that the
  // nested value's depth stays within maxValueDepth. O(value), independent of the container size.
  private nestedValueBytes(value: unknown, label: string, node: AstNode): number {
    return runtimeValueBytes(value, label, node, this.limits, 1)
  }

  private rejectCircularInsertion(container: object, value: unknown, label: string, node: AstNode, seen = new Set<object>()): void {
    if (value === container) throw new InterpreterRuntimeError(`${label} contains a circular value.`, node, "InvalidDataValue")
    if (value === null || typeof value !== "object" || isRuntimeReference(value) || seen.has(value)) return
    seen.add(value)
    const items = Array.isArray(value) ? value : Object.values(value)
    for (const item of items) this.rejectCircularInsertion(container, item, label, node, seen)
    seen.delete(value)
  }

  // Add `addedBytes` of new entries to a container, rejecting (before any mutation) if that would
  // exceed maxDataBytes, then record the container's new cached size.
  private growContainerBytes(container: object, addedBytes: number, node: AstNode, label: string): void {
    const next = this.cachedContainerBytes(container, node) + addedBytes
    if (next > this.limits.maxDataBytes) {
      throw new InterpreterRuntimeError(`${label} exceeds the maximum data size of ${this.limits.maxDataBytes} bytes.`, node, "InvalidDataValue")
    }
    this.containerSizes.set(container, next)
  }

  private assignToReference(reference: MemberReference, key: number | string, next: unknown, node: AstNode): void {
    if (Array.isArray(reference.target)) {
      const target = reference.target
      const index = key as number
      if (!Number.isInteger(index) || index < 0 || index >= this.limits.maxCollectionLength) {
        throw new InterpreterRuntimeError(`Array assignment index must be between 0 and ${this.limits.maxCollectionLength - 1}.`, node, "InvalidDataValue")
      }
      this.rejectCircularInsertion(target, next, "Array assignment result", node)
      const addedBytes = this.nestedValueBytes(next, "Array assignment result", node)
      if (index === target.length) {
        // Append — the hot path; O(1) incremental size update (this is the O(n^2)-loop fix).
        this.growContainerBytes(target, addedBytes + 1, node, "Array assignment result")
        target[index] = next
      } else if (index < target.length) {
        // Replace an existing slot (value or hole): adjust by the byte delta.
        const oldBytes = this.nestedValueBytes(target[index], "Array assignment result", node)
        const nextSize = this.cachedContainerBytes(target, node) + addedBytes - oldBytes
        if (nextSize > this.limits.maxDataBytes) {
          throw new InterpreterRuntimeError(`Array assignment result exceeds the maximum data size of ${this.limits.maxDataBytes} bytes.`, node, "InvalidDataValue")
        }
        this.containerSizes.set(target, nextSize)
        target[index] = next
      } else {
        // index > length introduces holes; fall back to a full revalidation and reset the cache.
        const previousLength = target.length
        target[index] = next
        try {
          boundedProgramValue(target, "Array assignment result", node, this.limits)
          this.containerSizes.set(target, runtimeValueBytes(target, "value", node, this.limits))
        } catch (error) {
          delete target[index]
          target.length = previousLength
          throw error
        }
      }
      return
    }
    const target = reference.target as SafeObject
    const objectKey = key as string
    this.rejectCircularInsertion(target, next, "Object assignment result", node)
    const addedBytes = this.nestedValueBytes(next, "Object assignment result", node)
    if (Object.hasOwn(target, objectKey)) {
      const oldBytes = this.nestedValueBytes(target[objectKey], "Object assignment result", node)
      const nextSize = this.cachedContainerBytes(target, node) + addedBytes - oldBytes
      if (nextSize > this.limits.maxDataBytes) {
        throw new InterpreterRuntimeError(`Object assignment result exceeds the maximum data size of ${this.limits.maxDataBytes} bytes.`, node, "InvalidDataValue")
      }
      this.containerSizes.set(target, nextSize)
      target[objectKey] = next
      return
    }
    const count = (this.objectCounts.get(target) ?? Object.keys(target).length) + 1
    if (count > this.limits.maxCollectionLength) {
      throw new InterpreterRuntimeError(`Object assignment exceeds the maximum collection length of ${this.limits.maxCollectionLength}.`, node, "InvalidDataValue")
    }
    this.growContainerBytes(target, dataByteLength(objectKey) + addedBytes + 1, node, "Object assignment result")
    this.objectCounts.set(target, count)
    target[objectKey] = next
  }

  private toPropertyKey(value: unknown, node: AstNode): string | number {
    if (typeof value === "string" || typeof value === "number") {
      return value
    }

    throw new InterpreterRuntimeError("Property key must be a string or number.", node)
  }

  private declare(name: string, value: unknown, mutable: boolean, node: AstNode): void {
    const scope = this.currentScope()

    // A pre-seeded parameter slot (initialized === false) is being bound for the first time;
    // anything else already present is a genuine duplicate declaration.
    const existing = scope.get(name)
    if (existing && existing.initialized !== false) {
      throw new InterpreterRuntimeError(`Identifier '${name}' has already been declared.`, node)
    }

    scope.set(name, { mutable, value, initialized: true })
  }

  private getIdentifierValue(name: string, node: AstNode): unknown {
    const binding = this.resolveBinding(name)

    if (!binding) {
      throw new InterpreterRuntimeError(`Unknown identifier '${name}'.`, node)
    }

    // A parameter default that forward-references a later (not-yet-bound) parameter — JS TDZ.
    if (binding.initialized === false) {
      throw new InterpreterRuntimeError(`Cannot access '${name}' before initialization.`, node)
    }

    return binding.value
  }

  private setIdentifierValue(name: string, value: unknown, node: AstNode): unknown {
    const binding = this.resolveBinding(name)

    if (!binding) {
      throw new InterpreterRuntimeError(`Unknown identifier '${name}'.`, node)
    }

    if (!binding.mutable) {
      throw new InterpreterRuntimeError(`Cannot assign to constant '${name}'.`, node)
    }

    binding.value = value
    return value
  }

  private resolveBinding(name: string): Binding | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const scope = this.scopes[index]
      const binding = scope?.get(name)

      if (binding) {
        return binding
      }
    }

    return undefined
  }

  private currentScope(): Map<string, Binding> {
    const scope = this.scopes[this.scopes.length - 1]

    if (!scope) {
      throw new InterpreterRuntimeError("Interpreter scope stack is empty.")
    }

    return scope
  }

  private pushScope(): void {
    this.scopes.push(new Map())
  }

  private popScope(): void {
    this.scopes.pop()
  }

  private recordOperation(node: AstNode): void {
    this.recordWork(1, node)
  }

  // Charge `units` of work to the operation budget so O(n) built-ins (collection/string
  // walks and spreads) are bounded by maxOperations, not only by the wall-clock timeout.
  private recordWork(units: number, node?: AstNode): void {
    this.budget.operations += Math.max(1, Math.ceil(units))

    if (this.budget.operations > this.limits.maxOperations) {
      throw new InterpreterRuntimeError(`Execution exceeded its operation limit of ${this.limits.maxOperations}.`, node, "OperationLimitExceeded")
    }
  }
}

/**
 * Executes one Effect-native CodeMode program without constructing a reusable runtime.
 *
 * @example
 * ```ts
 * const result = yield* CodeMode.execute({
 *   tools: { lookup },
 *   code: `return await tools.lookup({ id: "order_42" })`,
 * })
 * ```
 */
const executeWithLimits = <const Tools extends Record<string, unknown>>(
  options: ExecuteOptions<Tools>,
  limits: ResolvedExecutionLimits,
  searchIndex: ToolRuntime.DiscoveryPlan["searchIndex"],
): Effect.Effect<ExecuteResult, never, Services<Tools>> => {
  const hooks = {
    ...(options.onToolCallStart === undefined ? {} : { onToolCallStart: options.onToolCallStart }),
    ...(options.onToolCallEnd === undefined ? {} : { onToolCallEnd: options.onToolCallEnd }),
  }
  const tools = ToolRuntime.make((options.tools ?? {}) as HostTools<Services<Tools>>, limits.maxToolCalls, limits, hooks, searchIndex)
  const logs: Array<string> = []
  const logged = () => logs.length > 0 ? { logs: [...logs] } : {}

  if (new TextEncoder().encode(options.code).byteLength > limits.maxSourceBytes) {
    return Effect.succeed({
      ok: false,
      error: { kind: "InvalidDataValue", message: `Code exceeds the maximum source size of ${limits.maxSourceBytes} bytes.` },
      toolCalls: tools.calls,
    })
  }

  if (options.code.trim().length === 0) {
    return Effect.succeed({
      ok: false,
      error: { kind: "ParseError", message: "Code cannot be empty." },
      toolCalls: tools.calls,
    })
  }

  const operation = Effect.gen(function*() {
    const program = parseProgram(options.code)
    const interpreter = new Interpreter<Services<Tools>>(limits, tools.invoke, tools.keys, { operations: 0 }, logs, { bytes: 0 })
    const value = yield* interpreter.run(program)
    const result = copyOut(copyIn(value, "Execution result", limits), true) as DataValue
    if (dataByteLength(result) > limits.maxDataBytes) {
      throw new InterpreterRuntimeError(`Execution result exceeds the maximum data size of ${limits.maxDataBytes} bytes.`, undefined, "InvalidDataValue")
    }
    return {
      ok: true,
      value: result,
      ...logged(),
      toolCalls: tools.calls,
    } satisfies ExecuteResult
  }).pipe(
    Effect.timeoutOrElse({
      duration: limits.timeoutMs,
      orElse: () => Effect.succeed({
        ok: false,
        error: { kind: "TimeoutExceeded", message: `Execution timed out after ${limits.timeoutMs}ms.` },
        ...logged(),
        toolCalls: tools.calls,
      } satisfies ExecuteResult),
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
            toolCalls: tools.calls,
          } satisfies ExecuteResult),
    ),
    Effect.map((result) => boundOutput(result, limits.maxOutputBytes)),
  )
}

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength

// Truncates to a UTF-8 byte budget without splitting a code point (a split multi-byte
// sequence decodes to a replacement character, which is dropped).
const utf8Truncate = (value: string, maxBytes: number): string => {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength <= maxBytes) return value
  const text = new TextDecoder("utf-8").decode(bytes.slice(0, Math.max(0, maxBytes)))
  return text.endsWith("\uFFFD") ? text.slice(0, -1) : text
}

/**
 * Bounds the model-facing output (serialized result value plus logs) to `maxOutputBytes`.
 * Oversized values are replaced by their truncated serialized text with an explanatory marker,
 * and logs are kept from the start until the remaining budget is exhausted. Truncation never
 * fails the execution; `truncated: true` marks affected results.
 */
const boundOutput = (result: ExecuteResult, maxOutputBytes: number): ExecuteResult => {
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
  const logsPart = kept.length > 0 ? { logs: kept } : {}
  return result.ok
    ? { ok: true, value, ...logsPart, truncated: true, toolCalls: result.toolCalls }
    : { ok: false, error: result.error, ...logsPart, truncated: true, toolCalls: result.toolCalls }
}

export const execute = <const Tools extends Record<string, unknown>>(options: ExecuteOptions<Tools>): Effect.Effect<ExecuteResult, never, Services<Tools>> => {
  const tools = (options.tools ?? {}) as HostTools<Services<Tools>>
  ToolRuntime.assertValidTools(tools)
  return executeWithLimits(options, resolveExecutionLimits(options.limits), ToolRuntime.searchIndex(tools))
}

/**
 * Creates an Effect-native runtime over explicit, schema-described tools.
 *
 * Use `execute` for host-driven execution or `agentTool` to expose one confined code tool to an
 * agent framework. Tool requirements remain in the returned Effect environment.
 *
 * @example
 * ```ts
 * const runtime = CodeMode.make({ tools: { orders: { lookup } } })
 * const code = runtime.agentTool()
 * ```
 */
export const make = <const Tools extends Record<string, unknown> = {}>(options: CodeModeOptions<Tools> = {} as CodeModeOptions<Tools>): CodeModeRuntime<Services<Tools>> => {
  const tools = (options.tools ?? {}) as HostTools<Services<Tools>>
  ToolRuntime.assertValidTools(tools)
  const limits = resolveExecutionLimits(options.limits)
  const discovery = ToolRuntime.discoveryPlan(tools, options.discovery?.maxInlineCatalogBytes)
  const executeProgram = (code: string) => executeWithLimits<Tools>({ ...options, code }, limits, discovery.searchIndex)
  const catalog = discovery.catalog
  const instructions = discovery.instructions

  return {
    catalog: () => catalog,
    instructions: () => instructions,
    agentTool: () => ({
      name: "code",
      description: instructions,
      input: ExecuteInputSchema,
      output: ExecuteResultSchema,
      execute: ({ code }) => executeProgram(code),
    }),
    execute: executeProgram,
  }
}

/** Constructors for one-shot and reusable CodeMode execution. */
export const CodeMode = { make, execute }
