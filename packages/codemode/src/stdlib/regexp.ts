import { Effect } from "effect"
import type { Builtins } from "../interpreter/intrinsics.js"
import { constructor, type Method, methods, prototypeFrom, receiver } from "../interpreter/native.js"
import { syntaxError, typeError } from "../interpreter/model.js"
import {
  define,
  defineAccessor,
  Arr,
  Obj,
  RegExpObj,
  record,
  coerceToNumber,
  coerceToString,
  type Value,
} from "../interpreter/objects.js"
import type { Interpreter } from "../interpreter/interpreter.js"

const flagProperties = [
  "hasIndices",
  "global",
  "ignoreCase",
  "multiline",
  "sticky",
  "unicode",
  "unicodeSets",
  "dotAll",
] as const

const regexFailureReason = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Invalid regular expression:\s*/i, "")

const escapeRegexHint =
  'To match special characters like ( ) [ ] { } + * ? . literally, escape them with a backslash (e.g. "\\\\(") or test for them with String.includes instead.'

export const toHostRegex = (arg: Value, method: string, extraFlags = ""): RegExp => {
  // Native parity: an undefined pattern behaves as an empty pattern.
  if (arg === undefined) return new RegExp("", extraFlags)
  if (arg instanceof RegExpObj) return arg.regex
  if (typeof arg === "string") {
    try {
      return new RegExp(arg, extraFlags)
    } catch (error) {
      throw syntaxError(
        `String.${method} received the string ${JSON.stringify(arg)}, which is not a valid regular expression pattern (${regexFailureReason(error)}). ${escapeRegexHint}`,
      )
    }
  }
  throw typeError(
    `String.${method} expects a regular expression (a /pattern/flags literal or new RegExp(...)) or a string pattern, not ${arg === null ? "null" : typeof arg}.`,
  )
}

export const matchToValue = (builtins: Builtins, match: RegExpMatchArray): Arr => {
  const result = new Arr(
    builtins.Array,
    Array.from(match, (group) => group),
  )
  if (match.index !== undefined) define(result, "index", match.index)
  if (match.input !== undefined) define(result, "input", match.input)
  if (match.groups) define(result, "groups", record(builtins.Object, match.groups))
  if (match.indices) define(result, "indices", indicesToValue(builtins, match.indices))
  return result
}

export const constructRegExp = (builtins: Builtins, args: Array<Value>, proto: Obj = builtins.RegExp): RegExpObj => {
  const first = args[0]
  const pattern = first instanceof RegExpObj ? first.regex.source : first === undefined ? "" : coerceToString(first)
  const flagsArg = args[1]
  if (flagsArg !== undefined && typeof flagsArg !== "string") {
    throw syntaxError(
      `RegExp flags must be a string of flag characters (e.g. "g", "gi"), not ${flagsArg === null ? "null" : typeof flagsArg}.`,
    )
  }
  const flags = flagsArg ?? (first instanceof RegExpObj ? first.regex.flags : "")
  try {
    return new RegExpObj(proto, pattern, flags)
  } catch (error) {
    const reason = regexFailureReason(error)
    throw syntaxError(
      /flag/i.test(reason)
        ? `new RegExp(...) received invalid flags ${JSON.stringify(flags)} (${reason}). Valid flags are d, g, i, m, s, u, v, and y.`
        : `new RegExp(...) received ${JSON.stringify(pattern)}, which is not a valid regular expression pattern (${reason}). ${escapeRegexHint}`,
    )
  }
}

// RegExp constructs identically with or without new, like JS.
export const regexpGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.RegExp
  const regexp = constructor<R>(builtins, proto, {
    name: "RegExp",
    length: 2,
    call: (_, args) => Effect.sync(() => constructRegExp(builtins, args)),
    construct: (args, newTarget) => Effect.sync(() => constructRegExp(builtins, args, prototypeFrom(newTarget, proto))),
  })
  methods(builtins, regexp, [
    [
      "escape",
      1,
      (_, args) => {
        if (typeof args[0] !== "string") throw typeError("RegExp.escape expects a string.")
        return RegExp.escape(args[0])
      },
    ],
  ])

  const self = (thisValue: Value, name: string) => receiver(RegExpObj, thisValue, `RegExp.prototype.${name}`)
  defineAccessor(proto, "source", (thisValue) => self(thisValue, "source").regex.source)
  defineAccessor(proto, "flags", (thisValue) => self(thisValue, "flags").regex.flags)
  // The host regex holds the only lastIndex, so exec/test and the String methods share one counter.
  defineAccessor(
    proto,
    "lastIndex",
    (thisValue) => self(thisValue, "lastIndex").regex.lastIndex,
    (thisValue, value) => {
      self(thisValue, "lastIndex").regex.lastIndex = coerceToNumber(value)
    },
  )
  for (const name of flagProperties) defineAccessor(proto, name, (thisValue) => self(thisValue, name).regex[name])
  const run = (name: "exec" | "test"): Method => [
    name,
    1,
    (thisValue, args) => {
      const value = self(thisValue, name)
      const matched = value.regex.exec(coerceToString(args[0]))
      if (name === "test") return matched !== null
      return matched === null ? null : matchToValue(builtins, matched)
    },
  ]
  methods(builtins, proto, [
    run("exec"),
    run("test"),
    ["toString", 0, (thisValue) => coerceToString(self(thisValue, "toString"))],
  ])
  return regexp
}

const indicesToValue = (builtins: Builtins, indices: RegExpIndicesArray): Arr => {
  const range = (pair: [number, number] | undefined) =>
    pair === undefined ? undefined : new Arr(builtins.Array, [...pair])
  const result = new Arr(builtins.Array, Array.from(indices, range))
  const groups = indices.groups
  define(
    result,
    "groups",
    groups === undefined
      ? undefined
      : record(builtins.Object, Object.fromEntries(Object.entries(groups).map(([key, pair]) => [key, range(pair)]))),
  )
  return result
}
