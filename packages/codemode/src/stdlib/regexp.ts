import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
import { isBlockedMember, type SafeObject } from "../tool-runtime.js"
import { CodeModeRegExp } from "../values.js"
import { coerceToNumber, coerceToString } from "./value.js"

type MatchValue = Array<unknown> & {
  index?: number
  groups?: SafeObject
  indices?: IndicesValue
}

type IndicesValue = Array<unknown> & {
  groups?: SafeObject
}

export const regexpMethods = new Set(["test", "exec", "toString"])

export const regexpStatics = new Set(["escape"])

export const regexpProperties = new Set([
  "source",
  "flags",
  "lastIndex",
  "hasIndices",
  "global",
  "ignoreCase",
  "multiline",
  "sticky",
  "unicode",
  "unicodeSets",
  "dotAll",
])

export const regexFailureReason = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Invalid regular expression:\s*/i, "")

export const escapeRegexHint =
  'To match special characters like ( ) [ ] { } + * ? . literally, escape them with a backslash (e.g. "\\\\(") or test for them with String.includes instead.'

export const toHostRegex = (arg: unknown, method: string, node: AstNode, extraFlags = ""): RegExp => {
  // Native parity: an undefined pattern behaves as an empty pattern.
  if (arg === undefined) return new RegExp("", extraFlags)
  if (arg instanceof CodeModeRegExp) return arg.regex
  if (typeof arg === "string") {
    try {
      return new RegExp(arg, extraFlags)
    } catch (error) {
      throw new InterpreterRuntimeError(
        `String.${method} received the string ${JSON.stringify(arg)}, which is not a valid regular expression pattern (${regexFailureReason(error)}). ${escapeRegexHint}`,
        node,
      ).as("SyntaxError")
    }
  }
  throw new InterpreterRuntimeError(
    `String.${method} expects a regular expression (a /pattern/flags literal or new RegExp(...)) or a string pattern, not ${arg === null ? "null" : typeof arg}.`,
    node,
  )
}

export const matchToValue = (match: RegExpMatchArray): Array<unknown> => {
  const result: MatchValue = Array.from(match, (group) => group)
  if (match.index !== undefined) result.index = match.index
  if (match.groups) {
    const groups: SafeObject = Object.create(null) as SafeObject
    for (const [key, group] of Object.entries(match.groups)) {
      if (!isBlockedMember(key)) groups[key] = group
    }
    result.groups = groups
  }
  if (match.indices) result.indices = indicesToValue(match.indices)
  return result
}

export const invokeRegExpStatic = (name: string, args: Array<unknown>, node: AstNode): string => {
  if (name !== "escape") throw new InterpreterRuntimeError(`RegExp.${name} is not available in CodeMode.`, node)
  if (typeof args[0] !== "string") {
    throw new InterpreterRuntimeError("RegExp.escape expects a string.", node).as("TypeError")
  }
  return RegExp.escape(args[0])
}

export const invokeRegExpMethod = (
  value: CodeModeRegExp,
  name: string,
  args: Array<unknown>,
  node: AstNode,
): unknown => {
  switch (name) {
    case "test":
    case "exec": {
      const input = coerceToString(args[0])
      const lastIndex = value.lastIndex
      const stateful = value.regex.global || value.regex.sticky
      value.regex.lastIndex = toLength(lastIndex)
      if (name === "test") {
        const matched = value.regex.test(input)
        if (!stateful) value.lastIndex = lastIndex
        return matched
      }
      const matched = value.regex.exec(input)
      if (!stateful) value.lastIndex = lastIndex
      return matched === null ? null : matchToValue(matched)
    }
    case "toString":
      return coerceToString(value)
    default:
      throw new InterpreterRuntimeError(`RegExp method '${name}' is not available in CodeMode.`, node)
  }
}

const toLength = (value: unknown): number => {
  const number = coerceToNumber(value)
  if (Number.isNaN(number) || number <= 0) return 0
  return Math.min(Math.floor(number), Number.MAX_SAFE_INTEGER)
}

const indicesToValue = (indices: RegExpIndicesArray): IndicesValue => {
  const result: IndicesValue = Array.from(indices, (range) => (range === undefined ? undefined : [...range]))
  if (indices.groups) {
    const groups: SafeObject = Object.create(null) as SafeObject
    for (const [key, range] of Object.entries(indices.groups)) {
      if (!isBlockedMember(key)) groups[key] = range === undefined ? undefined : [...range]
    }
    result.groups = groups
    return result
  }
  result.groups = undefined
  return result
}
