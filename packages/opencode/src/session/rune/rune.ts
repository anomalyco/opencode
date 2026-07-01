import { parse } from "acorn"
import { Cause, Effect, Schema } from "effect"
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
import { CapabilityError } from "./capability-error.js"

export type { ToolCall, ToolDescription } from "./tool-runtime.js"
export { Tool } from "./tool.js"
export { CapabilityError } from "./capability-error.js"

/** Resource budgets enforced during each Rune Program execution. */
export type ExecutionLimits = {
  readonly maxOperations?: number
  readonly maxToolCalls?: number
  readonly maxConcurrency?: number
  readonly maxSourceBytes?: number
  readonly maxDataBytes?: number
  readonly maxAuditBytes?: number
  readonly maxValueDepth?: number
  readonly maxCollectionLength?: number
  readonly timeoutMs?: number
}

type CapabilityTree<R = never> = {
  readonly [name: string]: Definition<R> | CapabilityTree<R>
}

type ResolvedExecutionLimits = {
  readonly maxOperations: number
  readonly maxToolCalls: number
  readonly maxConcurrency: number
  readonly maxSourceBytes: number
  readonly maxDataBytes: number
  readonly maxAuditBytes: number
  readonly maxValueDepth: number
  readonly maxCollectionLength: number
  readonly timeoutMs: number
}

export type ExecuteOptions<Tools extends Record<string, unknown> = {}> = {
  code: string
  tools?: Tools & CapabilityTree<any>
  limits?: ExecutionLimits
}

/** One captured `console.*` line: the method used and the formatted message. */
export type LogEntry = {
  readonly level: "log" | "warn" | "error" | "info" | "debug"
  readonly message: string
}

export type ExecuteResult =
  | {
      ok: true
      value: unknown
      toolCalls: ReadonlyArray<ToolCall>
      logs: ReadonlyArray<LogEntry>
    }
  | {
      ok: false
      error: {
        kind: DiagnosticKind
        message: string
        location?: { readonly line: number; readonly column: number }
        suggestions?: ReadonlyArray<string>
      }
      toolCalls: ReadonlyArray<ToolCall>
      logs: ReadonlyArray<LogEntry>
    }

export type RuneOptions<Tools extends Record<string, unknown> = {}> = Omit<ExecuteOptions<Tools>, "code">

/** Input schema for the single agent-facing tool produced by `rune.asTool()`. */
export const CodeInput = Schema.Struct({ code: Schema.String })

const DiagnosticKindSchema = Schema.Literals([
  "ParseError", "UnsupportedSyntax", "UnknownCapability", "InvalidToolInput", "InvalidToolOutput", "InvalidDataValue",
  "OperationLimitExceeded", "ToolCallLimitExceeded", "AuditLimitExceeded", "ConcurrencyLimitExceeded", "TimeoutExceeded",
  "CapabilityFailure", "ExecutionFailure",
])

/** Structured success or diagnostic result schema returned by Rune execution. */
export const ExecuteResultSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Unknown,
    toolCalls: Schema.Array(Schema.Struct({ name: Schema.String })),
    logs: Schema.Array(Schema.Struct({ level: Schema.String, message: Schema.String })),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.Struct({
      kind: DiagnosticKindSchema,
      message: Schema.String,
      location: Schema.optional(Schema.Struct({ line: Schema.Number, column: Schema.Number })),
      suggestions: Schema.optional(Schema.Array(Schema.String)),
    }),
    toolCalls: Schema.Array(Schema.Struct({ name: Schema.String })),
    logs: Schema.Array(Schema.Struct({ level: Schema.String, message: Schema.String })),
  }),
])

export type CodeTool<R = never> = {
  readonly name: "code"
  readonly description: string
  readonly input: typeof CodeInput
  readonly execute: (input: { readonly code: string }) => Effect.Effect<ExecuteResult, never, R>
}

export type Rune<R = never> = {
  /** Lists schema-described capability paths provided by the host. */
  readonly catalog: () => ReadonlyArray<ToolDescription>
  /** Builds model-facing syntax guidance and visible capability signatures. */
  readonly instructions: () => string
  /** Projects the configured runtime as one agent-facing `code` tool. */
  readonly asTool: () => CodeTool<R>
  /** Executes a program using this runtime's configured host tools. */
  readonly run: (code: string) => Effect.Effect<ExecuteResult, never, R>
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

class RuneFunction {
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

class PromiseAllReference {}

// A built-in global namespace (`Object`, `Math`, `JSON`, `Array`); members resolve to a
// GlobalMethodReference, except known constants (e.g. `Math.PI`) which resolve to a value.
class GlobalNamespace {
  constructor(readonly name: "Object" | "Math" | "JSON" | "Array") {}
}

class GlobalMethodReference {
  constructor(readonly namespace: "Object" | "Math" | "JSON" | "Array" | "Number" | "String", readonly name: string) {}
}

// A built-in callable global (`Number`, `String`, `Boolean`, `parseInt`, `parseFloat`).
class CoercionFunction {
  constructor(readonly name: "Number" | "String" | "Boolean" | "parseInt" | "parseFloat") {}
}

// The `console` builtin. `console.<level>` resolves to a ConsoleMethodReference; calling it
// formats its arguments and appends a line to the run's shared LogCollector. Logging is a pure
// side effect on the host — it never dispatches a tool, spends the tool-call budget, or returns
// a value the program can branch on (every method returns undefined, like JS `console`).
class ConsoleReference {}

const consoleLevels = new Set(["log", "warn", "error", "info", "debug"] as const)

class ConsoleMethodReference {
  constructor(readonly level: LogEntry["level"]) {}
}

/**
 * Collects `console.*` output for one execution. Shared by reference across parallel
 * interpreter forks (like the operation budget), so logs emitted inside `Promise.all`
 * / `.map` callbacks are captured too. Bounded by a total character budget — once spent,
 * further lines are dropped (the last accepted line is truncated to fit) so a logging loop
 * can't grow memory without also spending the operation budget.
 */
class LogCollector {
  readonly entries: LogEntry[] = []
  private used = 0
  constructor(private readonly maxChars: number) {}
  push(level: LogEntry["level"], message: string): void {
    if (this.used >= this.maxChars) return
    const remaining = this.maxChars - this.used
    const text = message.length > remaining ? message.slice(0, remaining) : message
    this.used += text.length
    this.entries.push({ level, message: text })
  }
}

/** Format one `console.*` argument the way `console` roughly does: strings verbatim,
 *  objects/arrays as JSON, opaque runtime references as a placeholder (never leaking their
 *  internals), everything else via String(). Never throws. */
const formatLogArg = (value: unknown): string => {
  if (typeof value === "string") return value
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (isRuntimeReference(value)) return "[runtime reference]"
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? coerceToString(value)
    } catch {
      return coerceToString(value)
    }
  }
  return String(value)
}

class ProgramThrow {
  constructor(readonly value: unknown) {}
}

export type DiagnosticKind =
  | "ParseError"
  | "UnsupportedSyntax"
  | "UnknownCapability"
  | "InvalidToolInput"
  | "InvalidToolOutput"
  | "InvalidDataValue"
  | "OperationLimitExceeded"
  | "ToolCallLimitExceeded"
  | "AuditLimitExceeded"
  | "ConcurrencyLimitExceeded"
  | "TimeoutExceeded"
  | "CapabilityFailure"
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
])

const numberConstants = new Set(["MAX_SAFE_INTEGER", "MIN_SAFE_INTEGER", "MAX_VALUE", "MIN_VALUE", "EPSILON"])

const numberStatics = new Set(["isInteger", "isFinite", "isNaN", "isSafeInteger", "parseInt", "parseFloat"])

const stringStatics = new Set(["fromCharCode", "fromCodePoint"])

const errorConstructors = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError"])

const OptionalShortCircuit: unique symbol = Symbol("rune.optional-short-circuit")

const supportedSyntaxMessage =
  "Supported orchestration syntax: tools.* calls, data literals, destructuring, optional chaining, template literals, conditionals, switch, loops, arrow functions, spread, try/catch, array methods (map/filter/find/findIndex/some/every/reduce/flatMap/forEach/sort/slice/concat/indexOf/lastIndexOf/at/flat/reverse/includes/join), string methods, Object/Math/JSON helpers, and Promise.all([tool calls]) or Promise.all(items.map((item) => tool call)) for parallel tool calls."

const unsupportedSyntax = (kind: string, node: AstNode): InterpreterRuntimeError =>
  new InterpreterRuntimeError(`Syntax '${kind}' is not supported in Rune. ${supportedSyntaxMessage}`, node, "UnsupportedSyntax", [supportedSyntaxMessage])

export const defaultExecutionLimits = (): ResolvedExecutionLimits => ({
  maxOperations: 100_000,
  maxToolCalls: 100,
  maxConcurrency: 8,
  maxSourceBytes: 32_000,
  maxDataBytes: 256_000,
  maxAuditBytes: 1_000_000,
  maxValueDepth: 32,
  maxCollectionLength: 10_000,
  timeoutMs: 10_000,
})

export const resolveExecutionLimits = (limits?: ExecutionLimits): ResolvedExecutionLimits => ({
  ...defaultExecutionLimits(),
  ...limits,
})

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
  const transpiled = transpileModule(`async function __rune__() {\n${code}\n}`, {
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

type Diagnostic = Extract<ExecuteResult, { ok: false }>['error']

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

  if (error instanceof CapabilityError) {
    return { kind: "CapabilityFailure", message: publicErrorMessage(error.message) }
  }

  if (error instanceof ProgramThrow) {
    const value = error.value
    let message: string
    if (containsRuntimeReference(value)) {
      // A thrown capability/function reference must not leak its internal structure.
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

// ── Built-in method/global implementations ───────────────────────────────────
// These mirror the corresponding JavaScript operations over Data Values. They are
// pure (string/Object/Math/JSON/coercion) and so live as free functions; array
// methods that run Rune callbacks live on the interpreter (they need invokeFunction).

const boundedData = (value: unknown, label: string, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  const copied = copyIn(value, label, limits)
  if (dataByteLength(copied) > limits.maxDataBytes) {
    throw new InterpreterRuntimeError(`${label} exceeds the maximum data size of ${limits.maxDataBytes} bytes.`, node, "InvalidDataValue")
  }
  return copied
}

const isRuntimeReference = (value: unknown): boolean =>
    value instanceof RuneFunction || value instanceof ToolReference || value instanceof IntrinsicReference ||
    value instanceof GlobalNamespace || value instanceof GlobalMethodReference || value instanceof PromiseNamespace ||
    value instanceof PromiseAllReference || value instanceof CoercionFunction ||
    value instanceof ConsoleReference || value instanceof ConsoleMethodReference

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
  if (isRuntimeReference(value)) return 0
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return dataByteLength(value)
  }
  if (typeof value !== "object") {
    throw new InterpreterRuntimeError(`${label} must contain data or Rune references only.`, node, "InvalidDataValue")
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
    case "replace": result = value.replace(str(0), str(1)); break
    case "replaceAll": {
      const search = str(0)
      const replacement = str(1)
      const growth = Math.max(0, byteLength(replacement) - byteLength(search))
      limitString(byteLength(value) + replacementCount(search) * growth)
      result = value.replaceAll(search, replacement)
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
    // JS charCodeAt returns NaN out of range, but Rune forbids NaN as a Data Value;
    // yield undefined instead, matching codePointAt and `at` (the other absent-slot sentinels).
    case "charCodeAt": { const code = value.charCodeAt(optNum(0) ?? 0); result = Number.isNaN(code) ? undefined : code; break }
    case "codePointAt": result = value.codePointAt(optNum(0) ?? 0); break
    case "toString": result = value; break
    case "concat": {
      const pieces = args.map((_, index) => str(index))
      limitString(byteLength(value) + pieces.reduce((size, piece) => size + byteLength(piece), 0))
      result = value.concat(...pieces)
      break
    }
    default: throw new InterpreterRuntimeError(`String method '${name}' is not available in Rune.`, node)
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
    default: throw new InterpreterRuntimeError(`Number method '${name}' is not available in Rune.`, node)
  }
  return boundedData(result, `Number.${name} result`, node, limits)
}

// JavaScript's String(...) without tripping over Rune's null-prototype data objects.
const coerceToString = (value: unknown): string => {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "object") {
    return Array.isArray(value)
      ? value.map((item) => (item === null || item === undefined ? "" : coerceToString(item))).join(",")
      : "[object Object]"
  }
  return String(value)
}

const coerceToNumber = (value: unknown): number =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? Number.NaN : Number(value)

const invokeCoercion = (ref: CoercionFunction, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
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
    if (isBlockedMember(key)) throw new InterpreterRuntimeError(`Property '${key}' is not available in Rune.`, node)
    out[key] = item
  }
  switch (name) {
    case "keys": return Object.keys(requireObject())
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
      const pairs = boundedData(args[0], "Object.fromEntries input", node, limits)
      if (!Array.isArray(pairs)) throw new InterpreterRuntimeError("Object.fromEntries expects an array of [key, value] pairs.", node)
      const out: Record<string, unknown> = Object.create(null)
      for (const pair of pairs) {
        if (!Array.isArray(pair)) throw new InterpreterRuntimeError("Object.fromEntries expects [key, value] pairs.", node)
        guardedSet(out, String(pair[0]), pair[1])
      }
      return out
    }
    default: throw new InterpreterRuntimeError(`Object.${name} is not available in Rune.`, node)
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
    default: throw new InterpreterRuntimeError(`Math.${name} is not available in Rune.`, node)
  }
}

const invokeJsonMethod = (name: string, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  switch (name) {
    case "stringify": {
      const replacer = args[1]
      if (Array.isArray(replacer) || replacer instanceof RuneFunction) {
        throw new InterpreterRuntimeError("JSON.stringify replacers are not supported in Rune.", node, "UnsupportedSyntax", [supportedSyntaxMessage])
      }
      const space = args[2]
      const indent = typeof space === "number" || typeof space === "string" ? space : undefined
      // copyIn first so only Data Values serialize — never a RuneFunction/ToolReference.
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
    default: throw new InterpreterRuntimeError(`JSON.${name} is not available in Rune.`, node)
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
          "Array.from(...) does not support a map function in Rune; call .map() on the result instead.",
          node,
          "UnsupportedSyntax",
          [supportedSyntaxMessage],
        )
      }
      const source = boundedData(args[0], "Array.from input", node, limits)
      if (typeof source === "string") return Array.from(source)
      if (Array.isArray(source)) return [...source]
      if (source !== null && typeof source === "object" && typeof (source as { length?: unknown }).length === "number") {
        return Array.from(source as ArrayLike<unknown>)
      }
      throw new InterpreterRuntimeError("Array.from expects an array, string, or array-like value.", node)
    }
    default:
      throw new InterpreterRuntimeError(`Array.${name} is not available in Rune.`, node)
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
    default: throw new InterpreterRuntimeError(`Number.${name} is not available in Rune.`, node)
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
    default: throw new InterpreterRuntimeError(`String.${name} is not available in Rune.`, node)
  }
}

const invokeGlobalMethod = (ref: GlobalMethodReference, args: Array<unknown>, node: AstNode, limits: ResolvedExecutionLimits): unknown => {
  if (ref.namespace === "Object") return invokeObjectMethod(ref.name, args, node, limits)
  if (ref.namespace === "Math") return invokeMathMethod(ref.name, args, node)
  if (ref.namespace === "Array") return invokeArrayStatic(ref.name, args, node, limits)
  if (ref.namespace === "Number") return invokeNumberStatic(ref.name, args, node)
  if (ref.namespace === "String") return invokeStringStatic(ref.name, args, node)
  return invokeJsonMethod(ref.name, args, node, limits)
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
  private readonly budget: { operations: number }
  // Shared by reference with any parallel forks (see forkForParallelCallback) so every
  // console.* line lands in one ordered collection regardless of which fork emitted it.
  private readonly logs: LogCollector
  private lastValue: unknown
  // Cached byte size (and, for objects, key count) of each live container, maintained incrementally
  // by the mutation helpers so appending in a loop is O(1)/op rather than re-walking the whole
  // container each time (which made push/index-assign/key-assign loops O(n^2) — a CPU DoS). These
  // are a fast path under the authoritative copyIn/copyOut boundary checks, never a replacement.
  private readonly containerSizes = new WeakMap<object, number>()
  private readonly objectCounts = new WeakMap<object, number>()

  constructor(
    limits: ResolvedExecutionLimits,
    invokeTool: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>,
    budget: { operations: number } = { operations: 0 },
    logs: LogCollector = new LogCollector(limits.maxAuditBytes),
  ) {
    const globalScope = new Map<string, Binding>()
    this.scopes = [globalScope]
    this.limits = limits
    this.invokeTool = invokeTool
    this.budget = budget
    this.logs = logs
    this.lastValue = undefined
    globalScope.set("tools", { mutable: false, value: new ToolReference([]) })
    globalScope.set("console", { mutable: false, value: new ConsoleReference() })
    globalScope.set("Promise", { mutable: false, value: new PromiseNamespace() })
    globalScope.set("undefined", { mutable: false, value: undefined })
    globalScope.set("Object", { mutable: false, value: new GlobalNamespace("Object") })
    globalScope.set("Math", { mutable: false, value: new GlobalNamespace("Math") })
    globalScope.set("JSON", { mutable: false, value: new GlobalNamespace("JSON") })
    globalScope.set("Number", { mutable: false, value: new CoercionFunction("Number") })
    globalScope.set("String", { mutable: false, value: new CoercionFunction("String") })
    globalScope.set("Boolean", { mutable: false, value: new CoercionFunction("Boolean") })
    globalScope.set("Array", { mutable: false, value: new GlobalNamespace("Array") })
    globalScope.set("parseInt", { mutable: false, value: new CoercionFunction("parseInt") })
    globalScope.set("parseFloat", { mutable: false, value: new CoercionFunction("parseFloat") })
  }

  run(program: ProgramNode): Effect.Effect<unknown, unknown, R> {
    const self = this
    // Run the program body in its own module scope on top of the builtin global scope, so
    // top-level declarations (`let undefined = 5`, `const Object = ...`) shadow builtins like
    // JS module scope, instead of colliding with the seeded globals.
    this.pushScope()
    return Effect.gen(function*() {
      self.hoistFunctions(program.body)
      for (const statement of program.body) {
        const result = yield* self.evaluateStatement(statement)

        if (result.kind === "return") {
          return result.value
        }

        if (result.kind === "break" || result.kind === "continue") {
          throw new InterpreterRuntimeError(`Unexpected '${result.kind}' outside of a loop.`, statement)
        }

        if (result.kind === "value") {
          self.lastValue = result.value
        }
      }

      return self.lastValue
    }).pipe(Effect.ensuring(Effect.sync(() => self.popScope())))
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

  private createFunction(node: AstNode): RuneFunction {
    if (node.generator === true) {
      throw new InterpreterRuntimeError("Generator functions are not supported in Rune.", node, "UnsupportedSyntax", [supportedSyntaxMessage])
    }
    return new RuneFunction(
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
      if (containsRuntimeReference(discriminant)) {
        throw new InterpreterRuntimeError("Switch discriminants must be data values in Rune.", node, "InvalidDataValue")
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
        if (containsRuntimeReference(candidate)) {
          throw new InterpreterRuntimeError("Switch case values must be data values in Rune.", test, "InvalidDataValue")
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

      if (!Array.isArray(right)) {
        throw new InterpreterRuntimeError("for...of requires an array value in Rune.", node)
      }

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

      for (const value of right) {
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

        const thrown = Cause.squash(cause)
        // The program sees a plain { message } error. Use the interpreter error's raw message so
        // the program never sees the transpiled-source "(line N, col N)" coordinates that
        // normalizeError appends — without disturbing a host/tool message that legitimately ends
        // that way. Other error kinds carry no appended location, so normalizeError is used as-is.
        const caught = thrown instanceof ProgramThrow
          ? thrown.value
          : Object.assign(Object.create(null) as SafeObject, {
              message: thrown instanceof InterpreterRuntimeError ? thrown.message : normalizeError(thrown).message,
            })
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
            throw new InterpreterRuntimeError(`Property '${key}' is not available in Rune.`, keyNode)
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
      case "Literal":
        return Effect.sync(() => boundedData(node.value, "Literal", node, this.limits))
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
        return this.evaluateExpression(getNode(node, "argument"))
      }
      case "NewExpression":
        return this.evaluateNewExpression(node)
      default:
        throw unsupportedSyntax(node.type, node)
    }
  }

  private evaluateNewExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const callee = getNode(node, "callee")
    if (callee.type !== "Identifier" || !errorConstructors.has(getString(callee, "name"))) {
      throw unsupportedSyntax("NewExpression", node)
    }
    const name = getString(callee, "name")
    const argNodes = getArray(node, "arguments")
    const self = this
    return Effect.gen(function*() {
      const arg = argNodes.length > 0 ? yield* self.evaluateExpression(asNode(argNodes[0], "arguments[0]")) : undefined
      const message = arg === undefined ? "" : coerceToString(arg)
      const errorValue: SafeObject = Object.create(null) as SafeObject
      errorValue.name = name
      errorValue.message = message
      return errorValue
    })
  }

  private evaluateBinaryExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    const self = this
    return Effect.gen(function*() {
      const lhs = (yield* self.evaluateExpression(getNode(node, "left"))) as any
      const rhs = (yield* self.evaluateExpression(getNode(node, "right"))) as any
      if (containsRuntimeReference(lhs) || containsRuntimeReference(rhs)) {
        throw new InterpreterRuntimeError("Binary operators require data values in Rune.", node, "InvalidDataValue")
      }
      // Data objects/arrays are null-prototype, so JS's ToPrimitive throws an opaque host
      // "No default value" TypeError when an operator coerces them. Coerce to their JS string
      // form first (as String(x) / template literals do) so operators behave like JavaScript.
      // Identity (=== / !==) and the right operand of `in` keep their raw object value.
      const coerceOperand = (operand: unknown): unknown =>
        operand !== null && typeof operand === "object" ? coerceToString(operand) : operand
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
    return Effect.map(this.evaluateExpression(getNode(node, "argument")), (value) => {
      if (containsRuntimeReference(value)) {
        throw new InterpreterRuntimeError("Unary operators require data values in Rune.", node, "InvalidDataValue")
      }
      const rhs = value as any
      // Numeric/bitwise unary operators ToPrimitive their operand; coerce null-prototype
      // data objects/arrays to their JS string form first (see evaluateBinaryExpression).
      // `!` and `typeof` operate on the raw value (no ToPrimitive, no crash).
      const operand =
        (operator === "+" || operator === "-" || operator === "~") && rhs !== null && typeof rhs === "object"
          ? (coerceToString(rhs) as any)
          : rhs
      let result: unknown
      switch (operator) {
        case "+": result = +operand; break
        case "-": result = -operand; break
        case "!": result = !rhs; break
        case "typeof": result = typeof rhs; break
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
      if (callable instanceof PromiseAllReference) {
        if (argNodes.length !== 1) {
          throw new InterpreterRuntimeError(`Promise.all expects exactly one collection expression. ${supportedSyntaxMessage}`, node)
        }
        const argument = asNode(argNodes[0], "arguments[0]")
        return yield* self.evaluatePromiseAll(argument, node)
      }

      const args = yield* self.evaluateCallArguments(argNodes)

      if (callable instanceof ToolReference) {
        if (callable.path.length === 0) throw new InterpreterRuntimeError("The tools root is not callable.", callee)
        return yield* self.invokeTool(callable.path, args)
      }
      if (callable instanceof RuneFunction) {
        return yield* self.invokeFunction(callable, args)
      }
      if (callable instanceof IntrinsicReference) {
        return yield* self.invokeIntrinsic(callable, args, node)
      }
      if (callable instanceof GlobalMethodReference) {
        const globalResult = invokeGlobalMethod(callable, args, node, self.limits)
        self.recordWork(workUnits(globalResult), node)
        return boundedData(globalResult, `${callable.namespace}.${callable.name} result`, node, self.limits)
      }
      if (callable instanceof CoercionFunction) {
        const coercionResult = invokeCoercion(callable, args, node, self.limits)
        self.recordWork(workUnits(coercionResult), node)
        return boundedData(coercionResult, `${callable.name} result`, node, self.limits)
      }
      if (callable instanceof ConsoleMethodReference) {
        const message = args.map(formatLogArg).join(" ")
        // Charge formatting to the operation budget so a console.log loop is bounded by
        // maxOperations, not just the wall-clock timeout.
        self.recordWork(message.length, node)
        self.logs.push(callable.level, message)
        return undefined
      }
      throw new InterpreterRuntimeError("Only tool capabilities are callable in Rune.", callee)
    })
  }

  private evaluateCallArguments(argNodes: Array<unknown>): Effect.Effect<Array<unknown>, unknown, R> {
    const self = this
    return Effect.gen(function*() {
      const args: Array<unknown> = []
      for (const [index, arg] of argNodes.entries()) {
        const argNode = asNode(arg, `arguments[${index}]`)
        if (argNode.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(getNode(argNode, "argument"))
          const items = Array.isArray(spread) ? spread : typeof spread === "string" ? Array.from(spread) : undefined
          if (items === undefined) throw new InterpreterRuntimeError("Spread arguments require an array or string in Rune.", argNode)
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

  private evaluatePromiseAll(argument: AstNode, node: AstNode): Effect.Effect<Array<unknown>, unknown, R> {
    if (argument.type === "ArrayExpression") {
      const elements = getArray(argument, "elements")
      if (elements.length > this.limits.maxCollectionLength) {
        throw new InterpreterRuntimeError(`Promise.all exceeds the maximum collection length of ${this.limits.maxCollectionLength}.`, node, "ConcurrencyLimitExceeded")
      }
      const calls = elements.map((value, index) => {
        if (value === null) {
          throw new InterpreterRuntimeError(`Promise.all array elements must be direct Tool Capability calls. ${supportedSyntaxMessage}`, argument)
        }
        const element = asNode(value, `elements[${index}]`)
        if (element.type === "SpreadElement") {
          throw new InterpreterRuntimeError(`Promise.all does not support spread elements yet. ${supportedSyntaxMessage}`, element)
        }
        if (!this.isToolCallExpression(element)) {
          throw new InterpreterRuntimeError(`Promise.all array elements must be direct Tool Capability calls. ${supportedSyntaxMessage}`, element)
        }
        return element.type === "AwaitExpression" ? getNode(element, "argument") : element
      })
      const self = this
      return Effect.gen(function*() {
        const prepared: Array<{ readonly path: ReadonlyArray<string>; readonly args: Array<unknown> }> = []
        for (const call of calls) {
          const callable = yield* self.evaluateExpression(getNode(call, "callee"))
          if (!(callable instanceof ToolReference) || callable.path.length === 0) {
            throw new InterpreterRuntimeError("Promise.all expects direct Tool Capability calls.", call)
          }
          const args = yield* self.evaluateCallArguments(getArray(call, "arguments"))
          prepared.push({ path: callable.path, args })
        }
        const values = yield* Effect.all(prepared.map(({ path, args }) => self.invokeTool(path, args)), { concurrency: self.limits.maxConcurrency })
        return boundedProgramValue(values, "Promise.all result", node, self.limits) as Array<unknown>
      })
    }

    if (argument.type === "CallExpression") {
      return this.evaluateParallelMap(argument, node)
    }

    throw new InterpreterRuntimeError(`Promise.all supports an array literal or a direct .map(...) expression. ${supportedSyntaxMessage}`, node)
  }

  private evaluateParallelMap(call: AstNode, node: AstNode): Effect.Effect<Array<unknown>, unknown, R> {
    const callee = getNode(call, "callee")
    const args = getArray(call, "arguments")
    if (callee.type !== "MemberExpression" || args.length !== 1) {
      throw new InterpreterRuntimeError(`Promise.all supports direct items.map((item) => tools.path(item)) expressions. ${supportedSyntaxMessage}`, node)
    }

    const self = this
    return Effect.gen(function*() {
      const method = yield* self.evaluateExpression(callee)
      const callback = yield* self.evaluateExpression(asNode(args[0], "arguments[0]"))
      if (!(method instanceof IntrinsicReference) || method.name !== "map" || !(callback instanceof RuneFunction)) {
        throw new InterpreterRuntimeError(`Promise.all supports direct items.map((item) => tools.path(item)) expressions. ${supportedSyntaxMessage}`, node)
      }
      if (!self.isToolCallExpression(callback.body)) {
        throw new InterpreterRuntimeError(`Promise.all mapped callbacks must directly call a Tool Capability. ${supportedSyntaxMessage}`, node)
      }
      const items = method.receiver as Array<unknown>
      if (items.length > self.limits.maxCollectionLength) {
        throw new InterpreterRuntimeError(`Promise.all exceeds the maximum collection length of ${self.limits.maxCollectionLength}.`, node, "ConcurrencyLimitExceeded")
      }

      const values = yield* Effect.all(
        items.map((item, index) => Effect.suspend(() => self.forkForParallelCallback().invokeFunction(callback, [item, index]))),
        { concurrency: self.limits.maxConcurrency },
      )
      return boundedProgramValue(values, "Promise.all result", node, self.limits) as Array<unknown>
    })
  }

  private isToolCallExpression(node: AstNode): boolean {
    const expression = node.type === "AwaitExpression" ? getNode(node, "argument") : node
    return expression.type === "CallExpression" && this.isToolPath(getNode(expression, "callee"))
  }

  private isToolPath(node: AstNode): boolean {
    if (node.type === "Identifier") return getString(node, "name") === "tools"
    return node.type === "MemberExpression" && this.isToolPath(getNode(node, "object"))
  }

  private invokeFunction(fn: RuneFunction, args: Array<unknown>): Effect.Effect<unknown, unknown, R> {
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
    throw new InterpreterRuntimeError(`Method '${ref.name}' is not available in Rune.`, node)
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
    if (!(callback instanceof RuneFunction)) {
      throw new InterpreterRuntimeError(`Array.${name} expects an arrow function callback.`, node)
    }
    const self = this
    return Effect.gen(function*() {
      // Iterate a snapshot taken at call time so a callback that mutates the array can't
      // self-extend the loop — matching JS, where elements appended during iteration are not visited.
      const items = target.slice()
      switch (name) {
        case "map": {
          const values: Array<unknown> = []
          for (const [index, item] of items.entries()) values.push(yield* self.invokeFunction(callback, [item, index, items]))
          return boundedCollection(values)
        }
        case "flatMap": {
          const values: Array<unknown> = []
          for (const [index, item] of items.entries()) {
            const mapped = yield* self.invokeFunction(callback, [item, index, items])
            if (Array.isArray(mapped)) values.push(...mapped)
            else values.push(mapped)
            boundedCollection(values)
          }
          return boundedCollection(values)
        }
        case "filter": {
          const values: Array<unknown> = []
          for (const [index, item] of items.entries()) {
            if (yield* self.invokeFunction(callback, [item, index, items])) values.push(item)
          }
          return boundedCollection(values)
        }
        case "find":
          for (const [index, item] of items.entries()) {
            if (yield* self.invokeFunction(callback, [item, index, items])) return item
          }
          return undefined
        case "findIndex":
          for (const [index, item] of items.entries()) {
            if (yield* self.invokeFunction(callback, [item, index, items])) return index
          }
          return -1
        case "some":
          for (const [index, item] of items.entries()) {
            if (yield* self.invokeFunction(callback, [item, index, items])) return true
          }
          return false
        case "every":
          for (const [index, item] of items.entries()) {
            if (!(yield* self.invokeFunction(callback, [item, index, items]))) return false
          }
          return true
        case "forEach":
          for (const [index, item] of items.entries()) yield* self.invokeFunction(callback, [item, index, items])
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
            accumulator = yield* self.invokeFunction(callback, [accumulator, items[index], index, items])
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
            accumulator = yield* self.invokeFunction(callback, [accumulator, items[index], index, items])
          }
          return accumulator
        }
        case "findLast":
          for (let index = items.length - 1; index >= 0; index -= 1) {
            if (yield* self.invokeFunction(callback, [items[index], index, items])) return items[index]
          }
          return undefined
        case "findLastIndex":
          for (let index = items.length - 1; index >= 0; index -= 1) {
            if (yield* self.invokeFunction(callback, [items[index], index, items])) return index
          }
          return -1
      }
      throw new InterpreterRuntimeError(`Array method '${name}' is not available in Rune.`, node)
    })
  }

  private sortArray(target: Array<unknown>, comparator: unknown, node: AstNode): Effect.Effect<Array<unknown>, unknown, R> {
    if (comparator !== undefined && !(comparator instanceof RuneFunction)) {
      throw new InterpreterRuntimeError("Array.sort expects an arrow function comparator.", node)
    }
    if (!(comparator instanceof RuneFunction)) {
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
          if (spread === null || typeof spread !== "object" || Array.isArray(spread) || isRuntimeReference(spread)) {
            throw new InterpreterRuntimeError("Object spread requires a data object in Rune.", property, "InvalidDataValue")
          }
          for (const [key, value] of Object.entries(spread)) {
            if (isBlockedMember(key)) throw new InterpreterRuntimeError(`Property '${key}' is not available in Rune.`, property)
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
          throw new InterpreterRuntimeError(`Property '${String(key)}' is not available in Rune.`, keyNode)
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
          const items = Array.isArray(spread) ? spread : typeof spread === "string" ? Array.from(spread) : undefined
          if (items === undefined) throw new InterpreterRuntimeError("Array spread requires an array or string in Rune.", element)
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
          const value = boundedData(yield* self.evaluateExpression(asNode(expressions[index], "expressions")), "Template interpolation", node, self.limits)
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

  private getMemberReference(node: AstNode): Effect.Effect<MemberReference | ToolReference | PromiseAllReference | IntrinsicReference | GlobalMethodReference | ConsoleMethodReference | ComputedValue | typeof OptionalShortCircuit | undefined, unknown, R> {
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
        if (key === "all") return new PromiseAllReference()
        throw new InterpreterRuntimeError(`Promise.${String(key)} is not available in Rune. Use Promise.all(...) for parallel Tool Capabilities.`, propertyNode)
      }

      if (objectValue instanceof ConsoleReference) {
        if (typeof key === "string" && consoleLevels.has(key as LogEntry["level"])) {
          return new ConsoleMethodReference(key as LogEntry["level"])
        }
        throw new InterpreterRuntimeError(`console.${String(key)} is not available in Rune. Use log, warn, error, info, or debug.`, propertyNode)
      }

      if (objectValue instanceof GlobalNamespace) {
        if (typeof key !== "string" || isBlockedMember(key)) {
          throw new InterpreterRuntimeError(`${objectValue.name}.${String(key)} is not available in Rune.`, propertyNode)
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
        throw new InterpreterRuntimeError(`String property '${String(key)}' is not available in Rune.`, propertyNode)
      }

      if (typeof objectValue === "number") {
        if (typeof key === "string" && numberMethods.has(key)) return new IntrinsicReference(objectValue, key)
        throw new InterpreterRuntimeError(`Number property '${String(key)}' is not available in Rune.`, propertyNode)
      }

      // Number / String expose a small allowlist of statics; everything else stays opaque.
      if (objectValue instanceof CoercionFunction && typeof key === "string" && !isBlockedMember(key)) {
        if (objectValue.name === "Number" && numberConstants.has(key)) {
          return new ComputedValue((Number as unknown as Record<string, number>)[key])
        }
        if (objectValue.name === "Number" && numberStatics.has(key)) return new GlobalMethodReference("Number", key)
        if (objectValue.name === "String" && stringStatics.has(key)) return new GlobalMethodReference("String", key)
      }

      if (isRuntimeReference(objectValue)) {
        throw new InterpreterRuntimeError("Rune runtime references are opaque and do not expose properties.", objectNode, "InvalidDataValue")
      }

      if (typeof objectValue !== "object" || objectValue === null) {
        throw new InterpreterRuntimeError("Cannot access a property on a non-object value.", objectNode)
      }

      if (typeof key === "string" && isBlockedMember(key)) {
        throw new InterpreterRuntimeError(`Property '${key}' is not available in Rune.`, propertyNode)
      }

      if (Array.isArray(objectValue)) {
        if (key !== "length" && !(typeof key === "string" && arrayMethods.has(key)) && (typeof key !== "number" && !/^\d+$/.test(key))) {
          if (typeof key === "string" && retryableArrayMethods.has(key)) {
            throw new InterpreterRuntimeError(
              `Array.${key}(...) is not supported in Rune. Rewrite using map/filter/find/some/every/includes/join or a for...of loop.`,
              propertyNode,
              "UnsupportedSyntax",
              [supportedSyntaxMessage],
            )
          }
          throw new InterpreterRuntimeError(`Array property '${String(key)}' is not available in Rune.`, propertyNode)
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
        reference instanceof PromiseAllReference ||
        reference instanceof IntrinsicReference ||
        reference instanceof GlobalMethodReference ||
        reference instanceof ConsoleMethodReference
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
        reference instanceof PromiseAllReference ||
        reference instanceof IntrinsicReference ||
        reference instanceof GlobalMethodReference ||
        reference instanceof ConsoleMethodReference
      ) {
        throw new InterpreterRuntimeError("Only data fields may be assigned in Rune.", node)
      }
      if (Array.isArray(reference.target)) {
        if (reference.key === "length") throw new InterpreterRuntimeError("Array length cannot be assigned in Rune.", node)
        if (typeof reference.key === "string" && arrayMethods.has(reference.key)) {
          throw new InterpreterRuntimeError("Array methods cannot be assigned in Rune.", node)
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

  private forkForParallelCallback(): Interpreter<R> {
    const fork = new Interpreter(this.limits, this.invokeTool, this.budget, this.logs)
    fork.scopes.splice(
      0,
      fork.scopes.length,
      ...this.scopes.map((scope) => new Map(Array.from(scope, ([name, binding]) => [name, { ...binding }]))),
    )
    return fork
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
 * Executes one Effect-native Rune Program without constructing a reusable runtime.
 *
 * @example
 * ```ts
 * const result = yield* Rune.execute({
 *   tools: { lookup },
 *   code: `return await tools.lookup({ id: "order_42" })`,
 * })
 * ```
 */
export const execute = <const Tools extends Record<string, unknown>>(options: ExecuteOptions<Tools>): Effect.Effect<ExecuteResult, never, Services<Tools>> => {
  const limits = resolveExecutionLimits(options.limits)
  ToolRuntime.assertValidTools((options.tools ?? {}) as HostTools<Services<Tools>>)
  const tools = ToolRuntime.make((options.tools ?? {}) as HostTools<Services<Tools>>, limits.maxToolCalls, limits)
  // Lives in the outer scope (not the interpreter) so console output is surfaced on every
  // result path, including timeout and failure where the interpreter instance is unreachable.
  const logs = new LogCollector(limits.maxAuditBytes)

  if (new TextEncoder().encode(options.code).byteLength > limits.maxSourceBytes) {
    return Effect.succeed({
      ok: false,
      error: { kind: "InvalidDataValue", message: `Code exceeds the maximum source size of ${limits.maxSourceBytes} bytes.` },
      toolCalls: tools.calls,
      logs: logs.entries,
    })
  }

  if (options.code.trim().length === 0) {
    return Effect.succeed({
      ok: false,
      error: { kind: "ParseError", message: "Code cannot be empty." },
      toolCalls: tools.calls,
      logs: logs.entries,
    })
  }

  const operation = Effect.gen(function*() {
    const program = parseProgram(options.code)
    const interpreter = new Interpreter<Services<Tools>>(limits, tools.invoke, undefined, logs)
    const value = yield* interpreter.run(program)
    const copied = copyIn(value, "Execution result", limits)
    if (dataByteLength(copied) > limits.maxDataBytes) {
      throw new InterpreterRuntimeError(`Execution result exceeds the maximum data size of ${limits.maxDataBytes} bytes.`, undefined, "InvalidDataValue")
    }
    return {
      ok: true,
      value: copyOut(copied),
      toolCalls: tools.calls,
      logs: logs.entries,
    } satisfies ExecuteResult
  }).pipe(
    Effect.timeoutOrElse({
      duration: limits.timeoutMs,
      orElse: () => Effect.succeed({
        ok: false,
        error: { kind: "TimeoutExceeded", message: `Execution timed out after ${limits.timeoutMs}ms.` },
        toolCalls: tools.calls,
        logs: logs.entries,
      } satisfies ExecuteResult),
    }),
  )

  return operation.pipe(
    Effect.matchCause({
      onFailure: (cause): ExecuteResult => ({
        ok: false,
        error: normalizeError(Cause.squash(cause)),
        toolCalls: tools.calls,
        logs: logs.entries,
      }),
      onSuccess: (result): ExecuteResult => result,
    }),
  )
}

/**
 * Creates an Effect-native runtime over explicit, schema-described capabilities.
 *
 * Use `run` for host-driven execution or `asTool` to expose one confined code tool to an
 * agent framework. Capability requirements remain in the returned Effect environment.
 *
 * @example
 * ```ts
 * const rune = Rune.make({ tools: { orders: { lookup } } })
 * const code = rune.asTool()
 * ```
 */
export const make = <const Tools extends Record<string, unknown> = {}>(options: RuneOptions<Tools> = {} as RuneOptions<Tools>): Rune<Services<Tools>> => {
  ToolRuntime.assertValidTools((options.tools ?? {}) as HostTools<Services<Tools>>)
  const run = (code: string) => execute<Tools>({ ...options, code })

  return {
    catalog: () => ToolRuntime.catalog((options.tools ?? {}) as HostTools<Services<Tools>>),
    instructions: () => ToolRuntime.instructions((options.tools ?? {}) as HostTools<Services<Tools>>),
    asTool: () => ({
      name: "code",
      description: ToolRuntime.instructions((options.tools ?? {}) as HostTools<Services<Tools>>),
      input: CodeInput,
      execute: ({ code }) => run(code),
    }),
    run,
  }
}

export const Rune = { make, execute }
