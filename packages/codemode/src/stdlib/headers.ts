import { constructor, methods, prototypeFrom, receiver, requiresNew } from "../interpreter/native.js"
import { IteratorSymbol, typeError } from "../interpreter/model.js"
import {
  define,
  get,
  hidden,
  Arr,
  HeadersObj,
  positionIterator,
  Obj,
  coerceToString,
  type Value,
} from "../interpreter/objects.js"
import { requireCallback } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { attempt, pairsForEach, readPairs } from "./url.js"

const constructHeaders = (init: Value, proto: Obj) => {
  if (init === undefined) return new HeadersObj(proto, new Headers())
  if (init instanceof Obj) return readPairs(init, "new Headers(...)", { kind: "Headers", proto })
  throw typeError("new Headers(...) expects a record of names to values, iterable [name, value] pairs, or Headers.")
}

export const headersGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Headers
  const headers = constructor(builtins, proto, {
    name: "Headers",
    call: requiresNew("Headers"),
    construct: (args, newTarget) => constructHeaders(args[0], prototypeFrom(newTarget, proto)),
  })
  const self = (thisValue: Value, name: string) => receiver(HeadersObj, thisValue, `Headers.prototype.${name}`)
  const wrap = (items: Array<Value>) => new Arr(builtins.Array, items)
  const arg = (args: Array<Value>, index: number): string => coerceToString(args[index])
  const requireArgs = (name: string, args: Array<Value>, count: number): void => {
    if (args.length < count) throw typeError(`Headers.${name} requires ${count} argument${count === 1 ? "" : "s"}.`)
  }
  methods(builtins, proto, [
    [
      "append",
      2,
      (thisValue, args) => {
        requireArgs("append", args, 2)
        const target = self(thisValue, "append").headers
        attempt(() => target.append(arg(args, 0), arg(args, 1)))
        return undefined
      },
    ],
    [
      "delete",
      1,
      (thisValue, args) => {
        requireArgs("delete", args, 1)
        const target = self(thisValue, "delete").headers
        attempt(() => target.delete(arg(args, 0)))
        return undefined
      },
    ],
    [
      "get",
      1,
      (thisValue, args) => {
        requireArgs("get", args, 1)
        const target = self(thisValue, "get").headers
        return attempt(() => target.get(arg(args, 0)))
      },
    ],
    ["getSetCookie", 0, (thisValue) => wrap(self(thisValue, "getSetCookie").headers.getSetCookie())],
    [
      "has",
      1,
      (thisValue, args) => {
        requireArgs("has", args, 1)
        const target = self(thisValue, "has").headers
        return attempt(() => target.has(arg(args, 0)))
      },
    ],
    [
      "set",
      2,
      (thisValue, args) => {
        requireArgs("set", args, 2)
        const target = self(thisValue, "set").headers
        attempt(() => target.set(arg(args, 0), arg(args, 1)))
        return undefined
      },
    ],
    ["keys", 0, (thisValue) => positionIterator(builtins, self(thisValue, "keys"), "keys")],
    ["values", 0, (thisValue) => positionIterator(builtins, self(thisValue, "values"), "values")],
    ["entries", 0, (thisValue) => positionIterator(builtins, self(thisValue, "entries"), "entries")],
    [
      "forEach",
      1,
      (thisValue, args) => {
        requireArgs("forEach", args, 1)
        const target = self(thisValue, "forEach")
        const callback = requireCallback(args[0], "Headers.forEach")
        return pairsForEach(target, Array.from(target.headers.entries()), callback, args[1])
      },
    ],
  ])
  define(proto, IteratorSymbol, get(proto, "entries"), hidden)
  return headers
}
