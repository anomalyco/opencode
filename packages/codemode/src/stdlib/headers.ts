import { Effect } from "effect"
import { constructor, methods, prototypeFrom, receiver, requiresNew } from "../interpreter/native.js"
import { typeError } from "../interpreter/model.js"
import { entries, Arr, HeadersObj, Obj } from "../interpreter/objects.js"
import { applyCollectionCallback } from "../interpreter/callback.js"
import { isRuntimeReference } from "../interpreter/references.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { coerceToString } from "./value.js"
import { readPairs } from "./url.js"

// The host validates header names and values and throws its own TypeError; the program gets one of its own.
const attempt = <T>(run: () => T): T => {
  try {
    return run()
  } catch (error) {
    throw typeError(error instanceof Error ? error.message : String(error))
  }
}

const constructHeaders = <R>(ctx: Interpreter<R>, init: unknown, proto: Obj): Effect.Effect<HeadersObj, unknown, R> => {
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
  const self = (thisValue: unknown, name: string) => receiver(HeadersObj, thisValue, `Headers.prototype.${name}`)
  const wrap = (items: Array<unknown>) => new Arr(builtins.Array, items)
  const arg = (args: Array<unknown>, index: number): string => coerceToString(args[index])
  const requireArgs = (name: string, args: Array<unknown>, count: number): void => {
    if (args.length < count) throw typeError(`Headers.${name} requires ${count} argument${count === 1 ? "" : "s"}.`)
  }
  methods(builtins, proto, [
    [
      "append",
      2,
      (thisValue, args) => {
        requireArgs("append", args, 2)
        const target = self(thisValue, "append").headers
        return attempt(() => target.append(arg(args, 0), arg(args, 1)))
      },
    ],
    [
      "delete",
      1,
      (thisValue, args) => {
        requireArgs("delete", args, 1)
        const target = self(thisValue, "delete").headers
        return attempt(() => target.delete(arg(args, 0)))
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
        return attempt(() => target.set(arg(args, 0), arg(args, 1)))
      },
    ],
    ["keys", 0, (thisValue) => wrap(Array.from(self(thisValue, "keys").headers.keys()))],
    ["values", 0, (thisValue) => wrap(Array.from(self(thisValue, "values").headers.values()))],
    [
      "entries",
      0,
      (thisValue) =>
        wrap(Array.from(self(thisValue, "entries").headers.entries(), ([key, value]) => wrap([key, value]))),
    ],
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
  return headers
}
