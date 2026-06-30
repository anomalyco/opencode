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

const reservedNamespace = "$rune"

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
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") {
    return value
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ToolRuntimeError("InvalidDataValue", `${label} contains a non-finite number.`)
    }
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

export const assertValidTools = <R>(tools: HostTools<R>): void => {
  if (Object.hasOwn(tools, reservedNamespace)) {
    throw new Error(`Tool namespace '${reservedNamespace}' is reserved for Rune discovery capabilities.`)
  }
}

export const instructions = <R>(tools: HostTools<R>): string => {
  const described = catalog(tools)
  const discovery = [
    "- tools.$rune.search({ query: string, limit?: number }): Promise<{ items: Array<{ path: string; description: string }>; total: number }>",
    "- tools.$rune.describe({ path: string }): Promise<{ path: string; description: string; signature: string }>",
  ]
  const lines = [
    "Write a Rune Program to answer the request. Return code only.",
    "Rune Programs can call explicit tools.* capabilities and transform plain data.",
    "Tool Capability calls are async; prefer explicit await unless the call is inside Promise.all(...).",
    "",
    "Available Tool Capabilities:",
    ...described.map((tool) => `- ${tool.signature} // ${tool.description}`),
    "",
    ...(discovery.length > 0 ? [
      "For a large or dynamic catalog, you can discover additional capabilities in the program:",
      ...discovery,
      "",
    ] : []),
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
      throw new ToolRuntimeError("UnknownCapability", `Unknown tool '${path.join(".")}'.`, ["Use tools.$rune.search({ query }) to find available described capabilities."])
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
  const visibleCatalog = visibleDefinitions(tools)

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
        if (name === "$rune.search") {
          const input = externalArgs[0]
          if (externalArgs.length !== 1 || input === null || typeof input !== "object" || Array.isArray(input)) {
            throw new ToolRuntimeError("InvalidToolInput", "tools.$rune.search expects { query?: string; limit?: number }.")
          }
          const request = input as { query?: unknown; limit?: unknown }
          if (request.query !== undefined && typeof request.query !== "string") {
            throw new ToolRuntimeError("InvalidToolInput", "tools.$rune.search query must be a string when provided.")
          }
          if (request.limit !== undefined && (typeof request.limit !== "number" || !Number.isFinite(request.limit) || request.limit <= 0)) {
            throw new ToolRuntimeError("InvalidToolInput", "tools.$rune.search limit must be a positive number when provided.")
          }
          const query = typeof request.query === "string" ? request.query.toLowerCase() : ""
          recordCall(call)
          const matched = visibleCatalog
            .filter((item) => `${item.path} ${item.definition.description}`.toLowerCase().includes(query))
            .map((item) => ({ path: item.path, description: item.definition.description }))
          const limit = typeof request.limit === "number" ? Math.floor(request.limit) : 12
          return checkedCopyIn({ items: matched.slice(0, limit), total: matched.length }, "Result from tool '$rune.search'")
        }
        if (name === "$rune.describe") {
          const input = externalArgs[0]
          const requested = input !== null && typeof input === "object" && !Array.isArray(input)
            ? (input as { path?: unknown }).path
            : undefined
          if (externalArgs.length !== 1 || typeof requested !== "string") {
            throw new ToolRuntimeError("InvalidToolInput", "tools.$rune.describe expects { path: string }.")
          }
          recordCall(call)
          const found = visibleCatalog.find((item) => item.path === requested)
          if (!found) throw new ToolRuntimeError("UnknownCapability", `Unknown tool '${String(requested)}'.`)
          return checkedCopyIn(found.description, "Result from tool '$rune.describe'")
        }

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
