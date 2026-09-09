import { Effect } from "effect"
import { toProgram } from "../data.js"
import { HostFunction, requiresNew, sync, syncCall } from "../interpreter/host.js"
import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
import { isRuntimeReference } from "../interpreter/references.js"
import { preserveConsumerError, type SyncIteratorRunner } from "../interpreter/runner.js"
import { Values } from "../values.js"
import { coerceToString } from "./value.js"

export const urlProperties = new Set([
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
])

export const urlWritableProperties = new Set([
  "href",
  "protocol",
  "username",
  "password",
  "host",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
])

export const urlMethods = new Set(["toString", "toJSON"])
export const urlSearchParamsMethods = new Set([
  "append",
  "delete",
  "get",
  "getAll",
  "has",
  "set",
  "sort",
  "forEach",
  "keys",
  "values",
  "entries",
  "toString",
])

export const uriArgument = (value: unknown, label: string): string => coerceToString(toProgram(value, label))

type UriFunction = "encodeURI" | "encodeURIComponent" | "decodeURI" | "decodeURIComponent"

const uriFunctions: Record<UriFunction, (value: string) => string> = {
  encodeURI,
  encodeURIComponent,
  decodeURI,
  decodeURIComponent,
}

export const uriGlobal = (name: UriFunction) =>
  sync(name, (args, node) => {
    const value = uriArgument(args[0], `${name} input`)
    try {
      return uriFunctions[name](value)
    } catch (error) {
      throw new InterpreterRuntimeError(
        `${name} received malformed URI data: ${error instanceof Error ? error.message : String(error)}`,
        node,
      ).as("URIError")
    }
  })

export const urlArgument = (value: unknown, label: string): string =>
  value instanceof Values.URL ? value.url.href : uriArgument(value, label)

const urlStatic = (name: "canParse" | "parse") =>
  sync(`URL.${name}`, (args, node) => {
    if (args.length === 0) {
      throw new InterpreterRuntimeError(`URL.${name} requires a URL argument.`, node).as("TypeError")
    }
    const input = urlArgument(args[0], `URL.${name} input`)
    const base = args[1] === undefined ? undefined : urlArgument(args[1], `URL.${name} base`)
    try {
      const url = new URL(input, base)
      return name === "canParse" ? true : new Values.URL(url)
    } catch {
      return name === "canParse" ? false : null
    }
  })

const constructURL = (args: Array<unknown>, node: AstNode): Values.URL => {
  if (args.length === 0) {
    throw new InterpreterRuntimeError("new URL(...) requires a URL string and an optional base URL.", node).as(
      "TypeError",
    )
  }
  const input = urlArgument(args[0], "new URL input")
  const base = args[1] === undefined ? undefined : urlArgument(args[1], "new URL base")
  try {
    return new Values.URL(new URL(input, base))
  } catch {
    throw new InterpreterRuntimeError(
      `new URL(...) received an invalid URL${base === undefined ? "" : " or base URL"}.`,
      node,
    ).as("TypeError")
  }
}

export const urlGlobal = new HostFunction({
  name: "URL",
  call: requiresNew("URL"),
  construct: syncCall(constructURL),
  instanceOf: (value) => value instanceof Values.URL,
  members: { canParse: urlStatic("canParse"), parse: urlStatic("parse") },
})

const readURLSearchParamsPair = <R>(
  runner: SyncIteratorRunner<R>,
  value: unknown,
  node: AstNode,
): Effect.Effect<Array<string>, unknown, R> =>
  Effect.gen(function* () {
    const cursor = yield* runner.syncIterator(value, node)
    if (cursor === undefined) {
      throw new InterpreterRuntimeError("new URLSearchParams(...) expects iterable [name, value] pairs.", node).as(
        "TypeError",
      )
    }
    const items: Array<string> = []
    while (true) {
      const step = yield* cursor.next
      if (step.done) return items
      items.push(
        yield* preserveConsumerError(
          cursor,
          Effect.sync(() => uriArgument(step.value, "URLSearchParams pair value")),
        ),
      )
    }
  })

const constructURLSearchParams = <R>(
  runner: SyncIteratorRunner<R>,
  init: unknown,
  node: AstNode,
): Effect.Effect<Values.URLSearchParams, unknown, R> => {
  if (init === undefined) return Effect.succeed(new Values.URLSearchParams(new URLSearchParams()))
  if (init instanceof Values.URLSearchParams) {
    return Effect.succeed(new Values.URLSearchParams(new URLSearchParams(init.params)))
  }
  if (typeof init === "string") return Effect.succeed(new Values.URLSearchParams(new URLSearchParams(init)))
  if (init === null || typeof init === "number" || typeof init === "boolean") {
    return Effect.succeed(new Values.URLSearchParams(new URLSearchParams(coerceToString(init))))
  }
  return Effect.gen(function* () {
    const cursor = yield* runner.syncIterator(init, node)
    if (cursor !== undefined) {
      const entries: Array<Array<string>> = []
      while (true) {
        const step = yield* cursor.next
        if (step.done) {
          if (entries.some((entry) => entry.length !== 2)) {
            throw new InterpreterRuntimeError(
              "new URLSearchParams(...) expects iterable [name, value] pairs.",
              node,
            ).as("TypeError")
          }
          return new Values.URLSearchParams(
            new URLSearchParams(entries.map((entry): [string, string] => [entry[0] ?? "", entry[1] ?? ""])),
          )
        }
        entries.push(yield* preserveConsumerError(cursor, readURLSearchParamsPair(runner, step.value, node)))
      }
    }
    if (isRuntimeReference(init)) {
      throw new InterpreterRuntimeError(
        "new URLSearchParams(...) expects a query string, data object, or synchronous iterable pairs.",
        node,
      ).as("TypeError")
    }
    if (Values.isValue(init)) return new Values.URLSearchParams(new URLSearchParams())
    const data = toProgram(init, "new URLSearchParams input")
    if (data === null || typeof data !== "object") {
      throw new InterpreterRuntimeError(
        "new URLSearchParams(...) expects a query string, data object, iterable pairs, or URLSearchParams.",
        node,
      ).as("TypeError")
    }
    return new Values.URLSearchParams(
      new URLSearchParams(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, coerceToString(value)]))),
    )
  })
}

export const urlSearchParamsGlobal = <R>(runner: SyncIteratorRunner<R>) =>
  new HostFunction<R>({
    name: "URLSearchParams",
    call: requiresNew("URLSearchParams"),
    construct: (args, node) => constructURLSearchParams(runner, args[0], node),
    instanceOf: (value) => value instanceof Values.URLSearchParams,
  })

export const invokeURLMethod = (value: Values.URL, name: string, node: AstNode): string => {
  if (name === "toString" || name === "toJSON") return value.url.href
  throw new InterpreterRuntimeError(`URL method '${name}' is not available.`, node)
}
