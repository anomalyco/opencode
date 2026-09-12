import { Effect } from "effect"
import { arrayGlobal } from "../stdlib/array.js"
import { mapGlobal, setGlobal } from "../stdlib/collections.js"
import { consoleGlobal } from "../stdlib/console.js"
import { dateGlobal } from "../stdlib/date.js"
import { jsonGlobal } from "../stdlib/json.js"
import { mathGlobal } from "../stdlib/math.js"
import { numberGlobal } from "../stdlib/number.js"
import { objectGlobal } from "../stdlib/object.js"
import { regexpGlobal } from "../stdlib/regexp.js"
import { stringGlobal } from "../stdlib/string.js"
import { uriGlobal, urlGlobal, urlSearchParamsGlobal } from "../stdlib/url.js"
import { coercion } from "../stdlib/value.js"
import { atobGlobal, btoaGlobal, cryptoGlobal } from "../stdlib/web.js"
import { ToolReference } from "../tool-runtime.js"
import { errorGlobal } from "./errors.js"
import { errorTypes } from "./intrinsics.js"
import { HostFunction } from "./host.js"
import { AsyncIteratorSymbol, InterpreterRuntimeError, IteratorSymbol } from "./model.js"
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

const symbolGlobal = new HostFunction({
  name: "Symbol",
  call: (_, node) =>
    Effect.sync(() => {
      throw new InterpreterRuntimeError(
        "Symbol is not callable; only Symbol.asyncIterator and Symbol.iterator are available.",
        node,
      )
    }),
  callback: false,
  members: { asyncIterator: AsyncIteratorSymbol, iterator: IteratorSymbol },
})

/** The immutable global bindings of every program, in declaration order. */
export const globals = <R>(host: Host<R>): ReadonlyArray<readonly [string, unknown]> => [
  ["tools", new ToolReference([])],
  ["search", new HostFunction<R>({ name: "search", call: (args) => host.search(args), callback: false })],
  ["undefined", undefined],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["Object", objectGlobal(host.runner, host.toolKeys)],
  ["Array", arrayGlobal(host.runner)],
  ["Math", mathGlobal(host.runner)],
  ["JSON", jsonGlobal(host.runner)],
  ["console", consoleGlobal(host.logs)],
  ["Promise", promiseGlobal(host.runner, host.promises)],
  ["Symbol", symbolGlobal],
  ["Number", numberGlobal],
  ["String", stringGlobal],
  ["Boolean", coercion("Boolean", { instanceOf: () => false })],
  ["parseInt", coercion("parseInt")],
  ["parseFloat", coercion("parseFloat")],
  ["isFinite", coercion("isFinite")],
  ["isNaN", coercion("isNaN")],
  ["Date", dateGlobal(host.runner)],
  ["RegExp", regexpGlobal],
  ["Map", mapGlobal(host.runner)],
  ["Set", setGlobal(host.runner)],
  ["URL", urlGlobal],
  ["URLSearchParams", urlSearchParamsGlobal(host.runner)],
  ["encodeURI", uriGlobal("encodeURI")],
  ["encodeURIComponent", uriGlobal("encodeURIComponent")],
  ["decodeURI", uriGlobal("decodeURI")],
  ["decodeURIComponent", uriGlobal("decodeURIComponent")],
  ["atob", atobGlobal],
  ["btoa", btoaGlobal],
  ["crypto", cryptoGlobal],
  ...errorTypes.map((type) => [type, errorGlobal(type, host.runner)] as const),
]
