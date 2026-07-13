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

export const containsRuntimeReference = (value: unknown, seen = new Set<object>()): boolean => {
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

// CodeMode values are data here, not opaque interpreter references.
export const containsOpaqueReference = (value: unknown, seen = new Set<object>()): boolean => {
  if (isCodeModeValue(value)) return false
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

// Reject cycles before mutation so later boundary walks remain safe.
export const rejectCircularInsertion = (
  container: object,
  value: unknown,
  label: string,
  node: AstNode,
  seen = new Set<object>(),
): void => {
  if (value === container)
    throw new InterpreterRuntimeError(`${label} contains a circular value.`, node, "InvalidDataValue")
  if (value === null || typeof value !== "object" || isRuntimeReference(value) || seen.has(value)) return
  seen.add(value)
  const items = Array.isArray(value) ? value : Object.values(value)
  for (const item of items) rejectCircularInsertion(container, item, label, node, seen)
  seen.delete(value)
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
