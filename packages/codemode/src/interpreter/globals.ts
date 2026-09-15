import { Effect } from "effect"
import { arrayGlobal } from "../stdlib/array.js"
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
import { coercion } from "../stdlib/value.js"
import { base64Global, cryptoGlobal } from "../stdlib/web.js"
import { ToolReference } from "../tool-runtime.js"
import { errorGlobal } from "./errors.js"
import { errorTypes } from "./intrinsics.js"
import { constants, constructor, native } from "./native.js"
import { AsyncIteratorSymbol, IteratorSymbol, typeError } from "./model.js"
import { generatorGlobals } from "./generators.js"
import { promiseGlobal, type PromiseRuntime } from "./promises.js"
import type { Runner } from "./runner.js"

/** What the built-in globals need from the interpreter that owns them. */
export type Host<R> = {
  readonly runner: Runner<R>
  readonly promises: PromiseRuntime<R>
  readonly search: (args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
  readonly toolKeys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
  readonly logs: Array<string>
}

// Function.prototype.constructor exists so `fn.constructor === Function` holds; dynamic code is unsupported.
const functionGlobal = <R>(runner: Runner<R>) => {
  const reject = () =>
    Effect.sync(() => {
      throw typeError("The Function constructor is not supported; write the function inline.")
    })
  return constructor<R>(runner.prototypes, runner.prototypes.Function, {
    name: "Function",
    length: 1,
    call: reject,
    construct: reject,
  })
}

const symbolGlobal = <R>(runner: Runner<R>) => {
  const symbol = native<R>(runner.prototypes, {
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

type Factory = <R>(host: Host<R>) => unknown

// A table rather than a list so the names are known before any runtime exists.
const table: Record<string, Factory> = {
  tools: () => new ToolReference([]),
  search: (host) =>
    native(host.runner.prototypes, { name: "search", call: (_, args) => host.search(args), callback: false }),
  undefined: () => undefined,
  NaN: () => NaN,
  Infinity: () => Infinity,
  Object: (host) => objectGlobal(host.runner, host.toolKeys),
  Function: (host) => functionGlobal(host.runner),
  Array: (host) => arrayGlobal(host.runner),
  Math: (host) => mathGlobal(host.runner),
  JSON: (host) => jsonGlobal(host.runner),
  console: (host) => consoleGlobal(host.runner, host.logs),
  Promise: (host) => promiseGlobal(host.runner, host.promises),
  Symbol: (host) => symbolGlobal(host.runner),
  Number: (host) => numberGlobal(host.runner),
  String: (host) => stringGlobal(host.runner),
  Boolean: (host) => booleanGlobal(host.runner),
  parseInt: (host) => coercion(host.runner, "parseInt", 2),
  parseFloat: (host) => coercion(host.runner, "parseFloat"),
  isFinite: (host) => coercion(host.runner, "isFinite"),
  isNaN: (host) => coercion(host.runner, "isNaN"),
  Date: (host) => dateGlobal(host.runner),
  RegExp: (host) => regexpGlobal(host.runner),
  Map: (host) => mapGlobal(host.runner),
  Set: (host) => setGlobal(host.runner),
  URL: (host) => urlGlobal(host.runner),
  URLSearchParams: (host) => urlSearchParamsGlobal(host.runner),
  encodeURI: (host) => uriGlobal(host.runner, "encodeURI"),
  encodeURIComponent: (host) => uriGlobal(host.runner, "encodeURIComponent"),
  decodeURI: (host) => uriGlobal(host.runner, "decodeURI"),
  decodeURIComponent: (host) => uriGlobal(host.runner, "decodeURIComponent"),
  atob: (host) => base64Global(host.runner, "atob"),
  btoa: (host) => base64Global(host.runner, "btoa"),
  crypto: (host) => cryptoGlobal(host.runner),
  ...Object.fromEntries(errorTypes.map((type) => [type, <R>(host: Host<R>) => errorGlobal(type, host.runner)])),
}

/** Names bound in every program before extensions apply. */
export const globalNames: ReadonlySet<string> = new Set(Object.keys(table))

/** The immutable global bindings of every program, in declaration order. */
export const globals = <R>(host: Host<R>): ReadonlyArray<readonly [string, unknown]> => {
  generatorGlobals(host.runner, host.promises)
  return Object.entries(table).map(([name, factory]) => [name, factory(host)] as const)
}
