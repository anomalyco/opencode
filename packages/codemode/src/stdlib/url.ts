import { Effect } from "effect"
import { constructor, fn, type Method, methods, prototypeFrom, receiver, requiresNew } from "../interpreter/native.js"
import { IteratorSymbol, PendingThrow, typeError, uriError } from "../interpreter/model.js"
import {
  define,
  defineAccessor,
  entries,
  get,
  hidden,
  Arr,
  hostIterator,
  Obj,
  URLObj,
  URLSearchParamsObj,
  coerceToString,
  isRuntimeReference,
  type Value,
} from "../interpreter/objects.js"
import { applyCollectionCallback, preserveConsumerError } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"

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

type UriFunction = "encodeURI" | "encodeURIComponent" | "decodeURI" | "decodeURIComponent"

const uriFunctions: Record<UriFunction, (value: string) => string> = {
  encodeURI,
  encodeURIComponent,
  decodeURI,
  decodeURIComponent,
}

export const uriGlobal = <R>(ctx: Interpreter<R>, name: UriFunction) =>
  fn<R>(ctx.builtins, name, 1, (_, args) => {
    const value = coerceToString(args[0])
    try {
      return uriFunctions[name](value)
    } catch (error) {
      throw uriError(`${name} received malformed URI data: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

const urlArgument = (value: Value): string => (value instanceof URLObj ? value.url.href : coerceToString(value))

export const urlGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.URL
  const construct = (args: Array<Value>, into: Obj): URLObj => {
    if (args.length === 0) {
      throw typeError("new URL(...) requires a URL string and an optional base URL.")
    }
    const input = urlArgument(args[0])
    const base = args[1] === undefined ? undefined : urlArgument(args[1])
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
      const input = urlArgument(args[0])
      const base = args[1] === undefined ? undefined : urlArgument(args[1])
      try {
        const parsed = new URL(input, base)
        return name === "canParse" ? true : new URLObj(proto, builtins.URLSearchParams, parsed)
      } catch {
        return name === "canParse" ? false : null
      }
    },
  ]
  methods(builtins, url, [parse("canParse"), parse("parse")])

  const self = (thisValue: Value, name: string) => receiver(URLObj, thisValue, `URL.prototype.${name}`)
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
              ;(target.url as unknown as Record<string, string>)[name] = coerceToString(value)
            } catch (error) {
              if (error instanceof PendingThrow) throw error
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

const readPair = <R>(ctx: Interpreter<R>, value: Value, label: string): Effect.Effect<Array<string>, unknown, R> =>
  Effect.gen(function* () {
    const cursor = yield* ctx.iterate(value)
    if (cursor === undefined) throw typeError(`${label} expects iterable [name, value] pairs.`)
    const items: Array<string> = []
    while (true) {
      const step = yield* cursor.next
      if (step.done) return items
      items.push(
        yield* preserveConsumerError(
          cursor.close,
          Effect.sync(() => coerceToString(step.value)),
        ),
      )
    }
  })

/**
 * Reads a synchronous iterable of `[name, value]` pairs as strings; `undefined` when `init` is not iterable. As in
 * WebIDL, the whole sequence is converted before any pair's length is checked.
 */
export const readPairs = <R>(
  ctx: Interpreter<R>,
  init: Value,
  label: string,
): Effect.Effect<Array<[string, string]> | undefined, unknown, R> =>
  Effect.gen(function* () {
    const cursor = yield* ctx.iterate(init)
    if (cursor === undefined) return undefined
    const pairs: Array<Array<string>> = []
    while (true) {
      const step = yield* cursor.next
      if (step.done) {
        if (pairs.some((entry) => entry.length !== 2)) throw typeError(`${label} expects iterable [name, value] pairs.`)
        return pairs as Array<[string, string]>
      }
      pairs.push(yield* preserveConsumerError(cursor.close, readPair(ctx, step.value, label)))
    }
  })

const constructURLSearchParams = <R>(
  ctx: Interpreter<R>,
  init: Value,
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
    const pairs = yield* readPairs(ctx, init, "new URLSearchParams(...)")
    if (pairs !== undefined) return wrap(new URLSearchParams(pairs))
    if (isRuntimeReference(init)) {
      throw typeError("new URLSearchParams(...) expects a query string, data object, or synchronous iterable pairs.")
    }
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
  const self = (thisValue: Value, name: string) =>
    receiver(URLSearchParamsObj, thisValue, `URLSearchParams.prototype.${name}`)
  const wrap = (items: Array<Value>) => new Arr(builtins.Array, items)
  const arg = (args: Array<Value>, index: number): string => coerceToString(args[index])
  const requireArgs = (name: string, args: Array<Value>, count: number): void => {
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
        self(thisValue, "append").params.append(arg(args, 0), arg(args, 1))
        return undefined
      },
    ],
    [
      "delete",
      1,
      (thisValue, args) => {
        requireArgs("delete", args, 1)
        const params = self(thisValue, "delete").params
        if (args[1] !== undefined) params.delete(arg(args, 0), arg(args, 1))
        else params.delete(arg(args, 0))
        return undefined
      },
    ],
    [
      "get",
      1,
      (thisValue, args) => {
        requireArgs("get", args, 1)
        return self(thisValue, "get").params.get(arg(args, 0))
      },
    ],
    [
      "getAll",
      1,
      (thisValue, args) => {
        requireArgs("getAll", args, 1)
        return wrap(self(thisValue, "getAll").params.getAll(arg(args, 0)))
      },
    ],
    [
      "has",
      1,
      (thisValue, args) => {
        requireArgs("has", args, 1)
        const params = self(thisValue, "has").params
        return args[1] !== undefined ? params.has(arg(args, 0), arg(args, 1)) : params.has(arg(args, 0))
      },
    ],
    [
      "set",
      2,
      (thisValue, args) => {
        requireArgs("set", args, 2)
        self(thisValue, "set").params.set(arg(args, 0), arg(args, 1))
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
    ["keys", 0, (thisValue) => hostIterator(builtins, self(thisValue, "keys").params.keys())],
    ["values", 0, (thisValue) => hostIterator(builtins, self(thisValue, "values").params.values())],
    ["entries", 0, (thisValue) => hostIterator(builtins, self(thisValue, "entries").iterator(builtins))],
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
  define(proto, IteratorSymbol, get(proto, "entries"), hidden)
  return searchParams
}
