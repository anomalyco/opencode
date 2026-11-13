import { Invoke } from "../runtime/signals.js"
import {
  constructor,
  fn,
  type Method,
  methods,
  prototypeFrom,
  receiver,
  requiresNew,
  iteratorMethods,
} from "../runtime/native.js"
import { IteratorSymbol, PendingThrow, typeError, uriError } from "../runtime/model.js"
import {
  define,
  defineAccessor,
  entries,
  get,
  hidden,
  Arr,
  Obj,
  URLObj,
  URLSearchParamsObj,
  HeadersObj,
  type Callable,
  coerceToString,
  isRuntimeReference,
  type Value,
} from "../runtime/objects.js"
import { requireCallback } from "../runtime/callback.js"
import type { Interpreter } from "../runtime/interpreter.js"

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
  fn(ctx.builtins, name, 1, (_, args) => {
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
  const url = constructor(builtins, proto, {
    name: "URL",
    length: 1,
    call: requiresNew("URL"),
    construct: (args, newTarget) => construct(args, prototypeFrom(newTarget, proto)),
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
              target.url[name] = coerceToString(value)
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

/** What `readPairs` builds from `[name, value]` pairs, or from a record of names to values when `init` is no iterable. */
export type PairsInto = { readonly kind: "Headers" | "URLSearchParams"; readonly proto: Obj }

/**
 * Reads a synchronous iterable of `[name, value]` pairs as strings (in the prelude), then builds `into` from them; a
 * record of names to values when `init` is not iterable. As in WebIDL, the whole sequence is converted before any
 * pair's length is checked.
 */
export const readPairs = <R>(ctx: Interpreter<R>, init: Value, label: string, into: PairsInto) =>
  new Invoke(ctx.prelude.fn("readPairs"), undefined, [init, label, into.kind, into.proto], undefined)

/** What `readPairs` makes of the pairs it read (an array of arrays of strings), or of a record. */
export const buildPairs = (into: PairsInto, value: Value, label: string): Value => {
  if (!(value instanceof Arr)) return fromRecord(into, value)
  const pairs = value.items.map((pair) => (pair as Arr).items as Array<string>)
  if (pairs.some((entry) => entry.length !== 2)) throw typeError(`${label} expects iterable [name, value] pairs.`)
  if (into.kind === "URLSearchParams") {
    return new URLSearchParamsObj(into.proto, new URLSearchParams(pairs as Array<[string, string]>))
  }
  return new HeadersObj(
    into.proto,
    attempt(() => new Headers(pairs as Array<[string, string]>)),
  )
}

const fromRecord = (into: PairsInto, init: Value): Value => {
  if (into.kind === "Headers") {
    if (!(init instanceof Obj) || isRuntimeReference(init)) {
      throw typeError("new Headers(...) expects a record of names to values, iterable [name, value] pairs, or Headers.")
    }
    return new HeadersObj(
      into.proto,
      attempt(() => new Headers(Object.fromEntries(entries(init).map(([key, value]) => [key, coerceToString(value)])))),
    )
  }
  if (isRuntimeReference(init)) {
    throw typeError("new URLSearchParams(...) expects a query string, data object, or synchronous iterable pairs.")
  }
  if (!(init instanceof Obj)) {
    throw typeError("new URLSearchParams(...) expects a query string, data object, iterable pairs, or URLSearchParams.")
  }
  return new URLSearchParamsObj(
    into.proto,
    new URLSearchParams(Object.fromEntries(entries(init).map(([key, value]) => [key, coerceToString(value)]))),
  )
}

/** The host validates header names and values and throws its own TypeError; the program gets one of its own. */
export const attempt = <T>(run: () => T): T => {
  try {
    return run()
  } catch (error) {
    throw typeError(error instanceof Error ? error.message : String(error))
  }
}

/** Headers and URLSearchParams `forEach`: the callback sees each `[name, value]` pair as listed when it started. */
export const pairsForEach = <R>(
  ctx: Interpreter<R>,
  target: Value,
  pairs: Array<[string, string]>,
  callback: Callable,
  thisArg: Value,
) => {
  const list = new Arr(
    ctx.builtins.Array,
    pairs.map((pair) => new Arr(ctx.builtins.Array, pair)),
  )
  return new Invoke(ctx.prelude.fn("pairsForEach"), undefined, [target, list, callback, thisArg], undefined)
}

const constructURLSearchParams = <R>(ctx: Interpreter<R>, init: Value, proto: Obj) => {
  const wrap = (params: URLSearchParams) => new URLSearchParamsObj(proto, params)
  if (init === undefined) return wrap(new URLSearchParams())
  if (init instanceof URLSearchParamsObj) return wrap(new URLSearchParams(init.params))
  if (typeof init === "string") return wrap(new URLSearchParams(init))
  if (init === null || typeof init === "number" || typeof init === "boolean") {
    return wrap(new URLSearchParams(coerceToString(init)))
  }
  return readPairs(ctx, init, "new URLSearchParams(...)", { kind: "URLSearchParams", proto })
}

export const urlSearchParamsGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.URLSearchParams
  const searchParams = constructor(builtins, proto, {
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
    ...iteratorMethods(builtins, self),
    ["toString", 0, (thisValue) => self(thisValue, "toString").params.toString()],
    [
      "forEach",
      1,
      (thisValue, args) => {
        requireArgs("forEach", args, 1)
        const target = self(thisValue, "forEach")
        const callback = requireCallback(args[0], "URLSearchParams.forEach")
        return pairsForEach(ctx, target, Array.from(target.params.entries()), callback, args[1])
      },
    ],
  ])
  define(proto, IteratorSymbol, get(proto, "entries"), hidden)
  return searchParams
}
