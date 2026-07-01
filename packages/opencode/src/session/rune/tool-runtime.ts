import { Effect, Schema } from "effect"
import { isDefinition as isToolDefinition, toTypeScript, type Definition } from "./tool.js"

export type HostTool<R = never> = (...args: Array<unknown>) => Effect.Effect<unknown, unknown, R>

export type HostTools<R = never> = {
  [name: string]: HostTool<R> | Definition<R> | HostTools<R>
}

export type Services<Tools> = Tools extends (...args: Array<unknown>) => Effect.Effect<unknown, unknown, infer R>
  ? R
  : Tools extends { readonly _tag: "RuneTool"; readonly run: (input: unknown) => Effect.Effect<unknown, unknown, infer R> }
    ? R
  : Tools extends object
    ? string extends keyof Tools ? never : Services<Tools[keyof Tools]>
    : never

export type ToolCall = {
  readonly name: string
}

export type ToolDescription = {
  readonly path: string
  readonly description: string
  readonly signature: string
}

export type SafeObject = Record<string, unknown>

export class ToolReference {
  constructor(readonly path: ReadonlyArray<string>) {}
}

export type DataLimits = {
  readonly maxValueDepth: number
  readonly maxCollectionLength: number
  readonly maxDataBytes: number
  readonly maxAuditBytes: number
}

export class ToolRuntimeError extends Error {
  constructor(
    readonly kind: "UnknownCapability" | "InvalidToolInput" | "InvalidToolOutput" | "InvalidDataValue" | "ToolCallLimitExceeded" | "AuditLimitExceeded",
    message: string,
    readonly suggestions: ReadonlyArray<string> = [],
  ) {
    super(message)
    this.name = "ToolRuntimeError"
  }
}

const isDefinition = <R>(value: HostTool<R> | Definition<R> | HostTools<R>): value is Definition<R> =>
  isToolDefinition<R>(value)

const blockedMemberNames = new Set(["__proto__", "constructor", "prototype"])

export const isBlockedMember = (name: string): boolean => blockedMemberNames.has(name)

export const copyIn = (value: unknown, label: string, limits?: DataLimits, depth = 0, seen = new Set<object>()): unknown => {
  if (limits && depth > limits.maxValueDepth) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds the maximum value depth of ${limits.maxValueDepth}.`)
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    // NaN/Infinity are allowed to exist as in-sandbox intermediates (matching real JS and a real
    // engine) so defensive guards like `Number.isNaN(x)` / `parseInt(x) || 0` can run. They are
    // normalized to `null` when the value leaves the sandbox — see copyOut — exactly as
    // JSON.stringify already does at any tool boundary.
    typeof value === "number"
  ) {
    return value
  }

  if (typeof value !== "object") {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain data only.`)
  }

  if (seen.has(value)) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} contains a circular value.`)
  }

  seen.add(value)

  if (Array.isArray(value)) {
    if (limits && value.length > limits.maxCollectionLength) {
      throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds the maximum collection length of ${limits.maxCollectionLength}.`)
    }
    const copied = value.map((item) => copyIn(item, label, limits, depth + 1, seen))
    seen.delete(value)
    return copied
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain plain objects only.`)
  }

  const copied: SafeObject = Object.create(null) as SafeObject
  const entries = Object.entries(value)
  if (limits && entries.length > limits.maxCollectionLength) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds the maximum collection length of ${limits.maxCollectionLength}.`)
  }
  for (const [key, item] of entries) {
    if (isBlockedMember(key)) {
      throw new ToolRuntimeError("InvalidDataValue", `${label} contains blocked property '${key}'.`)
    }
    copied[key] = copyIn(item, label, limits, depth + 1, seen)
  }
  seen.delete(value)
  return copied
}

export const copyOut = (value: unknown): unknown => {
  // Normalize non-finite numbers to null as the value crosses out of the sandbox (final return
  // and tool-call arguments both funnel through here), matching JSON semantics — NaN/Infinity
  // have no JSON representation, so JSON.stringify would produce null anyway.
  if (typeof value === "number" && !Number.isFinite(value)) {
    return null
  }

  if (Array.isArray(value)) {
    return value.map(copyOut)
  }

  if (value !== null && typeof value === "object" && !(value instanceof ToolReference)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyOut(item)]))
  }

  return value
}

const definitions = <R>(tools: HostTools<R>, path: ReadonlyArray<string> = []): Array<{ path: string; definition: Definition<R> }> => {
  const entries: Array<{ path: string; definition: Definition<R> }> = []
  for (const [name, value] of Object.entries(tools)) {
    const next = [...path, name]
    if (isDefinition(value)) entries.push({ path: next.join("."), definition: value })
    else if (typeof value !== "function") entries.push(...definitions(value, next))
  }
  return entries
}

const describeDefinition = <R>(path: string, definition: Definition<R>): ToolDescription => ({
    path,
    description: definition.description,
    signature: `tools.${path}(input: ${toTypeScript(definition.input)}): Promise<${toTypeScript(definition.output, true)}>`,
  })

const visibleDefinitions = <R>(tools: HostTools<R>) =>
  definitions(tools).flatMap(({ path, definition }) => {
    const description = describeDefinition(path, definition)
    return [{ path, definition, description }]
  })

export const catalog = <R>(tools: HostTools<R>): ReadonlyArray<ToolDescription> =>
  visibleDefinitions(tools).map(({ description }) => description)

// Discovery is provided by the embedder as ordinary host tools (e.g. under a
// `$rune` namespace), not by the runtime, so there are no reserved namespaces.
export const assertValidTools = <R>(_tools: HostTools<R>): void => {}

// Generic Rune-language instructions. Discovery (e.g. searching a large or dynamic
// catalog) is not a runtime feature; an embedder that wants it registers ordinary
// host tools and documents them itself, so nothing is hardcoded here.
export const instructions = <R>(tools: HostTools<R>): string => {
  const described = catalog(tools)
  const lines = [
    "Write a Rune Program to answer the request. Return code only.",
    "Rune Programs can call explicit tools.* capabilities and transform plain data.",
    "Tool Capability calls are async; prefer explicit await unless the call is inside Promise.all(...).",
    "",
    "Available Tool Capabilities:",
    ...described.map((tool) => `- ${tool.signature} // ${tool.description}`),
    "",
    "Common syntax: arrow functions and `function` declarations (hoisted) with closures, default/rest parameters, destructuring (incl. rest/defaults), optional chaining, template literals, conditionals, switch, loops, spread (arrays/objects/strings), try/catch, ternary, the `in` operator, logical assignment (??=/||=/&&=), and bitwise operators (& | ^ ~ << >> >>>). Signal failure with `throw` (any value) or `throw new Error(message)`.",
    "Transform data with array methods (map/filter/reduce/reduceRight/flatMap/forEach/find/findIndex/findLast/findLastIndex/sort/toSorted/slice/concat/indexOf/at/flat/reverse/toReversed/with/includes/join, plus push/pop/shift/unshift for accumulation), string methods (toLowerCase/toUpperCase/trim/split/slice/substring/replace/replaceAll/includes/startsWith/endsWith/indexOf/padStart/padEnd/repeat/charCodeAt), number methods (toFixed/toString(radix)/toPrecision), Object.keys/values/entries/fromEntries/hasOwn, Math.* (incl. PI/E), JSON.parse/stringify, Array.from/isArray/of, Number.isInteger/isNaN/parseInt, String.fromCharCode, parseInt/parseFloat, and Number/String/Boolean.",
    "Use Promise.all([...]) for parallel tool calls (a direct array of calls, or items.map((item) => tool call)).",
  ]
  return lines.join("\n")
}

const resolve = <R>(tools: HostTools<R>, path: ReadonlyArray<string>): HostTool<R> | Definition<R> => {
  let value: HostTool<R> | Definition<R> | HostTools<R> = tools

  for (const segment of path) {
    if (isBlockedMember(segment) || typeof value === "function" || isDefinition(value) || !Object.hasOwn(value, segment)) {
      throw new ToolRuntimeError("UnknownCapability", `Unknown tool '${path.join(".")}'.`, ["Call a capability by its exact tools.* path."])
    }
    value = value[segment] as HostTool<R> | Definition<R> | HostTools<R>
  }

  if (typeof value !== "function" && !isDefinition(value)) {
    throw new ToolRuntimeError("UnknownCapability", `Tool '${path.join(".")}' is not callable.`)
  }

  return value
}

export type ToolRuntime<R = never> = {
  readonly root: ToolReference
  readonly calls: Array<ToolCall>
  readonly invoke: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
}

export const dataByteLength = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength

export const make = <R>(
  tools: HostTools<R>,
  maxToolCalls: number,
  dataLimits: DataLimits,
): ToolRuntime<R> => {
  const calls: Array<ToolCall> = []
  let auditBytes = 0

  const checkedCopyIn = (value: unknown, label: string): unknown => {
    const copied = copyIn(value, label, dataLimits)
    if (dataByteLength(copied) > dataLimits.maxDataBytes) {
      throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds ${dataLimits.maxDataBytes} bytes.`)
    }
    return copied
  }

  const recordCall = (call: ToolCall): void => {
    if (calls.length >= maxToolCalls) {
      throw new ToolRuntimeError("ToolCallLimitExceeded", `Execution exceeded its tool-call limit of ${maxToolCalls}.`)
    }
    const auditEntryBytes = dataByteLength(call)
    if (auditBytes + auditEntryBytes > dataLimits.maxAuditBytes) {
      throw new ToolRuntimeError("AuditLimitExceeded", `Execution exceeds its audit-trail limit of ${dataLimits.maxAuditBytes} bytes.`)
    }
    auditBytes += auditEntryBytes
    calls.push(call)
  }

  return {
    root: new ToolReference([]),
    calls,
    invoke: (path, args) =>
      Effect.gen(function*() {
        const name = path.join(".")
        const externalArgs = args.map((arg) => copyOut(copyIn(arg, `Arguments for tool '${name}'`, dataLimits)))
        const argumentBytes = dataByteLength(externalArgs)
        if (argumentBytes > dataLimits.maxDataBytes) {
          throw new ToolRuntimeError("InvalidDataValue", `Arguments for tool '${name}' exceed ${dataLimits.maxDataBytes} bytes.`)
        }
        const call = { name }
        const tool = resolve(tools, path)
        let describedInput: unknown
        if (isDefinition(tool)) {
          if (externalArgs.length !== 1) throw new ToolRuntimeError("InvalidToolInput", `Tool '${name}' expects exactly one input object.`)
          describedInput = yield* Effect.try({
            try: () => Schema.decodeUnknownSync(tool.input)(externalArgs[0]),
            catch: (cause) => new ToolRuntimeError("InvalidToolInput", `Invalid input for tool '${name}': ${String(cause)}`),
          })
        }
        recordCall(call)
        if (isDefinition(tool)) {
          const raw = yield* tool.run(describedInput)
          const result = yield* Effect.try({
            try: () => Schema.decodeUnknownSync(tool.output)(raw),
            catch: (cause) => new ToolRuntimeError("InvalidToolOutput", `Invalid output from tool '${name}': ${String(cause)}`),
          })
          return checkedCopyIn(result, `Result from tool '${name}'`)
        }
        const result = yield* tool(...externalArgs)
        return checkedCopyIn(result, `Result from tool '${name}'`)
      }),
  }
}

export * as ToolRuntime from "./tool-runtime.js"
