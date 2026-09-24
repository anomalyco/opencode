import { Effect } from "effect"
import type { Value } from "./objects.js"
import { arrayGlobal } from "../stdlib/array.js"
import { textDecoderGlobal, textEncoderGlobal, uint8ArrayGlobal } from "../stdlib/bytes.js"
import { mapGlobal, setGlobal } from "../stdlib/collections.js"
import { consoleGlobal } from "../stdlib/console.js"
import { dateGlobal } from "../stdlib/date.js"
import { jsonGlobal } from "../stdlib/json.js"
import { mathGlobal } from "../stdlib/math.js"
import { booleanGlobal, numberGlobal } from "../stdlib/number.js"
import { objectGlobal } from "../stdlib/object.js"
import { regexpGlobal } from "../stdlib/regexp.js"
import { stringGlobal } from "../stdlib/string.js"
import { uriGlobal, urlGlobal, urlSearchParamsGlobal } from "../stdlib/url.js"
import { headersGlobal } from "../stdlib/headers.js"
import { iteratorGlobals } from "../stdlib/iterator.js"
import { coercion } from "../stdlib/value.js"
import { base64Global, cryptoGlobal, structuredCloneGlobal } from "../stdlib/web.js"
import { ToolReference } from "../tool-runtime.js"
import { errorGlobal } from "./errors.js"
import { errorTypes } from "./intrinsics.js"
import { constants, constructor, native } from "./native.js"
import { AsyncIteratorSymbol, IteratorSymbol, typeError } from "./model.js"
import { generatorGlobals } from "./generators.js"
import { promiseGlobal } from "./promises.js"
import type { Interpreter } from "./interpreter.js"

// Function.prototype.constructor exists so `fn.constructor === Function` holds; dynamic code is unsupported.
const functionGlobal = <R>(ctx: Interpreter<R>) => {
  const reject = () =>
    Effect.sync(() => {
      throw typeError("The Function constructor is not supported; write the function inline.")
    })
  return constructor<R>(ctx.builtins, ctx.builtins.Function, {
    name: "Function",
    length: 1,
    call: reject,
    construct: reject,
  })
}

const symbolGlobal = <R>(ctx: Interpreter<R>) => {
  const symbol = native<R>(ctx.builtins, {
    name: "Symbol",
    call: () =>
      Effect.sync(() => {
        throw typeError("Symbol is not callable; only Symbol.asyncIterator and Symbol.iterator are available.")
      }),
    callback: false,
  })
  constants(symbol, { asyncIterator: AsyncIteratorSymbol, iterator: IteratorSymbol })
  return symbol
}

type Factory = <R>(ctx: Interpreter<R>) => Value

// A table rather than a list so the names are known before any runtime exists.
const table: Record<string, Factory> = {
  tools: () => new ToolReference([]),
  search: (ctx) =>
    native(ctx.builtins, { name: "search", call: (_, args) => ctx.tool(ctx.tools.search, args), callback: false }),
  undefined: () => undefined,
  NaN: () => NaN,
  Infinity: () => Infinity,
  Object: (ctx) => objectGlobal(ctx),
  Function: (ctx) => functionGlobal(ctx),
  Array: (ctx) => arrayGlobal(ctx),
  Math: (ctx) => mathGlobal(ctx),
  JSON: (ctx) => jsonGlobal(ctx),
  console: (ctx) => consoleGlobal(ctx),
  Promise: (ctx) => promiseGlobal(ctx),
  Symbol: (ctx) => symbolGlobal(ctx),
  Iterator: (ctx) => iteratorGlobals(ctx),
  Number: (ctx) => numberGlobal(ctx),
  String: (ctx) => stringGlobal(ctx),
  Boolean: (ctx) => booleanGlobal(ctx),
  parseInt: (ctx) => coercion(ctx, "parseInt", 2),
  parseFloat: (ctx) => coercion(ctx, "parseFloat"),
  isFinite: (ctx) => coercion(ctx, "isFinite"),
  isNaN: (ctx) => coercion(ctx, "isNaN"),
  Date: (ctx) => dateGlobal(ctx),
  RegExp: (ctx) => regexpGlobal(ctx),
  Map: (ctx) => mapGlobal(ctx),
  Set: (ctx) => setGlobal(ctx),
  URL: (ctx) => urlGlobal(ctx),
  URLSearchParams: (ctx) => urlSearchParamsGlobal(ctx),
  Headers: (ctx) => headersGlobal(ctx),
  Uint8Array: (ctx) => uint8ArrayGlobal(ctx),
  TextEncoder: (ctx) => textEncoderGlobal(ctx),
  TextDecoder: (ctx) => textDecoderGlobal(ctx),
  encodeURI: (ctx) => uriGlobal(ctx, "encodeURI"),
  encodeURIComponent: (ctx) => uriGlobal(ctx, "encodeURIComponent"),
  decodeURI: (ctx) => uriGlobal(ctx, "decodeURI"),
  decodeURIComponent: (ctx) => uriGlobal(ctx, "decodeURIComponent"),
  atob: (ctx) => base64Global(ctx, "atob"),
  btoa: (ctx) => base64Global(ctx, "btoa"),
  crypto: (ctx) => cryptoGlobal(ctx),
  structuredClone: (ctx) => structuredCloneGlobal(ctx),
  ...Object.fromEntries(errorTypes.map((type) => [type, <R>(ctx: Interpreter<R>) => errorGlobal(type, ctx)])),
}

/** Names bound in every program before extensions apply. */
export const globalNames: ReadonlySet<string> = new Set(Object.keys(table))

/** The immutable global bindings of every program, in declaration order. */
export const globals = <R>(ctx: Interpreter<R>): ReadonlyArray<readonly [string, Value]> => {
  generatorGlobals(ctx)
  return Object.entries(table).map(([name, factory]) => [name, factory(ctx)] as const)
}
