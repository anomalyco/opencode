import { ToolReference } from "../tool-runtime.js"
import { Values } from "../values.js"
import { HostFunction, HostNamespace } from "./host.js"
import {
  type AstNode,
  AsyncIteratorSymbol,
  CodeModeFunction,
  CodeModeGenerator,
  GeneratorMethodReference,
  InterpreterRuntimeError,
  IntrinsicReference,
  IteratorSymbol,
  PromiseInstanceMethodReference,
} from "./model.js"

export const isRuntimeReference = (value: unknown): boolean =>
  value instanceof HostFunction ||
  value instanceof HostNamespace ||
  value instanceof CodeModeFunction ||
  value instanceof CodeModeGenerator ||
  value instanceof GeneratorMethodReference ||
  value instanceof ToolReference ||
  value instanceof IntrinsicReference ||
  value instanceof PromiseInstanceMethodReference ||
  value instanceof Values.Promise ||
  Values.isValue(value)

function* childValues(value: object): Generator {
  for (const key of Reflect.ownKeys(value)) {
    if (!Object.prototype.propertyIsEnumerable.call(value, key)) continue
    if (typeof key === "symbol" && key !== AsyncIteratorSymbol && key !== IteratorSymbol) continue
    yield Reflect.get(value, key)
  }
}

// Depth-first search over a value tree. `match` stops the walk; `skip` prunes a subtree without matching it.
const find = (
  value: unknown,
  match: (current: unknown) => boolean,
  skip: (current: unknown) => boolean,
  seen: Set<object>,
): boolean => {
  const pending: Array<Iterator<unknown>> = [[value].values()]
  while (pending.length > 0) {
    const next = pending.at(-1)!.next()
    if (next.done) {
      pending.pop()
      continue
    }
    const current = next.value
    if (match(current)) return true
    if (current === null || typeof current !== "object" || skip(current) || seen.has(current)) continue
    seen.add(current)
    pending.push(childValues(current))
  }
  return false
}

const never = () => false

export const containsRuntimeReference = (value: unknown): boolean => find(value, isRuntimeReference, never, new Set())

// CodeMode values are data here, not opaque interpreter references.
export const containsOpaqueReference = (value: unknown): boolean =>
  find(value, (current) => !Values.isValue(current) && isRuntimeReference(current), Values.isValue, new Set())

// Reject cycles before mutation so later boundary walks remain safe.
export const rejectCircularInsertion = (
  container: object,
  value: unknown,
  label: string,
  node: AstNode,
  seen = new Set<object>(),
): void => {
  if (find(value, (current) => current === container, isRuntimeReference, seen)) {
    throw new InterpreterRuntimeError(`${label} contains a circular value.`, node, "InvalidDataValue")
  }
}

export const describeValue = (value: unknown): string => {
  if (value === null) return "null"
  if (Array.isArray(value)) return "an array"
  if (value instanceof Values.Promise) return "an un-awaited Promise"
  if (value instanceof ToolReference) return "a tool reference"
  if (value instanceof Values.Date) return "a Date"
  if (value instanceof Values.RegExp) return "a RegExp"
  if (value instanceof Values.Map) return "a Map"
  if (value instanceof Values.Set) return "a Set"
  if (value instanceof Values.URL) return "a URL"
  if (value instanceof Values.URLSearchParams) return "a URLSearchParams"
  if (value instanceof CodeModeGenerator) return "a generator"
  if (isRuntimeReference(value)) return "a function"
  if (typeof value === "object") return "a data object"
  return `a ${typeof value}`
}

export const typeofValue = (value: unknown): string => {
  if (
    value instanceof HostFunction ||
    value instanceof CodeModeFunction ||
    value instanceof GeneratorMethodReference ||
    value instanceof IntrinsicReference ||
    value instanceof PromiseInstanceMethodReference
  ) {
    return "function"
  }
  if (value instanceof HostNamespace) return "object"
  if (value instanceof ToolReference) return value.path.length > 0 ? "function" : "object"
  return typeof value
}

const MAX_ARRAY_LENGTH = 4_294_967_295

export const parseArrayIndex = (key: string | number): number | undefined => {
  const property = String(key)
  if (!/^(0|[1-9]\d*)$/.test(property)) return undefined
  const index = Number(property)
  return index < MAX_ARRAY_LENGTH ? index : undefined
}
