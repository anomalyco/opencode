import { fn, methods } from "../interpreter/native.js"
import { typeError } from "../interpreter/model.js"
import {
  define,
  entries,
  get,
  getOwn,
  hasOwn,
  hidden,
  isRuntimeReference,
  Arr,
  Bytes,
  DateObj,
  ErrorObj,
  MapObj,
  Obj,
  RegExpObj,
  SetObj,
  coerceToString,
  type Value,
} from "../interpreter/objects.js"
import { createErrorValue, isErrorType } from "../interpreter/intrinsics.js"
import { describeValue } from "../interpreter/references.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { ToolReference } from "../tool-runtime.js"

// WebIDL DOMString conversion: a missing argument is a TypeError, anything else stringifies. Invalid input is a
// TypeError as well; browsers throw a DOMException named InvalidCharacterError, which CodeMode does not have.
export const base64Global = <R>(ctx: Interpreter<R>, name: "atob" | "btoa") =>
  fn<R>(ctx.builtins, name, 1, (_, args) => {
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
  fn<R>(ctx.builtins, "structuredClone", 1, (_, args) => {
    if (args.length === 0) throw typeError("structuredClone requires 1 argument")
    const builtins = ctx.builtins
    const memo = new Map<Obj, Obj>()
    const clone = (value: Value): Value => {
      if (typeof value === "symbol" || value instanceof ToolReference) {
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
        for (const item of value.set) copy.set.add(clone(item))
        return copy
      }
      if (value instanceof DateObj) return remember(new DateObj(builtins.Date, value.time))
      if (value instanceof RegExpObj) {
        return remember(new RegExpObj(builtins.RegExp, value.regex.source, value.regex.flags))
      }
      if (value instanceof Bytes) return remember(new Bytes(builtins.Uint8Array, new Uint8Array(value.bytes)))
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
      if (isRuntimeReference(value)) throw typeError(`DataCloneError: ${describeValue(value)} could not be cloned.`)
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
        if (!(args[0] instanceof Bytes)) {
          throw typeError(`crypto.getRandomValues expects a Uint8Array, received ${describeValue(args[0])}.`)
        }
        crypto.getRandomValues(args[0].bytes)
        return args[0]
      },
    ],
  ])
  return object
}
