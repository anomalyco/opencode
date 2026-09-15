import { ToolReference } from "../tool-runtime.js"
import { invalidData } from "./model.js"
import {
  Callable,
  getOwn,
  isWrapper,
  ownKeys,
  Arr,
  Bytes,
  DateObj,
  GeneratorObj,
  Handle,
  MapObj,
  Obj,
  PromiseObj,
  RegExpObj,
  SetObj,
  URLObj,
  URLSearchParamsObj,
} from "./objects.js"

/** Values that cannot cross the data boundary. */
export const isRuntimeReference = (value: unknown): boolean =>
  value instanceof Callable ||
  value instanceof GeneratorObj ||
  value instanceof Handle ||
  value instanceof ToolReference ||
  value instanceof PromiseObj ||
  isWrapper(value)

function* childValues(value: object): Generator {
  if (!(value instanceof Obj)) return
  for (const key of ownKeys(value)) yield getOwn(value, key)
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

// Wrapper values are data here, not opaque interpreter references.
export const containsOpaqueReference = (value: unknown): boolean =>
  find(value, (current) => !isWrapper(current) && isRuntimeReference(current), isWrapper, new Set())

// Reject cycles before mutation so later boundary walks remain safe.
export const rejectCircularInsertion = (
  container: object,
  value: unknown,
  label: string,
  seen = new Set<object>(),
): void => {
  if (find(value, (current) => current === container, isRuntimeReference, seen)) {
    throw invalidData(`${label} contains a circular value.`)
  }
}

export const describeValue = (value: unknown): string => {
  if (value === null || value === undefined) return String(value)
  if (value instanceof Arr) return "an array"
  if (value instanceof PromiseObj) return "an un-awaited Promise"
  if (value instanceof ToolReference) return "a tool reference"
  if (value instanceof DateObj) return "a Date"
  if (value instanceof RegExpObj) return "a RegExp"
  if (value instanceof MapObj) return "a Map"
  if (value instanceof SetObj) return "a Set"
  if (value instanceof URLObj) return "a URL"
  if (value instanceof URLSearchParamsObj) return "a URLSearchParams"
  if (value instanceof Bytes) return "a Uint8Array"
  if (value instanceof GeneratorObj) return "a generator"
  if (value instanceof Handle) return `a ${value.instance.constructor.name}`
  if (isRuntimeReference(value)) return "a function"
  if (typeof value === "object") return "a data object"
  return `a ${typeof value}`
}

export const typeofValue = (value: unknown): string => {
  if (value instanceof Callable) return "function"
  if (value instanceof ToolReference) return value.path.length > 0 ? "function" : "object"
  return typeof value
}
