import { Effect } from "effect"
import { toProgram, ToolRuntimeError } from "../data.js"
import type { Builtins } from "../interpreter/intrinsics.js"
import { constructor, fn, type Method, methods, prototypeFrom, receiver, requiresNew } from "../interpreter/native.js"
import { PendingThrow, typeError, uriError } from "../interpreter/model.js"
import { defineAccessor, entries, isWrapper, Arr, Obj, URLObj, URLSearchParamsObj } from "../interpreter/objects.js"
import { isRuntimeReference } from "../interpreter/references.js"
import { applyCollectionCallback, preserveConsumerError } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { coerceToString } from "./value.js"

const urlProperties = [
  "href",
  "origin",
  "protocol",
  "username",
  "password",
  "host",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
] as const

export const uriArgument = (builtins: Builtins, value: unknown, label: string): string =>
  coerceToString(toProgram(builtins, value, label))

type UriFunction = "encodeURI" | "encodeURIComponent" | "decodeURI" | "decodeURIComponent"

const uriFunctions: Record<UriFunction, (value: string) => string> = {
  encodeURI,
  encodeURIComponent,
  decodeURI,
  decodeURIComponent,
}

export const uriGlobal = <R>(ctx: Interpreter<R>, name: UriFunction) =>
  fn<R>(ctx.builtins, name, 1, (_, args) => {
    const value = uriArgument(ctx.builtins, args[0], `${name} input`)
    try {
      return uriFunctions[name](value)
    } catch (error) {
      throw uriError(`${name} received malformed URI data: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

const urlArgument = (builtins: Builtins, value: unknown, label: string): string =>
  value instanceof URLObj ? value.url.href : uriArgument(builtins, value, label)

export const urlGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.URL
  const construct = (args: Array<unknown>, into: Obj): URLObj => {
    if (args.length === 0) {
      throw typeError("new URL(...) requires a URL string and an optional base URL.")
    }
    const input = urlArgument(builtins, args[0], "new URL input")
    const base = args[1] === undefined ? undefined : urlArgument(builtins, args[1], "new URL base")
    try {
      return new URLObj(into, builtins.URLSearchParams, new URL(input, base))
    } catch {
      throw typeError(`new URL(...) received an invalid URL${base === undefined ? "" : " or base URL"}.`)
    }
  }
  const url = constructor<R>(builtins, proto, {
    name: "URL",
    length: 1,
    call: requiresNew("URL"),
    construct: (args, newTarget) => Effect.sync(() => construct(args, prototypeFrom(newTarget, proto))),
  })
  const parse = (name: "canParse" | "parse"): Method => [
    name,
    1,
    (_, args) => {
      if (args.length === 0) throw typeError(`URL.${name} requires a URL argument.`)
      const input = urlArgument(builtins, args[0], `URL.${name} input`)
      const base = args[1] === undefined ? undefined : urlArgument(builtins, args[1], `URL.${name} base`)
      try {
        const parsed = new URL(input, base)
        return name === "canParse" ? true : new URLObj(proto, builtins.URLSearchParams, parsed)
      } catch {
        return name === "canParse" ? false : null
      }
    },
  ]
  methods(builtins, url, [parse("canParse"), parse("parse")])

  const self = (thisValue: unknown, name: string) => receiver(URLObj, thisValue, `URL.prototype.${name}`)
  for (const name of urlProperties) {
    defineAccessor(
      proto,
      name,
      (thisValue) => self(thisValue, name).url[name],
      name === "origin"
        ? undefined
        : (thisValue, value) => {
            const target = self(thisValue, name)
            try {
              ;(target.url as unknown as Record<string, string>)[name] = uriArgument(
                builtins,
                value,
                `URL.${name} value`,
              )
            } catch (error) {
              if (error instanceof PendingThrow || error instanceof ToolRuntimeError) throw error
              throw typeError(`URL.${name} received an invalid value.`)
            }
          },
    )
  }
  defineAccessor(proto, "searchParams", (thisValue) => self(thisValue, "searchParams").searchParams)
  methods(builtins, proto, [
    ["toString", 0, (thisValue) => self(thisValue, "toString").url.href],
    ["toJSON", 0, (thisValue) => self(thisValue, "toJSON").url.href],
  ])
  return url
}

const readPair = <R>(ctx: Interpreter<R>, value: unknown): Effect.Effect<Array<string>, unknown, R> =>
  Effect.gen(function* () {
    const cursor = yield* ctx.iterate(value)
    if (cursor === undefined) {
      throw typeError("new URLSearchParams(...) expects iterable [name, value] pairs.")
    }
    const items: Array<string> = []
    while (true) {
      const step = yield* cursor.next
      if (step.done) return items
      items.push(
        yield* preserveConsumerError(
          cursor,
          Effect.sync(() => uriArgument(ctx.builtins, step.value, "URLSearchParams pair value")),
        ),
      )
    }
  })

const constructURLSearchParams = <R>(
  ctx: Interpreter<R>,
  init: unknown,
  proto: Obj,
): Effect.Effect<URLSearchParamsObj, unknown, R> => {
  const wrap = (params: URLSearchParams) => new URLSearchParamsObj(proto, params)
  if (init === undefined) return Effect.succeed(wrap(new URLSearchParams()))
  if (init instanceof URLSearchParamsObj) return Effect.succeed(wrap(new URLSearchParams(init.params)))
  if (typeof init === "string") return Effect.succeed(wrap(new URLSearchParams(init)))
  if (init === null || typeof init === "number" || typeof init === "boolean") {
    return Effect.succeed(wrap(new URLSearchParams(coerceToString(init))))
  }
  return Effect.gen(function* () {
    const cursor = yield* ctx.iterate(init)
    if (cursor !== undefined) {
      const pairs: Array<Array<string>> = []
      while (true) {
        const step = yield* cursor.next
        if (step.done) {
          if (pairs.some((entry) => entry.length !== 2)) {
            throw typeError("new URLSearchParams(...) expects iterable [name, value] pairs.")
          }
          return wrap(new URLSearchParams(pairs.map((entry): [string, string] => [entry[0] ?? "", entry[1] ?? ""])))
        }
        pairs.push(yield* preserveConsumerError(cursor, readPair(ctx, step.value)))
      }
    }
    if (isRuntimeReference(init)) {
      throw typeError("new URLSearchParams(...) expects a query string, data object, or synchronous iterable pairs.")
    }
    if (isWrapper(init)) return wrap(new URLSearchParams())
    if (!(init instanceof Obj)) {
      throw typeError(
        "new URLSearchParams(...) expects a query string, data object, iterable pairs, or URLSearchParams.",
      )
    }
    return wrap(
      new URLSearchParams(Object.fromEntries(entries(init).map(([key, value]) => [key, coerceToString(value)]))),
    )
  })
}

export const urlSearchParamsGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.URLSearchParams
  const searchParams = constructor<R>(builtins, proto, {
    name: "URLSearchParams",
    call: requiresNew("URLSearchParams"),
    construct: (args, newTarget) => constructURLSearchParams(ctx, args[0], prototypeFrom(newTarget, proto)),
  })
  const self = (thisValue: unknown, name: string) =>
    receiver(URLSearchParamsObj, thisValue, `URLSearchParams.prototype.${name}`)
  const wrap = (items: Array<unknown>) => new Arr(builtins.Array, items)
  const arg = (name: string, args: Array<unknown>, index: number): string =>
    uriArgument(builtins, args[index], `URLSearchParams.${name} argument ${index + 1}`)
  const requireArgs = (name: string, args: Array<unknown>, count: number): void => {
    if (args.length < count) {
      throw typeError(`URLSearchParams.${name} requires ${count} argument${count === 1 ? "" : "s"}.`)
    }
  }
  defineAccessor(proto, "size", (thisValue) => self(thisValue, "size").params.size)
  methods(builtins, proto, [
    [
      "append",
      2,
      (thisValue, args) => {
        requireArgs("append", args, 2)
        self(thisValue, "append").params.append(arg("append", args, 0), arg("append", args, 1))
        return undefined
      },
    ],
    [
      "delete",
      1,
      (thisValue, args) => {
        requireArgs("delete", args, 1)
        const params = self(thisValue, "delete").params
        if (args[1] !== undefined) params.delete(arg("delete", args, 0), arg("delete", args, 1))
        else params.delete(arg("delete", args, 0))
        return undefined
      },
    ],
    [
      "get",
      1,
      (thisValue, args) => {
        requireArgs("get", args, 1)
        return self(thisValue, "get").params.get(arg("get", args, 0))
      },
    ],
    [
      "getAll",
      1,
      (thisValue, args) => {
        requireArgs("getAll", args, 1)
        return wrap(self(thisValue, "getAll").params.getAll(arg("getAll", args, 0)))
      },
    ],
    [
      "has",
      1,
      (thisValue, args) => {
        requireArgs("has", args, 1)
        const params = self(thisValue, "has").params
        return args[1] !== undefined
          ? params.has(arg("has", args, 0), arg("has", args, 1))
          : params.has(arg("has", args, 0))
      },
    ],
    [
      "set",
      2,
      (thisValue, args) => {
        requireArgs("set", args, 2)
        self(thisValue, "set").params.set(arg("set", args, 0), arg("set", args, 1))
        return undefined
      },
    ],
    [
      "sort",
      0,
      (thisValue) => {
        self(thisValue, "sort").params.sort()
        return undefined
      },
    ],
    ["keys", 0, (thisValue) => wrap(Array.from(self(thisValue, "keys").params.keys()))],
    ["values", 0, (thisValue) => wrap(Array.from(self(thisValue, "values").params.values()))],
    [
      "entries",
      0,
      (thisValue) =>
        wrap(Array.from(self(thisValue, "entries").params.entries(), ([key, value]) => wrap([key, value]))),
    ],
    ["toString", 0, (thisValue) => self(thisValue, "toString").params.toString()],
    [
      "forEach",
      1,
      (thisValue, args) => {
        requireArgs("forEach", args, 1)
        const target = self(thisValue, "forEach")
        const apply = applyCollectionCallback(ctx, args[0], "URLSearchParams.forEach")
        return Effect.gen(function* () {
          for (const [key, value] of Array.from(target.params.entries())) yield* apply([value, key, target])
          return undefined
        })
      },
    ],
  ])
  return searchParams
}
