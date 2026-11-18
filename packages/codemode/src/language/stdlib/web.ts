import { fn, methods } from "../runtime/native.js"
import { rangeError, typeError } from "../runtime/model.js"
import {
  define,
  entries,
  get,
  getOwn,
  hasOwn,
  hidden,
  isRuntimeReference,
  Arr,
  ArrayBufferObj,
  DataViewObj,
  TypedArrayObj,
  typedArrayKinds,
  DateObj,
  ErrorObj,
  HostNamespace,
  MapObj,
  Obj,
  RegExpObj,
  SetObj,
  WeakMapObj,
  WeakSetObj,
  coerceToString,
  type Value,
} from "../runtime/objects.js"
import { createErrorValue, isErrorType } from "../runtime/intrinsics.js"
import { describeValue } from "../runtime/references.js"
import type { Interpreter } from "../runtime/interpreter.js"
import { makeTyped } from "./bytes.js"

// WebIDL DOMString conversion: a missing argument is a TypeError, anything else stringifies. Invalid input is a
// TypeError as well; browsers throw a DOMException named InvalidCharacterError, which CodeMode does not have.
export const base64Global = <R>(ctx: Interpreter<R>, name: "atob" | "btoa") =>
  fn(ctx.builtins, name, 1, (_, args) => {
    if (args.length === 0) throw typeError(`${name} requires 1 argument (a string)`)
    const input = coerceToString(args[0])
    try {
      return name === "atob" ? atob(input) : btoa(input)
    } catch {
      throw typeError("The string contains invalid characters.")
    }
  })

// HTML structured clone over CodeMode's data kinds. Shared references survive through the memo; prototypes and
// frozen state do not, as in JS. Without a DOMException, DataCloneError is a TypeError carrying that prefix.
export const structuredCloneGlobal = <R>(ctx: Interpreter<R>) =>
  fn(ctx.builtins, "structuredClone", 1, (_, args) => {
    if (args.length === 0) throw typeError("structuredClone requires 1 argument")
    const builtins = ctx.builtins
    const memo = new Map<Obj, Obj>()
    const clone = (value: Value): Value => {
      if (typeof value === "symbol" || value instanceof HostNamespace) {
        throw typeError(`DataCloneError: ${describeValue(value)} could not be cloned.`)
      }
      if (!(value instanceof Obj)) return value
      const seen = memo.get(value)
      if (seen !== undefined) return seen
      const remember = <T extends Obj>(copy: T): T => {
        memo.set(value, copy)
        return copy
      }
      if (value instanceof MapObj) {
        const copy = remember(new MapObj(builtins.Map))
        for (const [key, item] of value.map) copy.map.set(clone(key), clone(item))
        return copy
      }
      if (value instanceof SetObj) {
        const copy = remember(new SetObj(builtins.Set))
        for (const item of value.set.liveKeys()) copy.set.add(clone(item))
        return copy
      }
      if (value instanceof DateObj) return remember(new DateObj(builtins.Date, value.time))
      if (value instanceof RegExpObj) {
        return remember(new RegExpObj(builtins.RegExp, value.source, value.flags))
      }
      // A view's clone is over a clone of its whole buffer, so views sharing a buffer share the cloned one.
      if (value instanceof ArrayBufferObj) {
        return remember(new ArrayBufferObj(builtins.ArrayBuffer, value.buffer.slice(0)))
      }
      if (value instanceof TypedArrayObj) {
        const buffer = clone(value.bufferObj(builtins.ArrayBuffer)) as ArrayBufferObj
        const array = value.array
        const copy = new typedArrayKinds[value.kind](buffer.buffer, array.byteOffset, array.length)
        return remember(makeTyped(builtins[value.kind], copy, buffer))
      }
      if (value instanceof DataViewObj) {
        const buffer = clone(value.buffer) as ArrayBufferObj
        const view = new DataView(buffer.buffer, value.view.byteOffset, value.view.byteLength)
        return remember(new DataViewObj(builtins.DataView, view, buffer))
      }
      if (value instanceof ErrorObj) {
        const name = get(value, "name")
        const message = get(value, "message")
        const copy = remember(
          createErrorValue(
            builtins[typeof name === "string" && isErrorType(name) ? name : "Error"],
            message === undefined ? undefined : coerceToString(message),
          ),
        )
        const stack = getOwn(value, "stack")
        if (typeof stack === "string") define(copy, "stack", stack, hidden)
        if (hasOwn(value, "cause")) define(copy, "cause", clone(getOwn(value, "cause")), hidden)
        return copy
      }
      if (isRuntimeReference(value) || value instanceof WeakMapObj || value instanceof WeakSetObj) {
        throw typeError(`DataCloneError: ${describeValue(value)} could not be cloned.`)
      }
      const copy = remember(
        value instanceof Arr ? new Arr(builtins.Array, new Array(value.items.length)) : new Obj(builtins.Object),
      )
      for (const [key, item] of entries(value)) define(copy, key, clone(item))
      return copy
    }
    return clone(args[0])
  })

export const cryptoGlobal = <R>(ctx: Interpreter<R>) => {
  const object = new Obj(ctx.builtins.Object)
  methods(ctx.builtins, object, [
    ["randomUUID", 0, () => crypto.randomUUID()],
    [
      "getRandomValues",
      1,
      (_, args) => {
        const target = args[0]
        if (!(target instanceof TypedArrayObj) || target.kind === "Float32Array" || target.kind === "Float64Array") {
          throw typeError(`crypto.getRandomValues expects an integer typed array, received ${describeValue(target)}.`)
        }
        if (target.array.byteLength > 65_536) {
          throw rangeError(`crypto.getRandomValues: ${target.array.byteLength} bytes is more than the 65536 allowed.`)
        }
        crypto.getRandomValues(target.array)
        return args[0]
      },
    ],
  ])
  return object
}
