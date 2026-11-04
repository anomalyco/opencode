export * as Data from "./data.js"

import type { Schema } from "effect"
import type { Interpreter } from "./interpreter/interpreter.js"
import { MAX_VALUE_DEPTH } from "./interpreter/limits.js"
import { invalidData, rangeError, typeError } from "./interpreter/model.js"
import {
  Arr,
  Bytes,
  Callable,
  define,
  ErrorObj,
  get,
  keys,
  Obj,
  PromiseObj,
  record,
  type Value,
  SetObj,
  URLSearchParamsObj,
  HeadersObj,
} from "./interpreter/objects.js"
import { typeofValue } from "./interpreter/references.js"
import { Await } from "./interpreter/signals.js"
import type { Builtins } from "./interpreter/intrinsics.js"
import { checkStringLength } from "./interpreter/limits.js"
import { type Frame, kind, type Out, PENDING } from "./machine/frame.js"
import { nativeKind } from "./machine/native-kind.js"
import type { MachineTask } from "./machine/task.js"

export type Json = Schema.Json

/**
 * Where a walk is: one value being converted, as data. `holder[key]` is the value; the stage says how far it got (its
 * `toJSON`, the replacer, its children); a container keeps its copy and the next child.
 */
type Level = {
  readonly holder: Obj
  readonly key: string
  readonly depth: number
  stage: number
  value: Value
  target: Obj | undefined
  /** The copy: an array's items or an object's properties. */
  copy: Array<Json> | Record<string, Json> | undefined
  /** An object's property names, in order; an Error's start with its name and message, then its own keys. */
  names: Array<string> | undefined
  /** An Error's own keys are read once its name and message are converted. */
  keysPending: boolean
  index: number
}

// The stages of a level: let the host run (when the slice is over), read the value, have it awaited (the host
// boundary awaits a promise), call `toJSON`, have its result, call the replacer, have its result, and convert the
// children.
const START = 0
const READ = 1
const AWAITED = 2
const TO_JSON = 3
const TO_JSONED = 4
const REPLACE = 5
const REPLACED = 6
const CHILDREN = 7

const level = (holder: Obj, key: string, depth: number): Level => ({
  holder,
  key,
  depth,
  stage: START,
  value: undefined,
  target: undefined,
  copy: undefined,
  names: undefined,
  keysPending: false,
  index: 0,
})

/**
 * The slots of a walk over `value`: whether it is the host boundary, the replacer, the levels, and, for
 * `JSON.stringify`, the property list and indent.
 *
 * `JsonWalk` gives the text `JSON.stringify` would: `toJSON` is honored, functions and `undefined` vanish, non-finite
 * numbers become null, and everything else is copied. Two departures from JS so a mistake is not a silent `{}`: an
 * Error serializes as `{ name, message, ...own }`, and a promise throws.
 *
 * `BoundaryWalk` gives host JSON, plus what a program most likely meant when a value cannot be JSON. A promise is
 * awaited, a Set crosses as an array, a URLSearchParams as its query string, a Uint8Array asks to be encoded as text
 * first, and a `__proto__` key is dropped so host code can never receive one.
 */
export const walk = (
  builtins: Builtins,
  value: Value,
  boundary: boolean,
  replacer?: Callable,
  properties?: Array<string> | null,
  indent?: string | number,
): Array<unknown> => [boundary, replacer, [level(record(builtins.Object, { "": value }), "", 0)], properties, indent]

function walkStep(task: MachineTask, frame: Frame, input: unknown): Out<Value> {
  const slots = frame.slots
  const boundary = slots[0] as boolean
  const replacer = slots[1] as Callable | undefined
  const levels = slots[2] as Array<Level>
  while (true) {
    const current = levels[levels.length - 1]!
    const result = visit(task, current, levels, boundary, replacer, input)
    input = undefined
    if (result === PENDING) return PENDING
    if (result === DESCEND) continue
    levels.pop()
    const parent = levels[levels.length - 1]
    const json = result as Json | undefined
    if (parent === undefined) {
      if (boundary) return json as Value
      const text = JSON.stringify(json, slots[3] as Array<string> | null, slots[4] as string | number | undefined)
      if (text !== undefined) checkStringLength(text.length)
      return text
    }
    if (Array.isArray(parent.copy)) parent.copy.push(json ?? null)
    else if (json !== undefined) {
      // Own data property regardless of the key, so "__proto__" never reaches the Object.prototype setter.
      Object.defineProperty(parent.copy, parent.names![parent.index - 1]!, {
        value: json,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
  }
}

const DESCEND: unique symbol = Symbol("descend")

// Advances one level: its JSON once it is done, DESCEND after pushing a child level, or PENDING.
function visit(
  task: MachineTask,
  current: Level,
  levels: Array<Level>,
  boundary: boolean,
  replacer: Callable | undefined,
  input: unknown,
): Out<Json | undefined | typeof DESCEND> {
  const ctx = task.ctx
  if (current.stage === START) {
    current.stage = READ
    // Shared references expand into a tree, so the work is not bounded by the value's size or depth.
    if (task.machine.tick()) {
      task.slice = true
      return PENDING
    }
  }
  switch (current.stage) {
    case READ: {
      if (current.depth > MAX_VALUE_DEPTH) throw rangeError(`Value exceeds the maximum depth of ${MAX_VALUE_DEPTH}.`)
      const raw = get(current.holder, current.key)
      if (raw instanceof PromiseObj) {
        if (!boundary) {
          throw invalidData(
            "JSON.stringify received an un-awaited Promise; await it first - e.g. `const result = await tools.ns.tool(...)`.",
          )
        }
        current.stage = AWAITED
        return task.request(new Await(raw), undefined)
      }
      current.value = raw
      current.stage = TO_JSON
      break
    }
    case AWAITED:
      current.value = input as Value
      current.stage = TO_JSON
      break
    case TO_JSONED:
      current.value = input as Value
      current.stage = REPLACE
      break
    case REPLACED:
      current.value = input as Value
      current.stage = CHILDREN
      break
  }
  if (current.stage === TO_JSON) {
    const settled = current.value
    const toJSON = settled instanceof Obj ? get(settled, "toJSON") : undefined
    current.stage = REPLACE
    if (toJSON instanceof Callable) {
      current.stage = TO_JSONED
      const own = task.call(toJSON, settled, [current.key], undefined)
      if (own === PENDING) return PENDING
      current.value = own
      current.stage = REPLACE
    }
  }
  if (current.stage === REPLACE) {
    current.stage = CHILDREN
    if (replacer !== undefined) {
      current.stage = REPLACED
      const replaced = task.call(replacer, current.holder, [current.key, current.value], undefined)
      if (replaced === PENDING) return PENDING
      current.value = replaced
      current.stage = CHILDREN
    }
  }
  if (current.target === undefined) {
    const value = current.value
    if (value === undefined || typeofValue(value) === "function") return undefined
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (!(value instanceof Obj)) return {}
    if (boundary && value instanceof Bytes) {
      throw invalidData(
        "A Uint8Array cannot cross to the host; pass text instead, e.g. `new TextDecoder().decode(bytes)` or `bytes.toBase64()`.",
      )
    }
    if (boundary && value instanceof URLSearchParamsObj) return value.params.toString()
    if (value instanceof HeadersObj) return Object.fromEntries(value.headers)
    const target = boundary && value instanceof SetObj ? new Arr(ctx.builtins.Array, [...value.set.liveKeys()]) : value
    if (levels.some((other) => other.target === target)) throw typeError("Converting circular structure to JSON.")
    current.target = target
    if (target instanceof Arr) current.copy = []
    else {
      current.copy = {}
      if (target instanceof ErrorObj) {
        // Errors serialize as { name, message, ...own }: both may be inherited, and neither is enumerable in JS.
        current.names = ["name", "message"]
        current.keysPending = true
      } else current.names = ownNames(target, boundary)
    }
  }
  const target = current.target
  if (target instanceof Arr) {
    if (current.index < target.items.length) {
      levels.push(level(target, String(current.index++), current.depth + 1))
      return DESCEND
    }
    return current.copy as Array<Json>
  }
  const names = current.names!
  if (current.index === names.length && current.keysPending) {
    current.keysPending = false
    names.push(...ownNames(target, boundary))
  }
  if (current.index < names.length) {
    levels.push(level(target, names[current.index++]!, current.depth + 1))
    return DESCEND
  }
  return current.copy as Record<string, Json>
}

const ownNames = (target: Obj, boundary: boolean) => keys(target).filter((name) => !(boundary && name === "__proto__"))

/** `JSON.stringify`'s conversion, giving the text. */
export const JsonWalk = nativeKind("JSON.stringify walk", walkStep)

/** The host boundary's conversion, giving host JSON. Its failures are not located: the call that crosses reports them. */
export const BoundaryWalk = kind("Boundary walk", (task, frame: Frame, _node, input) => walkStep(task, frame, input))

/** Host JSON as program values: objects and arrays are copied, primitives pass through. */
export const fromJson = <R>(ctx: Interpreter<R>, value: Json | undefined): Value => {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value))
    return new Arr(
      ctx.builtins.Array,
      value.map((item) => fromJson(ctx, item)),
    )
  const copied = new Obj(ctx.builtins.Object)
  for (const [key, item] of Object.entries(value)) define(copied, key, fromJson(ctx, item))
  return copied
}
