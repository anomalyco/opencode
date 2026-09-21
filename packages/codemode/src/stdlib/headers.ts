import { Effect } from "effect"
import { constructor, methods, prototypeFrom, receiver, requiresNew } from "../interpreter/native.js"
import { IteratorSymbol, typeError } from "../interpreter/model.js"
import {
  define,
  entries,
  get,
  hidden,
  Arr,
  HeadersObj,
  IteratorObj,
  Obj,
  coerceToString,
  isRuntimeReference,
  type Value,
} from "../interpreter/objects.js"
import { applyCollectionCallback } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { readPairs } from "./url.js"

// The host validates header names and values and throws its own TypeError; the program gets one of its own.
const attempt = <T>(run: () => T): T => {
  try {
    return run()
  } catch (error) {
    throw typeError(error instanceof Error ? error.message : String(error))
  }
}

const constructHeaders = <R>(ctx: Interpreter<R>, init: Value, proto: Obj): Effect.Effect<HeadersObj, unknown, R> => {
  const wrap = (headers: Headers) => new HeadersObj(proto, headers)
  if (init === undefined) return Effect.succeed(wrap(new Headers()))
  return Effect.gen(function* () {
    const pairs = init instanceof Obj ? yield* readPairs(ctx, init, "new Headers(...)") : undefined
    if (pairs !== undefined) return wrap(attempt(() => new Headers(pairs)))
    if (!(init instanceof Obj) || isRuntimeReference(init)) {
      throw typeError("new Headers(...) expects a record of names to values, iterable [name, value] pairs, or Headers.")
    }
    return wrap(
      attempt(() => new Headers(Object.fromEntries(entries(init).map(([key, value]) => [key, coerceToString(value)])))),
    )
  })
}

export const headersGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Headers
  const headers = constructor<R>(builtins, proto, {
    name: "Headers",
    call: requiresNew("Headers"),
    construct: (args, newTarget) => constructHeaders(ctx, args[0], prototypeFrom(newTarget, proto)),
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
    // Iterator.from because Bun's Headers typings predate iterator helpers; the runtime iterators already have them.
    [
      "keys",
      0,
      (thisValue) => new IteratorObj(builtins.Iterator, Iterator.from(self(thisValue, "keys").headers.keys())),
    ],
    [
      "values",
      0,
      (thisValue) => new IteratorObj(builtins.Iterator, Iterator.from(self(thisValue, "values").headers.values())),
    ],
    ["entries", 0, (thisValue) => new IteratorObj(builtins.Iterator, self(thisValue, "entries").iterator(builtins))],
    [
      "forEach",
      1,
      (thisValue, args) => {
        requireArgs("forEach", args, 1)
        const target = self(thisValue, "forEach")
        const apply = applyCollectionCallback(ctx, args[0], "Headers.forEach")
        return Effect.gen(function* () {
          for (const [key, value] of Array.from(target.headers.entries())) yield* apply([value, key, target])
          return undefined
        })
      },
    ],
  ])
  define(proto, IteratorSymbol, get(proto, "entries"), hidden)
  return headers
}
