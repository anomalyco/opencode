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
export const urlStatics = new Set(["canParse", "parse"])
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

export const uriArgument = (value: unknown, label: string): string => coerceToString(boundedData(value, label))

export const invokeUriFunction = (ref: UriFunction, args: Array<unknown>, node: AstNode): string => {
  const value = uriArgument(args[0], `${ref.name} input`)
  try {
    switch (ref.name) {
      case "encodeURI":
        return encodeURI(value)
      case "encodeURIComponent":
        return encodeURIComponent(value)
      case "decodeURI":
        return decodeURI(value)
      case "decodeURIComponent":
        return decodeURIComponent(value)
    }
  } catch (error) {
    throw new InterpreterRuntimeError(
      `${ref.name} received malformed URI data: ${error instanceof Error ? error.message : String(error)}`,
      node,
    ).as("URIError")
  }
}

export const urlArgument = (value: unknown, label: string): string =>
  value instanceof CodeModeURL ? value.url.href : uriArgument(value, label)

export const invokeURLStatic = (name: string, args: Array<unknown>, node: AstNode): unknown => {
  if (!urlStatics.has(name)) throw new InterpreterRuntimeError(`URL.${name} is not available in CodeMode.`, node)
  if (args.length === 0) throw new InterpreterRuntimeError(`URL.${name} requires a URL argument.`, node).as("TypeError")
  const input = urlArgument(args[0], `URL.${name} input`)
  const base = args[1] === undefined ? undefined : urlArgument(args[1], `URL.${name} base`)
  try {
    const url = new URL(input, base)
    return name === "canParse" ? true : new CodeModeURL(url)
  } catch {
    return name === "canParse" ? false : null
  }
}

export const invokeURLMethod = (value: CodeModeURL, name: string, node: AstNode): string => {
  if (name === "toString" || name === "toJSON") return value.url.href
  throw new InterpreterRuntimeError(`URL method '${name}' is not available in CodeMode.`, node)
}
import { type AstNode, InterpreterRuntimeError, UriFunction } from "../interpreter/model.js"
import { CodeModeURL } from "../values.js"
import { boundedData, coerceToString } from "./value.js"
