import { parse } from "acorn"
import { Cause, Effect, Exit, Fiber, Semaphore } from "effect"
import { DiagnosticCategory, ModuleKind, ScriptTarget, flattenDiagnosticMessageText, transpileModule } from "typescript"
import {
  copyIn,
  copyOut,
  isBlockedMember,
  ToolReference,
  ToolRuntime,
  ToolRuntimeError,
  type HostTools,
  type SafeObject,
  type Services,
} from "../tool-runtime.js"
import { ToolError } from "../tool-error.js"
import type {
  DataValue,
  Diagnostic,
  DiagnosticKind,
  ExecuteOptions,
  ResolvedExecutionLimits,
  Result,
} from "../codemode.js"
import {
  type AstNode,
  asNode,
  type Binding,
  CodeModeFunction,
  CoercionFunction,
  ComputedValue,
  ErrorConstructorReference,
  GlobalMethodReference,
  GlobalNamespace,
  type GlobalNamespaceName,
  formatLocation,
  getArray,
  getBoolean,
  getNode,
  getOptionalNode,
  getString,
  IntrinsicReference,
  InterpreterRuntimeError,
  isRecord,
  type MemberReference,
  OptionalShortCircuit,
  PromiseMethodReference,
  type PromiseMethodName,
  PromiseNamespace,
  ProgramThrow,
  type ProgramNode,
  type StatementResult,
  sourceLocation,
  supportedSyntaxMessage,
  unsupportedSyntax,
  UriFunction,
} from "./model.js"
import { arrayMethods, mapMethods, setMethods, spreadItems } from "../stdlib/collections.js"
import { consoleMethods, MAX_CONSOLE_DEPTH } from "../stdlib/console.js"
import { dateMethods, dateStatics, invokeDateMethod, invokeDateStatic } from "../stdlib/date.js"
import { invokeJsonMethod } from "../stdlib/json.js"
import { invokeMathMethod, mathConstants } from "../stdlib/math.js"
import {
  invokeNumberMethod,
  invokeNumberStatic,
  numberConstants,
  numberMethods,
  numberStatics,
} from "../stdlib/number.js"
import { invokeObjectMethod } from "../stdlib/object.js"
import { promiseStatics, TOOL_CALL_CONCURRENCY } from "../stdlib/promise.js"
import {
  escapeRegexHint,
  invokeRegExpMethod,
  matchToValue,
  regexpMethods,
  regexpProperties,
  regexFailureReason,
  toHostRegex,
} from "../stdlib/regexp.js"
import { invokeStringStatic, stringMethods, stringStatics } from "../stdlib/string.js"
import {
  urlMethods,
  urlProperties,
  urlSearchParamsMethods,
  urlStatics,
  urlWritableProperties,
  invokeUriFunction,
  invokeURLMethod,
  invokeURLStatic,
  uriArgument,
  urlArgument,
} from "../stdlib/url.js"
import {
  boundedData,
  coerceToNumber,
  coerceToString,
  compoundOperators,
  createErrorValue,
  errorBrandName,
  errorConstructors,
  invokeCoercion,
  valueConstructors,
} from "../stdlib/value.js"
import {
  isSandboxValue,
  SandboxDate,
  SandboxMap,
  SandboxPromise,
  SandboxRegExp,
  SandboxSet,
  SandboxURL,
  SandboxURLSearchParams,
} from "../values.js"

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
    } else if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { message?: unknown }).message === "string"
    ) {
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

// Shared by catch bindings, Promise.allSettled rejection reasons, and Promise.race losers.
const caughtErrorValue = (thrown: unknown): unknown => {
  if (thrown instanceof ProgramThrow) return thrown.value
  if (thrown instanceof InterpreterRuntimeError) return createErrorValue(thrown.errorName, thrown.message)
  const name = thrown instanceof Error && errorConstructors.has(thrown.name) ? thrown.name : "Error"
  return createErrorValue(name, normalizeError(thrown).message)
}

const isRuntimeReference = (value: unknown): boolean =>
  value instanceof CodeModeFunction ||
  value instanceof ToolReference ||
  value instanceof IntrinsicReference ||
  value instanceof GlobalNamespace ||
  value instanceof GlobalMethodReference ||
  value instanceof PromiseNamespace ||
  value instanceof PromiseMethodReference ||
  value instanceof SandboxPromise ||
  value instanceof CoercionFunction ||
  value instanceof UriFunction ||
  value instanceof ErrorConstructorReference ||
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

// Like containsRuntimeReference, but sandbox standard-library values count as data:
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
    value instanceof CodeModeFunction ||
    value instanceof CoercionFunction ||
    value instanceof IntrinsicReference ||
    value instanceof GlobalMethodReference ||
    value instanceof PromiseMethodReference ||
    value instanceof PromiseNamespace ||
    value instanceof ErrorConstructorReference
  )
    return "function"
  if (value instanceof UriFunction) return "function"
  if (value instanceof ToolReference) return value.path.length > 0 ? "function" : "object"
  if (value instanceof GlobalNamespace) {
    return value.name === "Math" || value.name === "JSON" || value.name === "console" ? "object" : "function"
  }
  return typeof value
}

// `x instanceof C` against the constructors CodeMode knows. Like `typeof`, it observes any
// left-hand value (opaque references included) without coercing it. Error checks use the
// error brand: `instanceof Error` accepts every branded error; a specific error type matches
// its own brand only (as in JS, where TypeError instances are also Error instances).
const instanceofValue = (lhs: unknown, rhs: unknown, node: AstNode): boolean => {
  if (rhs instanceof ErrorConstructorReference) {
    const brand = errorBrandName(lhs)
    return brand !== undefined && (rhs.name === "Error" || brand === rhs.name)
  }
  if (rhs instanceof GlobalNamespace) {
    switch (rhs.name) {
      case "Date":
        return lhs instanceof SandboxDate
      case "RegExp":
        return lhs instanceof SandboxRegExp
      case "Map":
        return lhs instanceof SandboxMap
      case "Set":
        return lhs instanceof SandboxSet
      case "URL":
        return lhs instanceof SandboxURL
      case "URLSearchParams":
        return lhs instanceof SandboxURLSearchParams
      case "Array":
        return Array.isArray(lhs)
      case "Object":
        return lhs !== null && (typeof lhs === "object" || typeofValue(lhs) === "function")
    }
  }
  if (rhs instanceof PromiseNamespace) return lhs instanceof SandboxPromise
  // Number/String/Boolean wrap primitives in JS; no boxed values exist in CodeMode, so
  // `x instanceof Number` is always false - exactly what it is for primitives in JS.
  if (rhs instanceof CoercionFunction && (rhs.name === "Number" || rhs.name === "String" || rhs.name === "Boolean")) {
    return false
  }
  throw new InterpreterRuntimeError(
    "The right-hand side of 'instanceof' must be a constructor CodeMode knows: Error (or a specific error type like TypeError), Date, RegExp, Map, Set, URL, URLSearchParams, Array, Object, or Promise.",
    node,
  )
}

const invokeStringMethod = (value: string, name: string, args: Array<unknown>, node: AstNode): unknown => {
  const str = (index: number): string => {
    const arg = args[index]
    if (typeof arg !== "string")
      throw new InterpreterRuntimeError(`String.${name} expects argument ${index + 1} to be a string.`, node)
    return arg
  }
  const num = (index: number): number => {
    const arg = args[index]
    if (typeof arg !== "number")
      throw new InterpreterRuntimeError(`String.${name} expects argument ${index + 1} to be a number.`, node)
    return arg
  }
  const optNum = (index: number): number | undefined => (args[index] === undefined ? undefined : num(index))
  const optStr = (index: number): string | undefined => (args[index] === undefined ? undefined : str(index))

  let result: unknown
  switch (name) {
    case "toLowerCase":
      result = value.toLowerCase()
      break
    case "toUpperCase":
      result = value.toUpperCase()
      break
    case "trim":
      result = value.trim()
      break
    // trimLeft/trimRight are the legacy aliases of trimStart/trimEnd, kept because models write them.
    case "trimStart":
    case "trimLeft":
      result = value.trimStart()
      break
    case "trimEnd":
    case "trimRight":
      result = value.trimEnd()
      break
    // Locale/options arguments are ignored: comparison runs with the host default locale, and
    // the common use is a sort comparator where any consistent order works.
    case "localeCompare":
      result = value.localeCompare(str(0))
      break
    case "normalize": {
      const form = optStr(0)
      try {
        result = value.normalize(form)
      } catch {
        throw new InterpreterRuntimeError(
          `String.normalize expects the form "NFC", "NFD", "NFKC", or "NFKD" (got ${JSON.stringify(form)}).`,
          node,
        ).as("RangeError")
      }
      break
    }
    case "split": {
      if (args.length === 0) {
        result = [value]
        break
      }
      if (args[0] instanceof SandboxRegExp) {
        result = value.split((args[0] as SandboxRegExp).regex, optNum(1))
        break
      }
      const requestedLimit = optNum(1)
      result = value.split(str(0), requestedLimit === undefined ? undefined : requestedLimit >>> 0)
      break
    }
    case "slice":
      result = value.slice(optNum(0), optNum(1))
      break
    case "includes":
      result = value.includes(str(0), optNum(1))
      break
    case "startsWith":
      result = value.startsWith(str(0), optNum(1))
      break
    case "endsWith":
      result = value.endsWith(str(0), optNum(1))
      break
    case "indexOf":
      result = value.indexOf(str(0), optNum(1))
      break
    case "lastIndexOf":
      result = value.lastIndexOf(str(0), optNum(1))
      break
    case "replace":
    case "replaceAll": {
      if (args[0] instanceof SandboxRegExp) {
        const pattern = (args[0] as SandboxRegExp).regex
        const replacement = str(1)
        if (name === "replaceAll" && !pattern.global) {
          throw new InterpreterRuntimeError(
            `String.replaceAll requires a regular expression with the global (g) flag: write /${pattern.source}/${pattern.flags}g, or use String.replace to replace only the first match.`,
            node,
          )
        }
        result = name === "replace" ? value.replace(pattern, replacement) : value.replaceAll(pattern, replacement)
        break
      }
      if (name === "replace") {
        result = value.replace(str(0), str(1))
        break
      }
      result = value.replaceAll(str(0), str(1))
      break
    }
    case "match": {
      const pattern = toHostRegex(args[0], name, node)
      const matched = value.match(pattern)
      if (matched === null) return null
      // A global match is a plain array of matched strings; a non-global match carries
      // index/groups own properties, so bypass the copying data checkpoint to keep them.
      if (pattern.global) return boundedData(matched, "String.match result")
      return matchToValue(matched)
    }
    case "matchAll": {
      const pattern = toHostRegex(args[0], name, node, "g")
      if (!pattern.global) {
        throw new InterpreterRuntimeError(
          `String.matchAll requires a regular expression with the global (g) flag: write /${pattern.source}/${pattern.flags}g, or use String.match for a single match.`,
          node,
        )
      }
      // Materialized as an array (not an iterator); each entry is a match array with
      // index/groups own properties. Match count is bounded by the subject length.
      return Array.from(value.matchAll(pattern), matchToValue)
    }
    case "search": {
      result = value.search(toHostRegex(args[0], name, node))
      break
    }
    case "repeat": {
      const count = num(0)
      if (!Number.isFinite(count) || count < 0)
        throw new InterpreterRuntimeError("String.repeat expects a finite non-negative count.", node)
      result = value.repeat(count)
      break
    }
    case "padStart":
      result = value.padStart(num(0), optStr(1))
      break
    case "padEnd":
      result = value.padEnd(num(0), optStr(1))
      break
    case "charAt":
      result = value.charAt(optNum(0) ?? 0)
      break
    case "at":
      result = value.at(optNum(0) ?? 0)
      break
    case "substring":
      result = value.substring(optNum(0) ?? 0, optNum(1))
      break
    case "substr":
      result = value.substr(optNum(0) ?? 0, optNum(1))
      break
    // JS charCodeAt returns NaN out of range; NaN flows as an ordinary in-sandbox value
    // (normalized to null only at the data boundary - see copyOut), so return it as-is.
    case "charCodeAt":
      result = value.charCodeAt(optNum(0) ?? 0)
      break
    case "codePointAt":
      result = value.codePointAt(optNum(0) ?? 0)
      break
    case "toString":
      result = value
      break
    case "concat": {
      result = value.concat(...args.map((_, index) => str(index)))
      break
    }
    default:
      throw new InterpreterRuntimeError(`String method '${name}' is not available in CodeMode.`, node)
  }
  return boundedData(result, `String.${name} result`)
}

const invokeArrayStatic = (name: string, args: Array<unknown>, node: AstNode): unknown => {
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
      if (args[0] instanceof SandboxMap)
        return Array.from((args[0] as SandboxMap).map.entries(), ([key, item]) => [key, item])
      if (args[0] instanceof SandboxSet) return Array.from((args[0] as SandboxSet).set.values())
      if (args[0] instanceof SandboxURLSearchParams) {
        return Array.from(args[0].params.entries(), ([key, value]) => [key, value])
      }
      const source = boundedData(args[0], "Array.from input")
      if (typeof source === "string") return Array.from(source)
      if (Array.isArray(source)) return [...source]
      if (
        source !== null &&
        typeof source === "object" &&
        typeof (source as { length?: unknown }).length === "number"
      ) {
        return Array.from(source as ArrayLike<unknown>)
      }
      throw new InterpreterRuntimeError("Array.from expects an array, string, Map, Set, or array-like value.", node)
    }
    default:
      throw new InterpreterRuntimeError(`Array.${name} is not available in CodeMode.`, node)
  }
}

const invokeGlobalMethod = (ref: GlobalMethodReference, args: Array<unknown>, node: AstNode): unknown => {
  if (ref.namespace === "console")
    throw new InterpreterRuntimeError(`console.${ref.name} is not available in CodeMode.`, node)
  if (ref.namespace === "Object") return invokeObjectMethod(ref.name, args, node)
  if (ref.namespace === "Math") return invokeMathMethod(ref.name, args, node)
  if (ref.namespace === "Array") return invokeArrayStatic(ref.name, args, node)
  if (ref.namespace === "Number") return invokeNumberStatic(ref.name, args, node)
  if (ref.namespace === "String") return invokeStringStatic(ref.name, args, node)
  if (ref.namespace === "URL") return invokeURLStatic(ref.name, args, node)
  if (ref.namespace === "Date") {
    if (!dateStatics.has(ref.name))
      throw new InterpreterRuntimeError(`Date.${ref.name} is not available in CodeMode.`, node)
    return invokeDateStatic(ref.name, args, node)
  }
  if (
    ref.namespace === "RegExp" ||
    ref.namespace === "Map" ||
    ref.namespace === "Set" ||
    ref.namespace === "URLSearchParams"
  ) {
    throw new InterpreterRuntimeError(`${ref.namespace}.${ref.name} is not available in CodeMode.`, node)
  }
  return invokeJsonMethod(ref.name, args, node)
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
  private readonly invokeTool: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
  // Enumerable namespace/tool names at a node of the host tool tree, threaded from
  // ToolRuntime.make like invokeTool: the interpreter never holds the tree itself.
  private readonly toolKeys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
  private readonly logs: Array<string>
  private lastValue: unknown
  // Caps how many eagerly forked tool calls run at once (the parallel-call concurrency cap).
  private readonly callPermits: Semaphore.Semaphore
  // Fiber-backed promises whose settlement no program construct has observed yet. Successful
  // program completion drains these (like a runtime waiting on in-flight work at exit) and
  // surfaces a never-awaited failure as an unhandled-rejection diagnostic.
  private readonly pendingSettlements = new Set<SandboxPromise>()

  constructor(
    invokeTool: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>,
    toolKeys: (path: ReadonlyArray<string>) => ReadonlyArray<string>,
    logs: Array<string> = [],
  ) {
    const globalScope = new Map<string, Binding>()
    this.scopes = [globalScope]
    this.invokeTool = invokeTool
    this.toolKeys = toolKeys
    this.logs = logs
    this.lastValue = undefined
    this.callPermits = Semaphore.makeUnsafe(TOOL_CALL_CONCURRENCY)
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
    globalScope.set("URL", { mutable: false, value: new GlobalNamespace("URL") })
    globalScope.set("URLSearchParams", { mutable: false, value: new GlobalNamespace("URLSearchParams") })
    globalScope.set("encodeURI", { mutable: false, value: new UriFunction("encodeURI") })
    globalScope.set("encodeURIComponent", { mutable: false, value: new UriFunction("encodeURIComponent") })
    globalScope.set("decodeURI", { mutable: false, value: new UriFunction("decodeURI") })
    globalScope.set("decodeURIComponent", { mutable: false, value: new UriFunction("decodeURIComponent") })
    // Error constructors are real values, so `x instanceof Error` works and `Error("msg")`
    // (with or without `new`) constructs a branded { name, message } error object.
    for (const name of errorConstructors) {
      globalScope.set(name, { mutable: false, value: new ErrorConstructorReference(name) })
    }
    // NaN/Infinity flow as ordinary in-sandbox values (normalized to null only at the data
    // boundary - see copyOut), so their global bindings must exist too, e.g. `reduce(max, -Infinity)`.
    globalScope.set("NaN", { mutable: false, value: NaN })
    globalScope.set("Infinity", { mutable: false, value: Infinity })
  }

  run(program: ProgramNode): Effect.Effect<unknown, unknown, R> {
    const self = this
    // Run the program body in its own module scope on top of the builtin global scope, so
    // top-level declarations (`let undefined = 5`, `const Object = ...`) shadow builtins like
    // JS module scope, instead of colliding with the seeded globals.
    this.pushScope()
    return Effect.gen(function* () {
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
      // resolves before crossing the data boundary - `return tools.ns.tool(...)` works
      // without an explicit await, exactly as in JS.
      if (value instanceof SandboxPromise) value = yield* self.settlePromise(value)
      yield* self.drainPendingSettlements()
      return value
    }).pipe(Effect.ensuring(Effect.sync(() => self.popScope())))
  }

  // Awaits every fiber-backed promise the program abandoned (fire-and-forget tool calls), so
  // their work completes before the execution ends - mirroring a JS runtime waiting on
  // in-flight I/O at exit. A failure nobody could have handled becomes an unhandled-rejection
  // diagnostic (interrupted calls, e.g. Promise.race losers, are ignored).
  private drainPendingSettlements(): Effect.Effect<void, unknown, never> {
    const self = this
    return Effect.gen(function* () {
      for (const promise of [...self.pendingSettlements]) {
        const exit = yield* self.observePromise(promise)
        if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) continue
        const failure = normalizeError(Cause.squash(exit.cause))
        throw new InterpreterRuntimeError(
          `Unhandled rejection from an un-awaited tool call: ${failure.message}`,
          undefined,
          failure.kind,
          ["Await tool calls - `const result = await tools.ns.tool(...)` - so failures can be caught and handled."],
        )
      }
    })
  }

  // Eagerly starts a tool call on a supervised child fiber (so the execution timeout and
  // scope teardown interrupt it) gated by the concurrency semaphore, and wraps the fiber in a
  // first-class promise value. `startImmediately` makes the runtime admit the call - charging
  // the tool-call budget and firing onToolCallStart - at the call site, before any await.
  private createToolCallPromise(
    path: ReadonlyArray<string>,
    args: Array<unknown>,
  ): Effect.Effect<SandboxPromise, never, R> {
    const self = this
    return Effect.map(
      Effect.forkChild(this.callPermits.withPermit(Effect.suspend(() => self.invokeTool(path, args))), {
        startImmediately: true,
      }),
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

  private unwrapPromiseExit(
    promise: SandboxPromise | undefined,
    exit: Exit.Exit<unknown, unknown>,
    node?: AstNode,
  ): Effect.Effect<unknown, unknown> {
    if (Exit.isSuccess(exit)) return Effect.succeed(exit.value)
    // A call Promise.race interrupted after losing settles as a catchable program failure;
    // any other interruption is execution teardown (timeout/host) and must keep propagating
    // as interruption rather than becoming program-visible data.
    if (promise?.interrupted === true && Cause.hasInterruptsOnly(exit.cause)) {
      return Effect.fail(
        new InterpreterRuntimeError(
          "This tool call was interrupted because another value settled a Promise.race first.",
          node,
        ),
      )
    }
    return Effect.failCause(exit.cause)
  }

  private evaluateStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
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
    return Effect.gen(function* () {
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
      throw new InterpreterRuntimeError(
        "Generator functions are not supported in CodeMode.",
        node,
        "UnsupportedSyntax",
        [supportedSyntaxMessage],
      )
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
      test
        ? this.evaluateStatement(consequentNode)
        : alternateNode
          ? this.evaluateStatement(alternateNode)
          : Effect.succeed({ kind: "none" }),
    )
  }

  private evaluateSwitchStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const self = this
    this.pushScope()
    return Effect.gen(function* () {
      const discriminant = yield* self.evaluateExpression(getNode(node, "discriminant"))
      if (containsOpaqueReference(discriminant)) {
        throw new InterpreterRuntimeError(
          "Switch discriminants must be data values in CodeMode.",
          node,
          "InvalidDataValue",
        )
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
          throw new InterpreterRuntimeError(
            "Switch case values must be data values in CodeMode.",
            test,
            "InvalidDataValue",
          )
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
    return Effect.gen(function* () {
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
    return Effect.gen(function* () {
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
    return Effect.gen(function* () {
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

      const perIterationBindings =
        initNode?.type === "VariableDeclaration" && getString(initNode, "kind") !== "var"
          ? Array.from(self.currentScope().keys())
          : []

      while (testNode ? yield* self.evaluateExpression(testNode) : true) {
        let iterationScope: Map<string, Binding> | undefined
        if (perIterationBindings.length > 0) {
          iterationScope = new Map(
            perIterationBindings.map((name) => {
              const binding = self.currentScope().get(name)!
              return [name, { ...binding }]
            }),
          )
          self.scopes.push(iterationScope)
        }
        const result = yield* self.evaluateStatement(bodyNode).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (iterationScope) self.popScope()
            }),
          ),
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
    return Effect.gen(function* () {
      const left = getNode(node, "left")
      const right = yield* self.evaluateExpression(getNode(node, "right"))
      const body = getNode(node, "body")

      // Arrays iterate in place; strings iterate code points; Maps iterate [key, value]
      // pairs and Sets iterate values over a snapshot (mutation during iteration is safe).
      const iterable = Array.isArray(right) ? right : spreadItems(right)
      if (iterable === undefined) {
        throw new InterpreterRuntimeError("for...of requires an array, string, Map, or Set value in CodeMode.", node)
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

      for (const value of iterable) {
        if (declaration) {
          self.pushScope()
          yield* self.declarePattern(declaration.pattern, value, declaration.mutable, left)
        } else if (assignmentName) {
          self.setIdentifierValue(assignmentName, value, left)
        }

        const result = yield* self.evaluateStatement(body).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (declaration) self.popScope()
            }),
          ),
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
  // any own non-index properties, e.g. match results' index/groups - exactly Object.keys in
  // JS), and a tool reference the namespace/tool names at its path in the host tool tree.
  // Returns undefined for everything else so callers can raise a contextual error.
  private enumerableKeys(value: unknown): Array<string> | undefined {
    if (value instanceof ToolReference) {
      return [...this.toolKeys(value.path)]
    }
    if (Array.isArray(value)) {
      return Object.keys(value)
    }
    if (value !== null && typeof value === "object" && !isRuntimeReference(value)) {
      return Object.keys(value)
    }
    return undefined
  }

  private evaluateForInStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const left = getNode(node, "left")
      const right = yield* self.evaluateExpression(getNode(node, "right"))
      const body = getNode(node, "body")

      // Keys are snapshotted up front (mutation during iteration is safe): plain objects
      // enumerate their own keys, arrays their index strings, and tool references the
      // namespace/tool names at that node - the same enumeration Object.keys performs.
      // Anything else (strings, Maps, Sets, numbers, null, ...) is a deliberate error rather
      // than real JS's surprising behavior (indices for strings, zero iterations for
      // Maps/Sets/null): the hint points at the constructs that do what the program means.
      const keys = self.enumerableKeys(right)
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
          Effect.ensuring(
            Effect.sync(() => {
              if (declaration) self.popScope()
            }),
          ),
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

        // The program sees a plain { message } error (or the thrown value itself) - see
        // caughtErrorValue, shared with Promise.allSettled rejection reasons.
        const caught = caughtErrorValue(Cause.squash(cause))
        const parameter = getOptionalNode(handler, "param")
        self.pushScope()
        return Effect.gen(function* () {
          if (parameter) yield* self.declarePattern(parameter, caught, true, handler)
          return yield* self.evaluateStatement(getNode(handler, "body"))
        }).pipe(Effect.ensuring(Effect.sync(() => self.popScope())))
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
              isAbrupt(final) ? Effect.succeed(final) : Effect.failCause(cause),
            ),
      onSuccess: (result) =>
        Effect.flatMap(this.evaluateStatement(finalizer), (final) =>
          isAbrupt(final) ? Effect.succeed(final) : Effect.succeed(result),
        ),
    })
  }

  private evaluateVariableDeclaration(node: AstNode): Effect.Effect<void, unknown, R> {
    const kind = getString(node, "kind")
    const declarations = getArray(node, "declarations")
    const self = this
    return Effect.gen(function* () {
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

  private declarePattern(
    pattern: AstNode,
    value: unknown,
    mutable: boolean,
    node: AstNode,
  ): Effect.Effect<void, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      if (pattern.type === "Identifier") {
        self.declare(getString(pattern, "name"), value, mutable, node)
        return
      }

      // Default values: `x = expr` / `{ a = 1 }` - the default is evaluated only when the value is undefined.
      if (pattern.type === "AssignmentPattern") {
        const resolved = value === undefined ? yield* self.evaluateExpression(getNode(pattern, "right")) : value
        yield* self.declarePattern(getNode(pattern, "left"), resolved, mutable, node)
        return
      }

      if (pattern.type === "ObjectPattern") {
        if (value === null || typeof value !== "object" || Array.isArray(value) || isRuntimeReference(value)) {
          throw new InterpreterRuntimeError(
            "Object destructuring requires a data object value.",
            pattern,
            "InvalidDataValue",
          )
        }

        const consumed = new Set<string>()
        for (const propertyValue of getArray(pattern, "properties")) {
          const property = asNode(propertyValue, "properties")

          // Object rest: `{ a, ...others }` - gather the not-yet-consumed own keys.
          if (property.type === "RestElement") {
            const rest: SafeObject = Object.create(null) as SafeObject
            for (const [key, item] of Object.entries(value as SafeObject)) {
              if (!consumed.has(key) && !isBlockedMember(key)) rest[key] = item
            }
            yield* self.declarePattern(getNode(property, "argument"), rest, mutable, property)
            continue
          }

          if (
            property.type !== "Property" ||
            getBoolean(property, "computed") ||
            getString(property, "kind") !== "init"
          ) {
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
          // Array rest: `[head, ...tail]` - binds the remaining elements (must be last).
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

  private assignPattern(pattern: AstNode, value: unknown, node: AstNode): Effect.Effect<void, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      if (pattern.type === "Identifier") {
        self.setIdentifierValue(getString(pattern, "name"), value, pattern)
        return
      }

      if (pattern.type === "MemberExpression") {
        yield* self.writeMember(pattern, value)
        return
      }

      if (pattern.type === "AssignmentPattern") {
        const resolved = value === undefined ? yield* self.evaluateExpression(getNode(pattern, "right")) : value
        yield* self.assignPattern(getNode(pattern, "left"), resolved, node)
        return
      }

      if (pattern.type === "ObjectPattern") {
        if (value === null || typeof value !== "object" || Array.isArray(value) || isRuntimeReference(value)) {
          throw new InterpreterRuntimeError(
            "Object destructuring requires a data object value.",
            pattern,
            "InvalidDataValue",
          )
        }

        const source = value as SafeObject
        const consumed = new Set<string>()
        for (const propertyValue of getArray(pattern, "properties")) {
          const property = asNode(propertyValue, "properties")
          if (property.type === "RestElement") {
            const rest: SafeObject = Object.create(null) as SafeObject
            for (const [key, item] of Object.entries(source)) {
              if (!consumed.has(key) && !isBlockedMember(key)) rest[key] = item
            }
            yield* self.assignPattern(getNode(property, "argument"), rest, property)
            continue
          }
          if (
            property.type !== "Property" ||
            getBoolean(property, "computed") ||
            getString(property, "kind") !== "init"
          ) {
            throw new InterpreterRuntimeError("Only named object destructuring properties are supported.", property)
          }
          const keyNode = getNode(property, "key")
          const key = keyNode.type === "Identifier" ? getString(keyNode, "name") : String(keyNode.value)
          if (isBlockedMember(key)) {
            throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, keyNode)
          }
          consumed.add(key)
          yield* self.assignPattern(getNode(property, "value"), source[key], property)
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
          if (element.type === "RestElement") {
            yield* self.assignPattern(getNode(element, "argument"), value.slice(index), element)
            break
          }
          yield* self.assignPattern(element, value[index], pattern)
        }
        return
      }

      throw new InterpreterRuntimeError(`Unsupported assignment pattern '${pattern.type}'.`, node)
    })
  }

  private evaluateExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    switch (node.type) {
      case "Literal": {
        // A regex literal parses as a Literal node carrying { pattern, flags }; construct the
        // sandbox regex from those (the host `value` instance is never exposed).
        const regex = node.regex
        if (isRecord(regex) && typeof regex.pattern === "string") {
          return Effect.sync(() =>
            this.constructRegExp([regex.pattern, typeof regex.flags === "string" ? regex.flags : ""], node),
          )
        }
        return Effect.sync(() => boundedData(node.value, "Literal"))
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
          value === OptionalShortCircuit ? undefined : value,
        )
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
          value instanceof SandboxPromise ? self.settlePromise(value, node) : Effect.succeed(value),
        )
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
        "new Promise(...) is not supported in CodeMode; tool calls already return promises - call the tool and await the result.",
        node,
        "UnsupportedSyntax",
        [supportedSyntaxMessage],
      )
    }
    if (errorConstructors.has(name)) {
      return Effect.gen(function* () {
        const arg =
          argNodes.length > 0 ? yield* self.evaluateExpression(asNode(argNodes[0], "arguments[0]")) : undefined
        return createErrorValue(name, arg === undefined ? "" : coerceToString(arg))
      })
    }
    if (valueConstructors.has(name)) {
      return Effect.gen(function* () {
        const args = yield* self.evaluateCallArguments(argNodes)
        switch (name) {
          case "Date":
            return self.constructDate(args)
          case "RegExp":
            return self.constructRegExp(args, node)
          case "Map":
            return self.constructMap(args[0], node)
          case "Set":
            return self.constructSet(args[0], node)
          case "URL":
            return self.constructURL(args, node)
          default:
            return self.constructURLSearchParams(args[0], node)
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
    // new Date(year, month, day?, hours?, ...) - local-time component form.
    const parts = args.map((arg) => coerceToNumber(arg))
    return new SandboxDate(new Date(...(parts as [number, number])).getTime())
  }

  private constructRegExp(args: Array<unknown>, node: AstNode): SandboxRegExp {
    const first = args[0]
    const pattern =
      first instanceof SandboxRegExp ? first.regex.source : first === undefined ? "" : coerceToString(first)
    const flagsArg = args[1]
    if (flagsArg !== undefined && typeof flagsArg !== "string") {
      throw new InterpreterRuntimeError(
        `RegExp flags must be a string of flag characters (e.g. "g", "gi"), not ${flagsArg === null ? "null" : typeof flagsArg}.`,
        node,
      )
    }
    const flags = flagsArg ?? (first instanceof SandboxRegExp ? first.regex.flags : "")
    try {
      return new SandboxRegExp(pattern, flags)
    } catch (error) {
      // Say which part was rejected and how to fix it, instead of passing the engine
      // message through bare. A flags failure names the flags; a pattern failure gets the
      // escaping hint (the usual cause is an unescaped metacharacter in a built-up string).
      const reason = regexFailureReason(error)
      throw new InterpreterRuntimeError(
        /flag/i.test(reason)
          ? `new RegExp(...) received invalid flags ${JSON.stringify(flags)} (${reason}). Valid flags are d, g, i, m, s, u, v, and y.`
          : `new RegExp(...) received ${JSON.stringify(pattern)}, which is not a valid regular expression pattern (${reason}). ${escapeRegexHint}`,
        node,
      ).as("SyntaxError")
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
      throw new InterpreterRuntimeError(
        "new Map(...) expects an array of [key, value] pairs, a Map, or no argument.",
        node,
      )
    }
    for (const pair of entries) {
      if (!Array.isArray(pair)) {
        throw new InterpreterRuntimeError("new Map(...) expects [key, value] pairs.", node)
      }
      target.map.set(pair[0], pair[1])
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
    for (const item of items) target.set.add(item)
    return target
  }

  private constructURL(args: Array<unknown>, node: AstNode): SandboxURL {
    if (args.length === 0) {
      throw new InterpreterRuntimeError("new URL(...) requires a URL string and an optional base URL.", node).as(
        "TypeError",
      )
    }
    const input = urlArgument(args[0], "new URL input")
    const base = args[1] === undefined ? undefined : urlArgument(args[1], "new URL base")
    try {
      return new SandboxURL(new URL(input, base))
    } catch {
      throw new InterpreterRuntimeError(
        `new URL(...) received an invalid URL${base === undefined ? "" : " or base URL"}.`,
        node,
      ).as("TypeError")
    }
  }

  private constructURLSearchParams(init: unknown, node: AstNode): SandboxURLSearchParams {
    if (init === undefined) return new SandboxURLSearchParams(new URLSearchParams())
    if (init instanceof SandboxURLSearchParams) {
      return new SandboxURLSearchParams(new URLSearchParams(init.params))
    }
    if (typeof init === "string") return new SandboxURLSearchParams(new URLSearchParams(init))
    if (init === null || typeof init === "number" || typeof init === "boolean") {
      return new SandboxURLSearchParams(new URLSearchParams(coerceToString(init)))
    }
    if (init instanceof SandboxMap) {
      return this.constructURLSearchParams(
        Array.from(init.map.entries(), ([key, value]) => [key, value]),
        node,
      )
    }
    if (Array.isArray(init)) {
      const entries = init.map((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2) {
          throw new InterpreterRuntimeError(
            "new URLSearchParams(...) expects an array of [name, value] pairs.",
            node,
          ).as("TypeError")
        }
        return [uriArgument(pair[0], "URLSearchParams name"), uriArgument(pair[1], "URLSearchParams value")] as [
          string,
          string,
        ]
      })
      return new SandboxURLSearchParams(new URLSearchParams(entries))
    }
    if (isSandboxValue(init)) return new SandboxURLSearchParams(new URLSearchParams())
    const data = boundedData(init, "new URLSearchParams input")
    if (data === null || typeof data !== "object") {
      throw new InterpreterRuntimeError(
        "new URLSearchParams(...) expects a query string, data object, array of pairs, or URLSearchParams.",
        node,
      ).as("TypeError")
    }
    return new SandboxURLSearchParams(
      new URLSearchParams(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, coerceToString(value)]))),
    )
  }

  private evaluateBinaryExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    const self = this
    return Effect.gen(function* () {
      const lhs = yield* self.evaluateExpression(getNode(node, "left"))
      const rhs = yield* self.evaluateExpression(getNode(node, "right"))
      // Like `typeof`, `instanceof` observes any value without coercing it (a promise or
      // function operand is a legitimate question, not an error), so it is handled before
      // the data-only operand check.
      if (operator === "instanceof") return instanceofValue(lhs, rhs, node)
      return boundedData(self.applyBinaryOperator(operator, lhs, rhs, node), "Binary expression result")
    })
  }

  /**
   * Applies a binary operator to two already-evaluated operands with CodeMode's coercion
   * semantics. Shared by binary expressions and compound assignment (`x op= y` must behave
   * exactly like `x = x op y`, coercion included).
   */
  private applyBinaryOperator(operator: string, lhs: unknown, rhs: unknown, node: AstNode): unknown {
    if (containsOpaqueReference(lhs) || containsOpaqueReference(rhs)) {
      throw new InterpreterRuntimeError("Binary operators require data values in CodeMode.", node, "InvalidDataValue")
    }
    // Data objects/arrays are null-prototype, so JS's ToPrimitive throws an opaque host
    // "No default value" TypeError when an operator coerces them. Coerce to their JS string
    // form first (as String(x) / template literals do) so operators behave like JavaScript.
    // A Date follows its ToPrimitive hints: string for `+` (concatenation), its time value
    // for arithmetic and ordering - so `end - start` and `a < b` work as in JS.
    // Identity (=== / !==) and the right operand of `in` keep their raw object value.
    const coerceOperand = (operand: unknown): unknown => {
      if (operand instanceof SandboxDate) return operator === "+" ? coerceToString(operand) : operand.time
      return operand !== null && typeof operand === "object" ? coerceToString(operand) : operand
    }
    const bothObjects = lhs !== null && typeof lhs === "object" && rhs !== null && typeof rhs === "object"
    const l = coerceOperand(lhs)
    const r = coerceOperand(rhs)
    switch (operator) {
      case "+":
        return (l as string) + (r as string)
      case "-":
        return (l as number) - (r as number)
      case "*":
        return (l as number) * (r as number)
      case "/":
        return (l as number) / (r as number)
      case "%":
        return (l as number) % (r as number)
      case "**":
        return (l as number) ** (r as number)
      // Two objects compare by identity in JS (no ToPrimitive); only object-vs-primitive coerces.
      case "==":
        return bothObjects ? lhs === rhs : l == r
      case "===":
        return lhs === rhs
      case "!=":
        return bothObjects ? lhs !== rhs : l != r
      case "!==":
        return lhs !== rhs
      case "<":
        return (l as string) < (r as string)
      case "<=":
        return (l as string) <= (r as string)
      case ">":
        return (l as string) > (r as string)
      case ">=":
        return (l as string) >= (r as string)
      case "&":
        return (l as number) & (r as number)
      case "|":
        return (l as number) | (r as number)
      case "^":
        return (l as number) ^ (r as number)
      case "<<":
        return (l as number) << (r as number)
      case ">>":
        return (l as number) >> (r as number)
      case ">>>":
        return (l as number) >>> (r as number)
      case "in":
        if (rhs === null || typeof rhs !== "object") {
          throw new InterpreterRuntimeError("The 'in' operator requires a data object on the right-hand side.", node)
        }
        // Own properties only, so arrays don't leak the host Array.prototype (map/constructor/...).
        return Object.hasOwn(rhs as object, coerceOperand(lhs) as PropertyKey)
      default:
        throw new InterpreterRuntimeError(`Unsupported binary operator '${operator}'.`, node)
    }
  }

  private evaluateLogicalExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    return Effect.flatMap(this.evaluateExpression(getNode(node, "left")), (left) => {
      if (operator === "&&") return left ? this.evaluateExpression(getNode(node, "right")) : Effect.succeed(left)
      if (operator === "||") return left ? Effect.succeed(left) : this.evaluateExpression(getNode(node, "right"))
      if (operator === "??")
        return left !== null && left !== undefined
          ? Effect.succeed(left)
          : this.evaluateExpression(getNode(node, "right"))
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
      // `typeof` and `!` never throw in JS - they observe any value (functions and runtime
      // references included) without coercing it, so feature detection and negation work.
      if (operator === "typeof") return typeofValue(value)
      if (operator === "!") return !value
      if (containsOpaqueReference(value)) {
        throw new InterpreterRuntimeError("Unary operators require data values in CodeMode.", node, "InvalidDataValue")
      }
      // Numeric/bitwise unary operators ToPrimitive their operand; a Date yields its time value
      // (`+date` is the epoch-ms idiom), other null-prototype data objects/arrays coerce to
      // their JS string form first (see evaluateBinaryExpression).
      const operand =
        value instanceof SandboxDate
          ? value.time
          : value !== null && typeof value === "object"
            ? coerceToString(value)
            : value
      let result: unknown
      switch (operator) {
        case "+":
          result = +(operand as number)
          break
        case "-":
          result = -(operand as number)
          break
        case "~":
          result = ~(operand as number)
          break
        default:
          throw new InterpreterRuntimeError(`Unsupported unary operator '${operator}'.`, node)
      }
      return boundedData(result, "Unary expression result")
    })
  }

  private evaluateAssignmentExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const left = getNode(node, "left")
    const operator = getString(node, "operator")
    const self = this
    return Effect.gen(function* () {
      if (operator === "??=" || operator === "||=" || operator === "&&=") {
        return yield* self.evaluateLogicalAssignment(node, left, operator)
      }
      if (operator === "=" && (left.type === "ObjectPattern" || left.type === "ArrayPattern")) {
        const rightValue = yield* self.evaluateExpression(getNode(node, "right"))
        yield* self.assignPattern(left, rightValue, node)
        return rightValue
      }
      if (left.type === "Identifier") {
        const name = getString(left, "name")
        if (operator !== "=") {
          const current = self.getIdentifierValue(name, left)
          const rightValue = yield* self.evaluateExpression(getNode(node, "right"))
          const next = boundedData(
            self.applyCompoundAssignment(operator, current, rightValue, node),
            "Assignment result",
          )
          return self.setIdentifierValue(name, next, left)
        }
        const rightValue = yield* self.evaluateExpression(getNode(node, "right"))
        if (operator === "=") return self.setIdentifierValue(name, rightValue, left)
      }
      if (left.type === "MemberExpression") {
        return yield* self.modifyMember(left, (current) =>
          Effect.map(self.evaluateExpression(getNode(node, "right")), (rightValue) => {
            if (operator === "=") return { write: true, next: rightValue, result: rightValue }
            const next = boundedData(
              self.applyCompoundAssignment(operator, current, rightValue, node),
              "Assignment result",
            )
            return { write: true, next, result: next }
          }),
        )
      }
      throw new InterpreterRuntimeError("Assignment target must be an Identifier or MemberExpression.", left)
    })
  }

  private evaluateLogicalAssignment(
    node: AstNode,
    left: AstNode,
    operator: string,
  ): Effect.Effect<unknown, unknown, R> {
    const self = this
    const shouldAssign = (current: unknown): boolean =>
      operator === "??=" ? current === null || current === undefined : operator === "||=" ? !current : Boolean(current)
    if (left.type === "Identifier") {
      const name = getString(left, "name")
      return Effect.gen(function* () {
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
          ? Effect.map(self.evaluateExpression(getNode(node, "right")), (rightValue) => ({
              write: true,
              next: rightValue,
              result: rightValue,
            }))
          : Effect.succeed({ write: false, next: current, result: current }),
      )
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
        const next = current + increment
        this.setIdentifierValue(name, next, argument)
        return prefix ? next : current
      })
    }

    if (argument.type === "MemberExpression") {
      return this.modifyMember(argument, (current) => {
        const value = Number(current)
        const next = value + increment
        return Effect.succeed({ write: true, next, result: prefix ? next : value })
      })
    }

    throw new InterpreterRuntimeError("Update target must be an Identifier or MemberExpression.", argument)
  }

  private evaluateCallExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const callee = getNode(node, "callee")
    const argNodes = getArray(node, "arguments")

    const self = this
    return Effect.gen(function* () {
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
        if (callable.namespace === "Object" && callable.name === "assign") {
          return invokeGlobalMethod(callable, args, node)
        }
        return boundedData(invokeGlobalMethod(callable, args, node), `${callable.namespace}.${callable.name} result`)
      }
      if (callable instanceof CoercionFunction) {
        return boundedData(invokeCoercion(callable, args, node), `${callable.name} result`)
      }
      if (callable instanceof UriFunction) {
        return invokeUriFunction(callable, args, node)
      }
      // `Error("msg")` without `new` constructs an error exactly like `new Error("msg")`, as in JS.
      if (callable instanceof ErrorConstructorReference) {
        return createErrorValue(callable.name, args[0] === undefined ? "" : coerceToString(args[0]))
      }
      throw new InterpreterRuntimeError("Only tools are callable in CodeMode.", callee)
    })
  }

  // Object.* over a tool reference: `Object.keys(tools)` / `Object.keys(tools.ns)` enumerate
  // namespace/tool names from the host tool tree - the discovery idiom a model reaches for
  // first. Every other Object helper cannot produce data from a tool reference, so it fails
  // with a pointer at the working idioms instead of the generic plain-objects-only message.
  private invokeObjectMethodOnTools(name: string, ref: ToolReference, node: AstNode): unknown {
    if (name === "keys") {
      return boundedData(this.enumerableKeys(ref)!, "Object.keys result")
    }
    throw new InterpreterRuntimeError(
      `Object.${name}(...) cannot read tool references: they are not plain data. Use Object.keys(tools) for names, or tools.$codemode.search({ query }) for signatures.`,
      node,
      "InvalidDataValue",
    )
  }

  private invokeConsole(name: string, args: Array<unknown>, node: AstNode): undefined {
    if (!consoleMethods.has(name))
      throw new InterpreterRuntimeError(`console.${name} is not available in CodeMode.`, node)
    this.logs.push(publicErrorMessage(this.formatConsoleMessage(name, args, node)))
    return undefined
  }

  private formatConsoleMessage(name: string, args: Array<unknown>, node: AstNode): string {
    if (name === "dir") return args.length === 0 ? "undefined" : this.formatConsoleArgument(args[0])
    if (name === "table") return this.formatConsoleTable(args[0], args[1], node)
    const prefix = name === "warn" ? "[warn] " : name === "error" ? "[error] " : name === "debug" ? "[debug] " : ""
    return `${prefix}${args.map((arg) => this.formatConsoleArgument(arg)).join(" ")}`
  }

  // Console arguments format deeply and totally: values render as a debugger would show them
  // rather than as boundary JSON - numbers keep NaN/Infinity (JSON would say null), sandbox
  // values keep their friendly forms at ANY depth (ISO date, /regex/flags, Map(n) [...],
  // Set(n) [...]), opaque runtime references become "[CodeMode reference]" markers in place,
  // and plain objects/arrays render JSON-style. Formatting never fails the program: cycles
  // render "[Circular]" and extreme depth degrades to "...".
  private formatConsoleArgument(value: unknown): string {
    if (value === undefined) return "undefined"
    // A top-level string prints bare; nested strings are JSON-quoted (see formatConsoleValue).
    if (typeof value === "string") return value
    return this.formatConsoleValue(value, new Set(), 0)
  }

  private formatConsoleValue(value: unknown, seen: Set<object>, depth: number): string {
    // Nested undefined renders as null, matching what JSON boundary output would show.
    if (value === null || value === undefined) return "null"
    if (typeof value === "string") return JSON.stringify(value)
    // String(value) keeps NaN/Infinity/-Infinity readable; finite numbers match their JSON form.
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (typeof value !== "object") return String(value)
    if (value instanceof SandboxPromise) return "[Promise (await it to get its value)]"
    if (value instanceof SandboxDate) return coerceToString(value)
    if (value instanceof SandboxRegExp) return coerceToString(value)
    if (value instanceof SandboxURL) return coerceToString(value)
    if (value instanceof SandboxURLSearchParams) return coerceToString(value)
    if (depth > MAX_CONSOLE_DEPTH) return "..."
    if (seen.has(value)) return "[Circular]"
    if (value instanceof SandboxMap) {
      seen.add(value)
      try {
        const entries = Array.from(value.map.entries(), ([key, item]): Array<unknown> => [key, item])
        return `Map(${value.map.size}) ${this.formatConsoleValue(entries, seen, depth + 1)}`
      } finally {
        seen.delete(value)
      }
    }
    if (value instanceof SandboxSet) {
      seen.add(value)
      try {
        return `Set(${value.set.size}) ${this.formatConsoleValue(Array.from(value.set.values()), seen, depth + 1)}`
      } finally {
        seen.delete(value)
      }
    }
    if (isRuntimeReference(value)) return "[CodeMode reference]"
    seen.add(value)
    try {
      if (Array.isArray(value)) {
        return `[${value.map((item) => this.formatConsoleValue(item, seen, depth + 1)).join(",")}]`
      }
      return `{${Object.entries(value)
        .map(([key, item]) => `${JSON.stringify(key)}:${this.formatConsoleValue(item, seen, depth + 1)}`)
        .join(",")}}`
    } finally {
      seen.delete(value)
    }
  }

  private formatConsoleTable(value: unknown, columnsArgument: unknown, node: AstNode): string {
    if (value === undefined) return "undefined"
    // Sandbox values are legitimate table data (cells render their friendly forms); only
    // truly opaque references (functions, tools, promises) collapse to the marker.
    if (containsOpaqueReference(value)) return "[CodeMode reference]"
    const data = boundedData(value, "console.table argument")
    const columns = this.consoleTableColumns(columnsArgument, node)
    const rows = this.consoleTableRows(data, columns)
    const keys = columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row.values))))
    const header = ["(index)", ...keys].join("\t")
    return [
      header,
      ...rows.map((row) => [row.index, ...keys.map((key) => this.formatConsoleTableCell(row.values[key]))].join("\t")),
    ].join("\n")
  }

  private consoleTableColumns(value: unknown, node: AstNode): ReadonlyArray<string> | undefined {
    if (value === undefined) return undefined
    if (containsRuntimeReference(value)) return undefined
    const columns = copyOut(copyIn(value, "console.table columns"), true)
    return Array.isArray(columns) ? columns.map((column) => String(column)) : undefined
  }

  private consoleTableRows(
    data: unknown,
    columns: ReadonlyArray<string> | undefined,
  ): Array<{ readonly index: string; readonly values: Record<string, unknown> }> {
    if (Array.isArray(data)) {
      return data.map((item, index) => ({ index: String(index), values: this.consoleTableValues(item, columns) }))
    }
    if (data !== null && typeof data === "object" && !isSandboxValue(data)) {
      return Object.entries(data).map(([index, item]) => ({ index, values: this.consoleTableValues(item, columns) }))
    }
    return [{ index: "0", values: { Value: data } }]
  }

  private consoleTableValues(value: unknown, columns: ReadonlyArray<string> | undefined): Record<string, unknown> {
    if (value !== null && typeof value === "object" && !Array.isArray(value) && !isSandboxValue(value)) {
      const source = value as Record<string, unknown>
      if (columns !== undefined) return Object.fromEntries(columns.map((column) => [column, source[column]]))
      return Object.fromEntries(Object.entries(source))
    }
    return { Value: value }
  }

  private formatConsoleTableCell(value: unknown): string {
    if (value === undefined) return ""
    if (typeof value === "string") return value
    return this.formatConsoleValue(value, new Set(), 0)
  }

  private evaluateCallArguments(argNodes: Array<unknown>): Effect.Effect<Array<unknown>, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const args: Array<unknown> = []
      for (const [index, arg] of argNodes.entries()) {
        const argNode = asNode(arg, `arguments[${index}]`)
        if (argNode.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(getNode(argNode, "argument"))
          const items = spreadItems(spread)
          if (items === undefined)
            throw new InterpreterRuntimeError(
              "Spread arguments require an array, string, Map, or Set in CodeMode.",
              argNode,
            )
          args.push(...items)
        } else {
          args.push(yield* self.evaluateExpression(argNode))
        }
      }
      return args
    })
  }

  // Promise.* over ordinary runtime values. Combinators accept ANY array (or spreadable
  // collection) mixing promise values and plain data - built inline, beforehand, via spread,
  // whatever - because tool calls already run eagerly on their own fibers; the combinators
  // only observe settlements. Joining is therefore sequential (no extra fibers) without
  // costing parallelism, and the concurrency cap stays where the work is: the fork semaphore.
  private invokePromiseMethod(
    ref: PromiseMethodReference,
    args: Array<unknown>,
    node: AstNode,
  ): Effect.Effect<unknown, unknown, R> {
    const self = this
    if (ref.name === "resolve") {
      // Promise.resolve of a promise is that promise (JS flattens); anything else is a
      // promise already fulfilled with the value.
      const value = args[0]
      return Effect.succeed(
        value instanceof SandboxPromise ? value : new SandboxPromise(undefined, Effect.succeed(value)),
      )
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

    switch (ref.name) {
      case "all": {
        // Mark every promise element observed up-front (Promise.all handles all of its
        // members' failures, as in JS), then join in index order; the first failure rejects
        // the whole call while unrelated in-flight members keep running.
        const settles = items.map((item) =>
          item instanceof SandboxPromise ? this.settlePromise(item, node) : Effect.succeed(item),
        )
        return Effect.gen(function* () {
          const values: Array<unknown> = []
          for (const settle of settles) values.push(yield* settle)
          return values
        })
      }
      case "allSettled": {
        const observations = items.map((item) =>
          item instanceof SandboxPromise
            ? Effect.map(this.observePromise(item), (exit) => ({ promise: item as SandboxPromise | undefined, exit }))
            : Effect.succeed({ promise: undefined as SandboxPromise | undefined, exit: Exit.succeed(item as unknown) }),
        )
        return Effect.gen(function* () {
          const outcomes: Array<unknown> = []
          for (const observation of observations) {
            const { exit, promise } = yield* observation
            if (Exit.isSuccess(exit)) {
              outcomes.push(
                Object.assign(Object.create(null) as SafeObject, { status: "fulfilled", value: exit.value }),
              )
              continue
            }
            const raceInterrupted = promise?.interrupted === true && Cause.hasInterruptsOnly(exit.cause)
            if (Cause.hasInterruptsOnly(exit.cause) && !raceInterrupted) {
              // Execution teardown (timeout/host interruption), not a program-level rejection.
              return yield* Effect.failCause(exit.cause)
            }
            const thrown = raceInterrupted
              ? new InterpreterRuntimeError(
                  "This tool call was interrupted because another value settled a Promise.race first.",
                  node,
                )
              : Cause.squash(exit.cause)
            outcomes.push(
              Object.assign(Object.create(null) as SafeObject, {
                status: "rejected",
                reason: caughtErrorValue(thrown),
              }),
            )
          }
          return outcomes
        })
      }
      case "race": {
        if (items.length === 0) {
          throw new InterpreterRuntimeError(
            "Promise.race([]) would never settle; provide at least one promise or value.",
            node,
          )
        }
        const observations = items.map((item, index) =>
          item instanceof SandboxPromise
            ? Effect.map(this.observePromise(item), (exit) => ({ index, exit }))
            : Effect.succeed({ index, exit: Exit.succeed(item as unknown) }),
        )
        return Effect.gen(function* () {
          // First settlement (fulfilled OR rejected) wins; the observations never fail, so
          // racing them yields exactly that. Losing in-flight calls are then interrupted.
          const winner = yield* Effect.raceAll(observations)
          for (const [index, item] of items.entries()) {
            if (index === winner.index || !(item instanceof SandboxPromise) || item.fiber === undefined) continue
            item.interrupted = true
            yield* Fiber.interrupt(item.fiber)
          }
          const winningItem = items[winner.index]
          return yield* self.unwrapPromiseExit(
            winningItem instanceof SandboxPromise ? winningItem : undefined,
            winner.exit,
            node,
          )
        })
      }
    }
  }

  private invokeFunction(fn: CodeModeFunction, args: Array<unknown>): Effect.Effect<unknown, unknown, R> {
    const self = this
    return Effect.suspend(() => {
      const savedScopes = self.scopes
      self.scopes = [...fn.capturedScopes, new Map<string, Binding>()]
      const run = Effect.gen(function* () {
        // Seed every parameter name into the scope as a TDZ slot first, so a default that
        // references another parameter resolves to that (uninitialized) param rather than
        // silently falling through to an outer binding of the same name - matching JS.
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
      return run.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            self.scopes = savedScopes
          }),
        ),
      )
    })
  }

  private invokeIntrinsic(
    ref: IntrinsicReference,
    args: Array<unknown>,
    node: AstNode,
  ): Effect.Effect<unknown, unknown, R> {
    if (typeof ref.receiver === "string") {
      if (
        (ref.name === "replace" || ref.name === "replaceAll") &&
        (args[1] instanceof CodeModeFunction || args[1] instanceof CoercionFunction || args[1] instanceof UriFunction)
      ) {
        return this.invokeStringReplacer(ref.receiver, ref.name, args, node)
      }
      return Effect.succeed(invokeStringMethod(ref.receiver, ref.name, args, node))
    }
    if (typeof ref.receiver === "number") {
      return Effect.succeed(invokeNumberMethod(ref.receiver, ref.name, args, node))
    }
    if (Array.isArray(ref.receiver)) {
      return this.invokeArrayMethod(ref.receiver, ref.name, args, node)
    }
    if (ref.receiver instanceof SandboxDate) {
      return Effect.succeed(invokeDateMethod(ref.receiver, ref.name, node))
    }
    if (ref.receiver instanceof SandboxRegExp) {
      return Effect.succeed(invokeRegExpMethod(ref.receiver, ref.name, args, node))
    }
    if (ref.receiver instanceof SandboxMap) {
      return this.invokeMapMethod(ref.receiver, ref.name, args, node)
    }
    if (ref.receiver instanceof SandboxSet) {
      return this.invokeSetMethod(ref.receiver, ref.name, args, node)
    }
    if (ref.receiver instanceof SandboxURL) {
      return Effect.succeed(invokeURLMethod(ref.receiver, ref.name, node))
    }
    if (ref.receiver instanceof SandboxURLSearchParams) {
      return this.invokeURLSearchParamsMethod(ref.receiver, ref.name, args, node)
    }
    throw new InterpreterRuntimeError(`Method '${ref.name}' is not available in CodeMode.`, node)
  }

  private invokeStringReplacer(
    value: string,
    name: "replace" | "replaceAll",
    args: Array<unknown>,
    node: AstNode,
  ): Effect.Effect<unknown, unknown, R> {
    const apply = this.applyCollectionCallback(args[1], `String.${name}`, node)
    const matches: Array<{ readonly match: string; readonly offset: number; readonly args: Array<unknown> }> = []
    const collect = (...callbackArgs: Array<unknown>): string => {
      const match = callbackArgs[0]
      const groups = callbackArgs[callbackArgs.length - 1]
      const hasGroups = groups !== null && typeof groups === "object"
      const offset = callbackArgs[callbackArgs.length - (hasGroups ? 3 : 2)]
      if (typeof match !== "string" || typeof offset !== "number") {
        throw new InterpreterRuntimeError(`String.${name} produced an invalid replacement match.`, node)
      }
      if (hasGroups) {
        const safeGroups: SafeObject = Object.create(null) as SafeObject
        for (const [key, group] of Object.entries(groups)) {
          if (!isBlockedMember(key)) safeGroups[key] = group
        }
        callbackArgs[callbackArgs.length - 1] = safeGroups
      }
      matches.push({ match, offset, args: callbackArgs })
      return match
    }

    const pattern = args[0]
    if (pattern instanceof SandboxRegExp) {
      if (name === "replaceAll" && !pattern.regex.global) {
        throw new InterpreterRuntimeError(
          `String.replaceAll requires a regular expression with the global (g) flag: write /${pattern.regex.source}/${pattern.regex.flags}g, or use String.replace to replace only the first match.`,
          node,
        )
      }
      if (name === "replace") value.replace(pattern.regex, collect)
      else value.replaceAll(pattern.regex, collect)
    } else {
      if (typeof pattern !== "string") {
        throw new InterpreterRuntimeError(`String.${name} expects argument 1 to be a string.`, node)
      }
      if (name === "replace") value.replace(pattern, collect)
      else value.replaceAll(pattern, collect)
    }

    return Effect.gen(function* () {
      const output: Array<string> = []
      let end = 0
      for (const match of matches) {
        output.push(
          value.slice(end, match.offset),
          coerceToString(boundedData(yield* apply(match.args), `String.${name} replacer result`)),
        )
        end = match.offset + match.match.length
      }
      output.push(value.slice(end))
      return boundedData(output.join(""), `String.${name} result`)
    })
  }

  // Runs a collection callback accepting a user function or supported builtin callable,
  // mirroring the array-method callback contract.
  private applyCollectionCallback(
    callback: unknown,
    name: string,
    node: AstNode,
  ): (args: Array<unknown>) => Effect.Effect<unknown, unknown, R> {
    if (
      !(callback instanceof CodeModeFunction) &&
      !(callback instanceof CoercionFunction) &&
      !(callback instanceof UriFunction)
    ) {
      throw new InterpreterRuntimeError(`${name} expects a function callback.`, node)
    }
    return (callbackArgs) =>
      callback instanceof CoercionFunction
        ? Effect.succeed(invokeCoercion(callback, callbackArgs, node))
        : callback instanceof UriFunction
          ? Effect.succeed(invokeUriFunction(callback, callbackArgs, node))
          : this.invokeFunction(callback, callbackArgs)
  }

  private invokeMapMethod(
    target: SandboxMap,
    name: string,
    args: Array<unknown>,
    node: AstNode,
  ): Effect.Effect<unknown, unknown, R> {
    switch (name) {
      case "get":
        return Effect.succeed(target.map.get(args[0]))
      case "has":
        return Effect.succeed(target.map.has(args[0]))
      case "set":
        return Effect.sync(() => {
          target.map.set(args[0], args[1])
          return target
        })
      case "delete":
        return Effect.sync(() => target.map.delete(args[0]))
      case "clear":
        return Effect.sync(() => {
          target.map.clear()
          return undefined
        })
      case "keys":
        return Effect.sync(() => Array.from(target.map.keys()))
      case "values":
        return Effect.sync(() => Array.from(target.map.values()))
      case "entries":
        return Effect.sync(() => Array.from(target.map.entries(), ([key, item]): Array<unknown> => [key, item]))
      case "forEach": {
        const apply = this.applyCollectionCallback(args[0], "Map.forEach", node)
        return Effect.gen(function* () {
          // Snapshot iteration, matching the array-method callback contract.
          for (const [key, item] of Array.from(target.map.entries())) yield* apply([item, key, target])
          return undefined
        })
      }
      default:
        throw new InterpreterRuntimeError(`Map method '${name}' is not available in CodeMode.`, node)
    }
  }

  private invokeSetMethod(
    target: SandboxSet,
    name: string,
    args: Array<unknown>,
    node: AstNode,
  ): Effect.Effect<unknown, unknown, R> {
    switch (name) {
      case "has":
        return Effect.succeed(target.set.has(args[0]))
      case "add":
        return Effect.sync(() => {
          target.set.add(args[0])
          return target
        })
      case "delete":
        return Effect.sync(() => target.set.delete(args[0]))
      case "clear":
        return Effect.sync(() => {
          target.set.clear()
          return undefined
        })
      case "keys":
      case "values":
        return Effect.sync(() => Array.from(target.set.values()))
      case "entries":
        return Effect.sync(() => Array.from(target.set.values(), (item): Array<unknown> => [item, item]))
      case "forEach": {
        const apply = this.applyCollectionCallback(args[0], "Set.forEach", node)
        return Effect.gen(function* () {
          for (const item of Array.from(target.set.values())) yield* apply([item, item, target])
          return undefined
        })
      }
      default:
        throw new InterpreterRuntimeError(`Set method '${name}' is not available in CodeMode.`, node)
    }
  }

  private invokeURLSearchParamsMethod(
    target: SandboxURLSearchParams,
    name: string,
    args: Array<unknown>,
    node: AstNode,
  ): Effect.Effect<unknown, unknown, R> {
    const arg = (index: number): string => uriArgument(args[index], `URLSearchParams.${name} argument ${index + 1}`)
    const requireArgs = (count: number): void => {
      if (args.length < count) {
        throw new InterpreterRuntimeError(
          `URLSearchParams.${name} requires ${count} argument${count === 1 ? "" : "s"}.`,
          node,
        ).as("TypeError")
      }
    }
    switch (name) {
      case "append": {
        requireArgs(2)
        return Effect.sync(() => {
          target.params.append(arg(0), arg(1))
          return undefined
        })
      }
      case "delete": {
        requireArgs(1)
        return Effect.sync(() => {
          if (args[1] !== undefined) target.params.delete(arg(0), arg(1))
          else target.params.delete(arg(0))
          return undefined
        })
      }
      case "get":
        requireArgs(1)
        return Effect.sync(() => target.params.get(arg(0)))
      case "getAll":
        requireArgs(1)
        return Effect.sync(() => target.params.getAll(arg(0)))
      case "has":
        requireArgs(1)
        return Effect.sync(() =>
          args[1] !== undefined ? target.params.has(arg(0), arg(1)) : target.params.has(arg(0)),
        )
      case "set": {
        requireArgs(2)
        return Effect.sync(() => {
          target.params.set(arg(0), arg(1))
          return undefined
        })
      }
      case "sort":
        return Effect.sync(() => {
          target.params.sort()
          return undefined
        })
      case "keys":
        return Effect.sync(() => Array.from(target.params.keys()))
      case "values":
        return Effect.sync(() => Array.from(target.params.values()))
      case "entries":
        return Effect.sync(() => Array.from(target.params.entries(), ([key, value]): Array<unknown> => [key, value]))
      case "toString":
        return Effect.sync(() => target.params.toString())
      case "forEach": {
        requireArgs(1)
        const apply = this.applyCollectionCallback(args[0], "URLSearchParams.forEach", node)
        return Effect.gen(function* () {
          for (const [key, value] of Array.from(target.params.entries())) yield* apply([value, key, target])
          return undefined
        })
      }
      default:
        throw new InterpreterRuntimeError(`URLSearchParams method '${name}' is not available in CodeMode.`, node)
    }
  }

  private invokeArrayMethod(
    target: Array<unknown>,
    name: string,
    args: Array<unknown>,
    node: AstNode,
  ): Effect.Effect<unknown, unknown, R> {
    const optNumber = (value: unknown, label: string): number | undefined => {
      if (value === undefined) return undefined
      if (typeof value !== "number")
        throw new InterpreterRuntimeError(`Array.${name} expects ${label} to be a number.`, node)
      return value
    }
    switch (name) {
      case "join": {
        if (args.length > 1 || (args.length === 1 && typeof args[0] !== "string")) {
          throw new InterpreterRuntimeError("Array.join expects zero arguments or one string separator.", node)
        }
        const input = boundedData(target, "Array.join input") as Array<unknown>
        return Effect.succeed(
          input.map((item) => coerceToString(item ?? "")).join(args.length === 0 ? "," : (args[0] as string)),
        )
      }
      case "includes":
        if (args.length === 0 || args.length > 2)
          throw new InterpreterRuntimeError("Array.includes expects a value and optional start index.", node)
        return Effect.succeed(target.includes(args[0], optNumber(args[1], "start index")))
      case "indexOf":
        return Effect.succeed(target.indexOf(args[0], optNumber(args[1], "start index")))
      case "lastIndexOf":
        return Effect.succeed(
          args[1] === undefined
            ? target.lastIndexOf(args[0])
            : target.lastIndexOf(args[0], optNumber(args[1], "start index")),
        )
      case "at":
        return Effect.succeed(target.at(optNumber(args[0], "index") ?? 0))
      case "slice":
        return Effect.succeed(target.slice(optNumber(args[0], "start"), optNumber(args[1], "end")))
      case "concat":
        return Effect.succeed(target.concat(...args))
      case "flat":
        return Effect.succeed(target.flat(optNumber(args[0], "depth") ?? 1))
      case "reverse":
        return Effect.succeed(target.reverse())
      case "sort":
        return Effect.map(this.sortArray(target, args[0], node), (sorted) => {
          target.splice(0, target.length, ...sorted)
          return target
        })
      case "toSorted":
        return this.sortArray(target, args[0], node)
      case "toReversed":
        return Effect.succeed([...target].reverse())
      case "with": {
        const index = optNumber(args[0], "index") ?? 0
        const resolved = index < 0 ? target.length + index : index
        if (resolved < 0 || resolved >= target.length) {
          throw new InterpreterRuntimeError("Array.with index is out of range.", node)
        }
        const copied = [...target]
        copied[resolved] = args[1]
        return Effect.succeed(copied)
      }
      case "push": {
        // Validate before mutating (so no rollback is needed): inserting a container into
        // itself would create a cycle no later walk could survive.
        for (const item of args) this.rejectCircularInsertion(target, item, "Array.push result", node)
        target.push(...args)
        return Effect.succeed(target.length)
      }
      case "unshift": {
        for (const item of args) this.rejectCircularInsertion(target, item, "Array.unshift result", node)
        target.unshift(...args)
        return Effect.succeed(target.length)
      }
      case "pop":
        return Effect.succeed(target.pop())
      case "shift":
        return Effect.succeed(target.shift())
      case "splice": {
        // Mutates in place and returns the removed elements, exactly like JS: one argument
        // removes to the end, an undefined delete count removes nothing.
        if (args.length === 0) return Effect.succeed(target.splice(0, 0))
        const start = optNumber(args[0], "start") ?? 0
        if (args.length === 1) return Effect.succeed(target.splice(start))
        const deleteCount = optNumber(args[1], "delete count") ?? 0
        const inserted = args.slice(2)
        for (const item of inserted) this.rejectCircularInsertion(target, item, "Array.splice result", node)
        return Effect.succeed(target.splice(start, deleteCount, ...inserted))
      }
      case "fill": {
        this.rejectCircularInsertion(target, args[0], "Array.fill result", node)
        return Effect.succeed(target.fill(args[0], optNumber(args[1], "start"), optNumber(args[2], "end")))
      }
      case "copyWithin":
        return Effect.succeed(
          target.copyWithin(
            optNumber(args[0], "target index") ?? 0,
            optNumber(args[1], "start") ?? 0,
            optNumber(args[2], "end"),
          ),
        )
      // keys/values/entries return arrays (not iterators), matching the Map/Set convention;
      // they work with for...of and spread either way.
      case "keys":
        return Effect.succeed(Array.from(target.keys()))
      case "values":
        return Effect.succeed([...target])
      case "entries":
        return Effect.succeed(Array.from(target.entries(), ([index, item]): Array<unknown> => [index, item]))
    }

    const callback = args[0]
    if (
      !(callback instanceof CodeModeFunction) &&
      !(callback instanceof CoercionFunction) &&
      !(callback instanceof UriFunction)
    ) {
      throw new InterpreterRuntimeError(`Array.${name} expects a function callback.`, node)
    }
    const self = this
    // Accept a user function or supported builtin callable, so idioms such as
    // `filter(Boolean)`, `map(String)`, and `map(encodeURIComponent)` work as in JS. Builtins
    // are synchronous; only CodeModeFunctions can await tool calls.
    const apply = (callbackArgs: Array<unknown>): Effect.Effect<unknown, unknown, R> =>
      callback instanceof CoercionFunction
        ? Effect.succeed(invokeCoercion(callback, callbackArgs, node))
        : callback instanceof UriFunction
          ? Effect.succeed(invokeUriFunction(callback, callbackArgs, node))
          : self.invokeFunction(callback, callbackArgs)
    return Effect.gen(function* () {
      // Capture the initial length, but read the receiver live so callbacks observe mutations
      // without visiting elements appended after iteration begins.
      const length = target.length
      switch (name) {
        case "map": {
          const values: Array<unknown> = []
          values.length = length
          for (let index = 0; index < length; index += 1) {
            if (!(index in target)) continue
            values[index] = yield* apply([target[index], index, target])
          }
          return values
        }
        case "flatMap": {
          const values: Array<unknown> = []
          for (let index = 0; index < length; index += 1) {
            if (!(index in target)) continue
            const mapped = yield* apply([target[index], index, target])
            if (Array.isArray(mapped)) values.push(...mapped)
            else values.push(mapped)
          }
          return values
        }
        case "filter": {
          const values: Array<unknown> = []
          for (let index = 0; index < length; index += 1) {
            if (!(index in target)) continue
            const item = target[index]
            if (yield* apply([item, index, target])) values.push(item)
          }
          return values
        }
        case "find":
          for (let index = 0; index < length; index += 1) {
            const item = target[index]
            if (yield* apply([item, index, target])) return item
          }
          return undefined
        case "findIndex":
          for (let index = 0; index < length; index += 1) {
            if (yield* apply([target[index], index, target])) return index
          }
          return -1
        case "some":
          for (let index = 0; index < length; index += 1) {
            if (!(index in target)) continue
            if (yield* apply([target[index], index, target])) return true
          }
          return false
        case "every":
          for (let index = 0; index < length; index += 1) {
            if (!(index in target)) continue
            if (!(yield* apply([target[index], index, target]))) return false
          }
          return true
        case "forEach":
          for (let index = 0; index < length; index += 1) {
            if (index in target) yield* apply([target[index], index, target])
          }
          return undefined
        case "reduce": {
          let accumulator: unknown
          let start: number
          if (args.length >= 2) {
            accumulator = args[1]
            start = 0
          } else {
            if (length === 0)
              throw new InterpreterRuntimeError("Array.reduce of an empty array with no initial value.", node)
            accumulator = target[0]
            start = 1
          }
          for (let index = start; index < length; index += 1) {
            if (!(index in target)) continue
            accumulator = yield* apply([accumulator, target[index], index, target])
          }
          return accumulator
        }
        case "reduceRight": {
          let accumulator: unknown
          let start: number
          if (args.length >= 2) {
            accumulator = args[1]
            start = length - 1
          } else {
            if (length === 0)
              throw new InterpreterRuntimeError("Array.reduceRight of an empty array with no initial value.", node)
            accumulator = target[length - 1]
            start = length - 2
          }
          for (let index = start; index >= 0; index -= 1) {
            if (!(index in target)) continue
            accumulator = yield* apply([accumulator, target[index], index, target])
          }
          return accumulator
        }
        case "findLast":
          for (let index = length - 1; index >= 0; index -= 1) {
            if (yield* apply([target[index], index, target])) return target[index]
          }
          return undefined
        case "findLastIndex":
          for (let index = length - 1; index >= 0; index -= 1) {
            if (yield* apply([target[index], index, target])) return index
          }
          return -1
      }
      throw new InterpreterRuntimeError(`Array method '${name}' is not available in CodeMode.`, node)
    })
  }

  private sortArray(
    target: Array<unknown>,
    comparator: unknown,
    node: AstNode,
  ): Effect.Effect<Array<unknown>, unknown, R> {
    if (comparator !== undefined && !(comparator instanceof CodeModeFunction)) {
      throw new InterpreterRuntimeError("Array.sort expects an arrow function comparator.", node)
    }
    if (!(comparator instanceof CodeModeFunction)) {
      return Effect.sync(() =>
        [...target].sort((a, b) => {
          const left = coerceToString(a)
          const right = coerceToString(b)
          return left < right ? -1 : left > right ? 1 : 0
        }),
      )
    }
    const self = this
    const mergeSort = (items: Array<unknown>): Effect.Effect<Array<unknown>, unknown, R> => {
      if (items.length <= 1) return Effect.succeed(items)
      const midpoint = Math.floor(items.length / 2)
      return Effect.gen(function* () {
        const left = yield* mergeSort(items.slice(0, midpoint))
        const right = yield* mergeSort(items.slice(midpoint))
        const merged: Array<unknown> = []
        let leftIndex = 0
        let rightIndex = 0
        while (leftIndex < left.length && rightIndex < right.length) {
          // Coerce the comparator's result like JS ToNumber (data objects -> NaN, never a host
          // crash) and treat NaN as 0 - the spec's "no consistent order" -> keep the left element.
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
    return Effect.map(mergeSort(defined), (items) => [...items, ...Array(undefinedCount).fill(undefined)])
  }

  private evaluateObjectExpression(node: AstNode): Effect.Effect<Record<string, unknown>, unknown, R> {
    const objectValue: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    const properties = getArray(node, "properties")
    const self = this
    return Effect.gen(function* () {
      for (const propertyValue of properties) {
        const property = asNode(propertyValue, "properties")

        if (property.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(getNode(property, "argument"))
          // JS treats `{ ...null }` / `{ ...undefined }` as a no-op, so the common
          // `{ ...maybeOpts, override }` merge works when the operand is absent. Sandbox values
          // have no own enumerable properties in JS, so they are no-ops too.
          if (spread === null || spread === undefined || isSandboxValue(spread)) continue
          if (typeof spread !== "object" || Array.isArray(spread) || isRuntimeReference(spread)) {
            throw new InterpreterRuntimeError(
              "Object spread requires a data object in CodeMode.",
              property,
              "InvalidDataValue",
            )
          }
          for (const [key, value] of Object.entries(spread)) {
            if (isBlockedMember(key))
              throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, property)
            objectValue[key] = value
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
      }

      return objectValue
    })
  }

  private evaluateArrayExpression(node: AstNode): Effect.Effect<Array<unknown>, unknown, R> {
    const elements = getArray(node, "elements")
    const values: Array<unknown> = []

    const self = this
    return Effect.gen(function* () {
      for (const elementValue of elements) {
        if (elementValue === null) {
          values.push(undefined)
          continue
        }
        const element = asNode(elementValue, "elements")
        if (element.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(getNode(element, "argument"))
          const items = spreadItems(spread)
          if (items === undefined)
            throw new InterpreterRuntimeError(
              "Array spread requires an array, string, Map, or Set in CodeMode.",
              element,
            )
          values.push(...items)
        } else {
          values.push(yield* self.evaluateExpression(element))
        }
      }
      return values
    })
  }

  private evaluateTemplateLiteral(node: AstNode): Effect.Effect<string, unknown, R> {
    const quasis = getArray(node, "quasis")
    const expressions = getArray(node, "expressions")

    let output = ""

    const self = this
    return Effect.gen(function* () {
      for (let index = 0; index < quasis.length; index += 1) {
        const quasi = asNode(quasis[index], "quasis")
        const rawValue = quasi.value

        if (!isRecord(rawValue) || typeof rawValue.cooked !== "string") {
          throw new InterpreterRuntimeError("Invalid template literal quasi.", quasi)
        }

        output += rawValue.cooked

        if (index < expressions.length) {
          const raw = yield* self.evaluateExpression(asNode(expressions[index], "expressions"))
          // The preserving checkpoint keeps sandbox values intact, so coerceToString renders
          // them directly (ISO date, /regex/ literal form) instead of a JSON-serialized husk.
          output += coerceToString(boundedData(raw, "Template interpolation"))
        }
      }

      return output
    })
  }

  private evaluateConditionalExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    return Effect.flatMap(this.evaluateExpression(getNode(node, "test")), (test) =>
      this.evaluateExpression(getNode(node, test ? "consequent" : "alternate")),
    )
  }

  private applyCompoundAssignment(operator: string, current: unknown, incoming: unknown, node: AstNode): unknown {
    // `x op= y` is `x = x op y`: dispatch through the shared binary operator implementation
    // so compound assignment inherits the same coercion semantics (Dates, data objects, ...).
    // Only the arithmetic/bitwise operators are compoundable; logical assignments (&&=/||=/??=)
    // short-circuit and are handled by evaluateLogicalAssignment before reaching here.
    if (!compoundOperators.has(operator)) {
      throw new InterpreterRuntimeError(`Unsupported assignment operator '${operator}'.`, node)
    }
    return this.applyBinaryOperator(operator.slice(0, -1), current, incoming, node)
  }

  private getMemberReference(
    node: AstNode,
  ): Effect.Effect<
    | MemberReference
    | ToolReference
    | PromiseMethodReference
    | IntrinsicReference
    | GlobalMethodReference
    | ComputedValue
    | typeof OptionalShortCircuit
    | undefined,
    unknown,
    R
  > {
    const objectNode = getNode(node, "object")
    const propertyNode = getNode(node, "property")
    const computed = getBoolean(node, "computed")
    const optional = node.optional === true
    const self = this
    return Effect.gen(function* () {
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
          throw new InterpreterRuntimeError(
            `${objectValue.name}.${String(key)} is not available in CodeMode.`,
            propertyNode,
          )
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
        // instead of throwing - so defensive access like `result?.login ?? result` on a JSON-string
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
      if (objectValue instanceof SandboxURL) {
        if (key === "searchParams") {
          return new ComputedValue(objectValue.searchParams)
        }
        if (typeof key === "string" && urlMethods.has(key)) return new IntrinsicReference(objectValue, key)
        if (typeof key === "string" && urlProperties.has(key)) return { target: objectValue, key }
        return new ComputedValue(undefined)
      }
      if (objectValue instanceof SandboxURLSearchParams) {
        if (key === "size") return new ComputedValue(objectValue.params.size)
        if (typeof key === "string" && urlSearchParamsMethods.has(key)) {
          return new IntrinsicReference(objectValue, key)
        }
        return new ComputedValue(undefined)
      }

      // Any property access on a promise is a confused program (`p.then(...)`, `p.value`);
      // reading `undefined` here would hide the missing await, so both paths get an explicit,
      // await-hinting error instead of the forgiving unknown-property fallthrough.
      if (objectValue instanceof SandboxPromise) {
        if (key === "then" || key === "catch" || key === "finally") {
          throw new InterpreterRuntimeError(
            `Promise.prototype.${String(key)} is not supported in CodeMode; use await instead (with try/catch to handle failures) - e.g. \`const result = await tools.ns.tool(...)\`.`,
            propertyNode,
            "UnsupportedSyntax",
            [supportedSyntaxMessage],
          )
        }
        throw new InterpreterRuntimeError(
          "This value is an un-awaited Promise and has no readable properties; await it first - e.g. `const result = await tools.ns.tool(...)`.",
          objectNode,
          "InvalidDataValue",
        )
      }

      if (isRuntimeReference(objectValue)) {
        throw new InterpreterRuntimeError(
          "CodeMode runtime references are opaque and do not expose properties.",
          objectNode,
          "InvalidDataValue",
        )
      }

      if (typeof objectValue !== "object" || objectValue === null) {
        throw new InterpreterRuntimeError("Cannot access a property on a non-object value.", objectNode)
      }

      if (typeof key === "string" && isBlockedMember(key)) {
        throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, propertyNode)
      }

      if (Array.isArray(objectValue)) {
        if (
          key !== "length" &&
          !(typeof key === "string" && arrayMethods.has(key)) &&
          typeof key !== "number" &&
          !/^\d+$/.test(key)
        ) {
          // Own non-index properties read through (match results carry index/groups); like JS,
          // they are readable in place and dropped by JSON at data boundaries.
          if (typeof key === "string" && Object.hasOwn(objectValue, key)) {
            return new ComputedValue((objectValue as Record<string, unknown> & Array<unknown>)[key])
          }
          // Unknown property on an array reads as `undefined`, matching JS (`[1,2].foo === undefined`),
          // instead of throwing - so defensive access under optional chaining behaves as expected.
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
      )
        return reference
      if (Array.isArray(reference.target)) {
        if (typeof reference.key === "string" && arrayMethods.has(reference.key)) {
          return new IntrinsicReference(reference.target, reference.key)
        }
        return reference.key === "length" ? reference.target.length : reference.target[Number(reference.key)]
      }
      if (reference.target instanceof SandboxURL) {
        return (reference.target.url as unknown as Record<string, unknown>)[String(reference.key)]
      }
      return reference.target[String(reference.key)]
    })
  }

  private writeMember(node: AstNode, value: unknown): Effect.Effect<unknown, unknown, R> {
    return this.modifyMember(node, () => Effect.succeed({ write: true, next: value, result: value }))
  }

  // Resolves the member reference EXACTLY ONCE (so a side-effecting object/key expression
  // runs once), then lets `compute` decide whether to write - enabling compound assignment,
  // updates, plain writes, and short-circuiting logical assignment to share one safe path.
  private modifyMember(
    node: AstNode,
    compute: (current: unknown) => Effect.Effect<{ write: boolean; next: unknown; result: unknown }, unknown, R>,
  ): Effect.Effect<unknown, unknown, R> {
    const self = this
    return Effect.gen(function* () {
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
        if (reference.key === "length")
          throw new InterpreterRuntimeError("Array length cannot be assigned in CodeMode.", node)
        if (typeof reference.key === "string" && arrayMethods.has(reference.key)) {
          throw new InterpreterRuntimeError("Array methods cannot be assigned in CodeMode.", node)
        }
      }
      const key = Array.isArray(reference.target) ? Number(reference.key) : String(reference.key)
      const current =
        reference.target instanceof SandboxURL
          ? (reference.target.url as unknown as Record<string, unknown>)[key]
          : (reference.target as Record<PropertyKey, unknown>)[key]
      const { write, next, result } = yield* compute(current)
      if (write) self.assignToReference(reference, key, next, node)
      return result
    })
  }

  // Rejects inserting a value that (transitively) contains the container it is being inserted
  // into - the mutation that would create a circular structure no later walk could survive.
  private rejectCircularInsertion(
    container: object,
    value: unknown,
    label: string,
    node: AstNode,
    seen = new Set<object>(),
  ): void {
    if (value === container)
      throw new InterpreterRuntimeError(`${label} contains a circular value.`, node, "InvalidDataValue")
    if (value === null || typeof value !== "object" || isRuntimeReference(value) || seen.has(value)) return
    seen.add(value)
    const items = Array.isArray(value) ? value : Object.values(value)
    for (const item of items) this.rejectCircularInsertion(container, item, label, node, seen)
    seen.delete(value)
  }

  private assignToReference(reference: MemberReference, key: number | string, next: unknown, node: AstNode): void {
    if (Array.isArray(reference.target)) {
      const target = reference.target
      const index = key as number
      if (!Number.isInteger(index) || index < 0) {
        throw new InterpreterRuntimeError(
          "Array assignment index must be a non-negative integer.",
          node,
          "InvalidDataValue",
        )
      }
      this.rejectCircularInsertion(target, next, "Array assignment result", node)
      target[index] = next
      return
    }
    if (reference.target instanceof SandboxURL) {
      const property = key as string
      if (!urlWritableProperties.has(property)) {
        throw new InterpreterRuntimeError(`URL.${property} is read-only.`, node).as("TypeError")
      }
      try {
        const url = reference.target.url as unknown as Record<string, string>
        url[property] = uriArgument(next, `URL.${property} value`)
        return
      } catch (error) {
        if (error instanceof InterpreterRuntimeError || error instanceof ToolRuntimeError) throw error
        throw new InterpreterRuntimeError(`URL.${property} received an invalid value.`, node).as("TypeError")
      }
    }
    const target = reference.target as SafeObject
    const objectKey = key as string
    this.rejectCircularInsertion(target, next, "Object assignment result", node)
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
      throw new InterpreterRuntimeError(`Unknown identifier '${name}'.`, node).as("ReferenceError")
    }

    // A parameter default that forward-references a later (not-yet-bound) parameter - JS TDZ.
    if (binding.initialized === false) {
      throw new InterpreterRuntimeError(`Cannot access '${name}' before initialization.`, node).as("ReferenceError")
    }

    return binding.value
  }

  private setIdentifierValue(name: string, value: unknown, node: AstNode): unknown {
    const binding = this.resolveBinding(name)

    if (!binding) {
      throw new InterpreterRuntimeError(`Unknown identifier '${name}'.`, node).as("ReferenceError")
    }

    if (!binding.mutable) {
      throw new InterpreterRuntimeError(`Cannot assign to constant '${name}'.`, node).as("TypeError")
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
export const executeWithLimits = <const Tools extends Record<string, unknown>>(
  options: ExecuteOptions<Tools>,
  limits: ResolvedExecutionLimits,
  searchIndex: ToolRuntime.DiscoveryPlan["searchIndex"],
): Effect.Effect<Result, never, Services<Tools>> => {
  const hooks = {
    ...(options.onToolCallStart === undefined ? {} : { onToolCallStart: options.onToolCallStart }),
    ...(options.onToolCallEnd === undefined ? {} : { onToolCallEnd: options.onToolCallEnd }),
  }
  const tools = ToolRuntime.make(
    (options.tools ?? {}) as HostTools<Services<Tools>>,
    limits.maxToolCalls,
    searchIndex,
    hooks,
  )
  const logs: Array<string> = []
  const logged = () => (logs.length > 0 ? { logs: [...logs] } : {})

  if (options.code.trim().length === 0) {
    return Effect.succeed({
      ok: false,
      error: { kind: "ParseError", message: "Code cannot be empty." },
      toolCalls: tools.calls,
    })
  }

  const operation = Effect.gen(function* () {
    const program = parseProgram(options.code)
    const interpreter = new Interpreter<Services<Tools>>(tools.invoke, tools.keys, logs)
    const value = yield* interpreter.run(program)
    const result = copyOut(copyIn(value, "Execution result"), true) as DataValue
    return {
      ok: true,
      value: result,
      ...logged(),
      toolCalls: tools.calls,
    } satisfies Result
  }).pipe((program) => {
    const timeoutMs = limits.timeoutMs
    if (timeoutMs === undefined) return program
    return program.pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () =>
          Effect.succeed({
            ok: false,
            error: { kind: "TimeoutExceeded", message: `Execution timed out after ${timeoutMs}ms.` },
            ...logged(),
            toolCalls: tools.calls,
          } satisfies Result),
      }),
    )
  })

  return operation.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.succeed({
            ok: false,
            error: normalizeError(Cause.squash(cause)),
            ...logged(),
            toolCalls: tools.calls,
          } satisfies Result),
    ),
    Effect.map((result) => (limits.maxOutputBytes === undefined ? result : boundOutput(result, limits.maxOutputBytes))),
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
 * fails the execution; `truncated: true` marks affected results. Only runs when the host set
 * `maxOutputBytes` - with the limit absent, output passes through unbounded.
 */
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
