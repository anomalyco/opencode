import {
  type AstNode,
  CodeModeFunction,
  CoercionFunction,
  ErrorConstructorReference,
  GlobalMethodReference,
  GlobalNamespace,
  InterpreterRuntimeError,
  IntrinsicReference,
  PromiseCapabilityFunction,
  PromiseInstanceMethodReference,
  PromiseMethodReference,
  PromiseNamespace,
  SearchFunction,
  UriFunction,
} from "./model.js"
import { ToolReference } from "../tool-runtime.js"
import { isCodeModeValue, CodeModePromise } from "../values.js"

export const isRuntimeReference = (value: unknown): boolean =>
  value instanceof CodeModeFunction ||
  value instanceof ToolReference ||
  value instanceof IntrinsicReference ||
  value instanceof GlobalNamespace ||
  value instanceof GlobalMethodReference ||
  value instanceof PromiseNamespace ||
  value instanceof PromiseMethodReference ||
  value instanceof PromiseInstanceMethodReference ||
  value instanceof CodeModePromise ||
  value instanceof CoercionFunction ||
  value instanceof UriFunction ||
  value instanceof SearchFunction ||
  value instanceof PromiseCapabilityFunction ||
  value instanceof ErrorConstructorReference ||
  isCodeModeValue(value)

function* childValues(value: object): Generator<unknown> {
  if (Array.isArray(value)) {
    const length = value.length
    for (let index = 0; index < length; index++) yield value[index]
    return
  }
  yield* Object.values(value)
}

export const containsRuntimeReference = (value: unknown): boolean => {
  const pending: Array<Iterator<unknown>> = [[value].values()]
  const seen = new Set<object>()
  while (pending.length > 0) {
    const next = pending.at(-1)!.next()
    if (next.done) {
      pending.pop()
      continue
    }
    const current = next.value
    if (isRuntimeReference(current)) return true
    if (current === null || typeof current !== "object" || seen.has(current)) continue
    seen.add(current)
    pending.push(childValues(current))
  }
  return false
}

// CodeMode values are data here, not opaque interpreter references.
export const containsOpaqueReference = (value: unknown): boolean => {
  const pending: Array<Iterator<unknown>> = [[value].values()]
  const seen = new Set<object>()
  while (pending.length > 0) {
    const next = pending.at(-1)!.next()
    if (next.done) {
      pending.pop()
      continue
    }
    const current = next.value
    if (isCodeModeValue(current)) continue
    if (isRuntimeReference(current)) return true
    if (current === null || typeof current !== "object" || seen.has(current)) continue
    seen.add(current)
    pending.push(childValues(current))
  }
  return false
}

// Reject cycles before mutation so later boundary walks remain safe.
export const rejectCircularInsertion = (
  container: object,
  value: unknown,
  label: string,
  node: AstNode,
): void => {
  const pending: Array<Iterator<unknown>> = [[value].values()]
  const seen = new Set<object>()
  while (pending.length > 0) {
    const next = pending.at(-1)!.next()
    if (next.done) {
      pending.pop()
      continue
    }
    const current = next.value
    if (current === container)
      throw new InterpreterRuntimeError(`${label} contains a circular value.`, node, "InvalidDataValue")
    if (current === null || typeof current !== "object" || isRuntimeReference(current) || seen.has(current)) continue
    seen.add(current)
    pending.push(Array.isArray(current) ? current[Symbol.iterator]() : childValues(current))
  }
}

export const typeofValue = (value: unknown): string => {
  if (
    value instanceof CodeModeFunction ||
    value instanceof CoercionFunction ||
    value instanceof IntrinsicReference ||
    value instanceof GlobalMethodReference ||
    value instanceof PromiseMethodReference ||
    value instanceof PromiseInstanceMethodReference ||
    value instanceof PromiseNamespace ||
    value instanceof PromiseCapabilityFunction ||
    value instanceof ErrorConstructorReference
  )
    return "function"
  if (value instanceof UriFunction || value instanceof SearchFunction) return "function"
  if (value instanceof ToolReference) return value.path.length > 0 ? "function" : "object"
  if (value instanceof GlobalNamespace) {
    return value.name === "Math" || value.name === "JSON" || value.name === "console" ? "object" : "function"
  }
  return typeof value
}
