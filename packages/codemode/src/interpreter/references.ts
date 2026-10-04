import { ToolReference } from "../tool-runtime.js"
import { invalidData } from "./model.js"
import { Callable, getOwn, isRuntimeReference, Obj, Opaque, ownKeys, type Value } from "./objects.js"

/** Interpreter machinery that is never data, unlike a Date or Map, which cross some boundaries as copies. */
export const isOpaque = (value: Value): boolean => value instanceof Opaque || value instanceof ToolReference

// Depth-first search over a value tree. `match` stops the walk; `skip` prunes a subtree without matching it.
const find = (
  value: Value,
  match: (current: Value) => boolean,
  skip: (current: Value) => boolean,
  seen: Set<object>,
): boolean => {
  const pending: Array<Iterator<Value>> = [[value].values()]
  while (pending.length > 0) {
    const next = pending.at(-1)!.next()
    if (next.done) {
      pending.pop()
      continue
    }
    const current = next.value
    if (match(current)) return true
    if (!(current instanceof Obj) || skip(current) || seen.has(current)) continue
    seen.add(current)
    pending.push(
      ownKeys(current)
        .map((key) => getOwn(current, key))
        .values(),
    )
  }
  return false
}

const never = () => false

export const containsRuntimeReference = (value: Value): boolean => find(value, isRuntimeReference, never, new Set())

export const containsOpaqueReference = (value: Value): boolean =>
  find(value, isOpaque, (current) => isRuntimeReference(current) && !isOpaque(current), new Set())

// Reject cycles before mutation so later boundary walks remain safe.
export const rejectCircularInsertion = (
  container: Obj,
  value: Value,
  label: string,
  seen = new Set<object>(),
): void => {
  if (find(value, (current) => current === container, isRuntimeReference, seen)) {
    throw invalidData(`${label} contains a circular value.`)
  }
}

export const describeValue = (value: Value): string => {
  if (value === null || value === undefined) return String(value)
  if (value instanceof Obj) return value.describe
  if (value instanceof ToolReference) return "a tool reference"
  return `a ${typeof value}`
}

export const typeofValue = (value: Value): string => {
  if (value instanceof Callable) return "function"
  if (value instanceof ToolReference) return value.path.length > 0 ? "function" : "object"
  return typeof value
}
