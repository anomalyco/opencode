import { Effect } from "effect"
import { constructor, fn, type Impl, type Method, methods } from "../interpreter/native.js"
import { checkArrayLength, checkStringLength } from "../interpreter/limits.js"
import { invalidData, IteratorSymbol, rangeError, typeError } from "../interpreter/model.js"
import {
  define,
  get,
  hidden,
  Arr,
  hostIterator,
  Obj,
  RegExpObj,
  record,
  coerceToInteger,
  coerceToNumber,
  coerceToString,
  type Value,
} from "../interpreter/objects.js"
import { containsOpaqueReference, typeofValue } from "../interpreter/references.js"
import {
  applyCollectionCallback,
  type Hint,
  isSupportedCallback,
  toPrimitiveString,
  withPrimitives,
} from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { matchToValue, toHostRegex } from "./regexp.js"
import { coercion } from "./value.js"

// console is intercepted by the interpreter before reaching here.
const requireDataArgument = (name: string, index: number, arg: Value): Value => {
  if (containsOpaqueReference(arg)) {
    throw invalidData(`String.${name} expects argument ${index + 1} to be a data value.`)
  }
  return arg
}

const replaceAllNeedsGlobal = (pattern: RegExp) => {
  if (!pattern.global) {
    throw typeError(
      `String.replaceAll requires a regular expression with the global (g) flag: write /${pattern.source}/${pattern.flags}g, or use String.replace to replace only the first match.`,
    )
  }
}

const replaceWithCallback = <R>(
  ctx: Interpreter<R>,
  value: string,
  name: "replace" | "replaceAll",
  args: Array<Value>,
): Effect.Effect<Value, unknown, R> => {
  const builtins = ctx.builtins
  const apply = applyCollectionCallback(ctx, args[1], `String.${name}`)
  const matches: Array<{ readonly match: string; readonly offset: number; readonly args: Array<Value> }> = []
  // The host calls back with (match, ...captures, offset, string, groups?); only groups is not already a Value.
  const collect = (
    ...callbackArgs: Array<string | number | undefined | Record<string, string | undefined>>
  ): string => {
    const match = callbackArgs[0]
    const hasGroups = typeof callbackArgs.at(-1) === "object"
    const offset = callbackArgs[callbackArgs.length - (hasGroups ? 3 : 2)]
    if (typeof match !== "string" || typeof offset !== "number") {
      throw typeError(`String.${name} produced an invalid replacement match.`)
    }
    const args = callbackArgs.map((arg) => (typeof arg === "object" ? record(builtins.Object, arg) : arg))
    matches.push({ match, offset, args })
    return match
  }

  const pattern = args[0]
  if (pattern instanceof RegExpObj) {
    if (name === "replaceAll") replaceAllNeedsGlobal(pattern.regex)
    if (name === "replace") value.replace(pattern.regex, collect)
    else value.replaceAll(pattern.regex, collect)
  } else {
    const search = coerceToString(requireDataArgument(name, 0, pattern))
    if (name === "replace") value.replace(search, collect)
    else value.replaceAll(search, collect)
  }

  return Effect.gen(function* () {
    const output: Array<string> = []
    let end = 0
    for (const match of matches) {
      const replacement = yield* apply(match.args)
      output.push(value.slice(end, match.offset), coerceToString(replacement))
      end = match.offset + match.match.length
    }
    output.push(value.slice(end))
    return output.join("")
  })
}

export const stringGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const string = constructor<R>(builtins, builtins.String, {
    name: "String",
    length: 1,
    call: coercion(ctx, "String").call,
  })
  const codeUnits = (name: string, op: (...codes: Array<number>) => string): Method => [
    name,
    1,
    (_, args) => op(...args.map(coerceToNumber)),
  ]
  methods(builtins, string, [
    codeUnits("fromCharCode", String.fromCharCode),
    codeUnits("fromCodePoint", String.fromCodePoint),
    [
      "raw",
      1,
      (_, args) => {
        const template = args[0]
        const raw = template instanceof Obj ? get(template, "raw") : undefined
        if (!(raw instanceof Obj)) throw typeError("String.raw expects a template object with a raw array.")
        const count = Math.max(0, coerceToInteger(get(raw, "length")))
        checkArrayLength(count)
        // Each literal is followed by its substitution, except the last literal, or when substitutions run out.
        const parts = Array.from({ length: count }, (_, index) =>
          index + 1 < count && index + 1 < args.length ? [get(raw, index), args[index + 1]] : [get(raw, index)],
        ).flat()
        return Effect.map(
          Effect.forEach(parts, (part) => toPrimitiveString(ctx, part)),
          (strings) => {
            const output = strings.join("")
            checkStringLength(output.length)
            return output
          },
        )
      },
    ],
  ])

  const self = (thisValue: Value, name: string): string => {
    if (typeof thisValue === "string") return thisValue
    if (thisValue === null || thisValue === undefined) {
      throw typeError(`String.prototype.${name} called on null or undefined.`)
    }
    return coerceToString(thisValue)
  }
  // Coerce arguments like native JS; opaque runtime references still reject.
  const str = (name: string, args: Array<Value>, index: number): string =>
    coerceToString(requireDataArgument(name, index, args[index]))
  const num = (name: string, args: Array<Value>, index: number): number =>
    coerceToNumber(requireDataArgument(name, index, args[index]))
  const optNum = (name: string, args: Array<Value>, index: number): number | undefined =>
    args[index] === undefined ? undefined : num(name, args, index)
  const optStr = (name: string, args: Array<Value>, index: number): string | undefined =>
    args[index] === undefined ? undefined : str(name, args, index)
  // ToPrimitive in spec order: the receiver, then the arguments the method consumes, one hint per position; the
  // rest pass through as they are.
  const simple = (
    name: string,
    length: number,
    op: (value: string, args: Array<Value>) => ReturnType<Impl>,
    hints: ReadonlyArray<Hint> = [],
  ): Method => [
    name,
    length,
    (thisValue, args) => {
      if (thisValue === null || thisValue === undefined) {
        throw typeError(`String.prototype.${name} called on null or undefined.`)
      }
      return withPrimitives(
        ctx,
        ["string", ...hints],
        [thisValue, ...args.slice(0, hints.length)],
        ([value, ...primitives]) => op(coerceToString(value), [...primitives, ...args.slice(hints.length)]),
      )
    },
  ]
  // includes, startsWith, and endsWith reject a RegExp before converting their search string and position.
  const searching = (name: string, op: (value: string, search: string, position: number | undefined) => boolean) =>
    simple(name, 1, (value, args) => {
      if (args[0] instanceof RegExpObj) {
        throw typeError(
          `String.${name} cannot take a regular expression; use regex.test(string) or String.search instead.`,
        )
      }
      return withPrimitives(ctx, ["string", "number"], args.slice(0, 2), (primitives) =>
        op(value, str(name, primitives, 0), optNum(name, primitives, 1)),
      )
    })
  // match, matchAll, and search read a RegExp as is and convert anything else to its pattern text.
  const withPattern = (args: Array<Value>, op: (pattern: Value) => Value) =>
    args[0] instanceof RegExpObj ? op(args[0]) : withPrimitives(ctx, "string", [args[0]], ([text]) => op(text))
  const replace = (name: "replace" | "replaceAll") =>
    simple(name, 2, (value, args) => {
      const pattern = args[0]
      const replacer = args[1]
      // A RegExp pattern is used as is; a plain one converts to its search string, then a non-callable replacement.
      return withPrimitives(
        ctx,
        "string",
        [pattern instanceof RegExpObj ? undefined : pattern, isSupportedCallback(replacer) ? undefined : replacer],
        ([search, replacement]) => {
          if (isSupportedCallback(replacer)) {
            return replaceWithCallback(ctx, value, name, [pattern instanceof RegExpObj ? pattern : search, replacer])
          }
          if (typeofValue(replacer) === "function") {
            throw typeError(
              `String.${name} cannot use this callable as a replacer; wrap it in an arrow function, e.g. (match) => tools.ns.tool(match).`,
            )
          }
          const primitives = [search, replacement]
          if (pattern instanceof RegExpObj) {
            const regex = pattern.regex
            const text = str(name, primitives, 1)
            if (name === "replaceAll") replaceAllNeedsGlobal(regex)
            return name === "replace" ? value.replace(regex, text) : value.replaceAll(regex, text)
          }
          if (name === "replace") return value.replace(str(name, primitives, 0), str(name, primitives, 1))
          return value.replaceAll(str(name, primitives, 0), str(name, primitives, 1))
        },
      )
    })

  methods(builtins, builtins.String, [
    simple("toString", 0, (value) => value),
    simple("valueOf", 0, (value) => value),
    simple("toLowerCase", 0, (value) => value.toLowerCase()),
    simple("toUpperCase", 0, (value) => value.toUpperCase()),
    simple("toLocaleLowerCase", 0, (value) => value.toLowerCase()),
    simple("toLocaleUpperCase", 0, (value) => value.toUpperCase()),
    simple("trim", 0, (value) => value.trim()),
    simple("trimStart", 0, (value) => value.trimStart()),
    simple("trimLeft", 0, (value) => value.trimStart()),
    simple("trimEnd", 0, (value) => value.trimEnd()),
    simple("trimRight", 0, (value) => value.trimEnd()),
    // Locale/options are deliberately unsupported; comparison uses the host default locale.
    simple("localeCompare", 1, (value, args) => value.localeCompare(str("localeCompare", args, 0)), ["string"]),
    simple(
      "normalize",
      0,
      (value, args) => {
        const form = optStr("normalize", args, 0)
        try {
          return value.normalize(form)
        } catch {
          throw rangeError(
            `String.normalize expects the form "NFC", "NFD", "NFKC", or "NFKD" (got ${JSON.stringify(form)}).`,
          )
        }
      },
      ["string"],
    ),
    simple("split", 2, (value, args) => {
      const separator = args[0]
      // A RegExp separator is used as is; the limit converts before a plain separator does, as in the spec.
      return withPrimitives(
        ctx,
        ["number", "string"],
        [args[1], separator instanceof RegExpObj ? undefined : separator],
        ([limit, pattern]) => {
          const wrap = (parts: Array<string>) => new Arr(builtins.Array, parts)
          // Native: an undefined separator returns the whole string, not a split on "undefined",
          // unless the limit truncates to zero.
          const requestedLimit = args[1] === undefined ? undefined : num("split", [pattern, limit], 1)
          if (separator === undefined) {
            return wrap(requestedLimit !== undefined && requestedLimit >>> 0 === 0 ? [] : [value])
          }
          const parts =
            separator instanceof RegExpObj
              ? value.split(separator.regex, requestedLimit)
              : value.split(str("split", [pattern], 0), requestedLimit === undefined ? undefined : requestedLimit >>> 0)
          checkArrayLength(parts.length)
          return wrap(parts)
        },
      )
    }),
    simple("slice", 2, (value, args) => value.slice(optNum("slice", args, 0), optNum("slice", args, 1)), [
      "number",
      "number",
    ]),
    searching("includes", (value, search, position) => value.includes(search, position)),
    searching("startsWith", (value, search, position) => value.startsWith(search, position)),
    searching("endsWith", (value, search, position) => value.endsWith(search, position)),
    simple("indexOf", 1, (value, args) => value.indexOf(str("indexOf", args, 0), optNum("indexOf", args, 1)), [
      "string",
      "number",
    ]),
    simple(
      "lastIndexOf",
      1,
      (value, args) => value.lastIndexOf(str("lastIndexOf", args, 0), optNum("lastIndexOf", args, 1)),
      ["string", "number"],
    ),
    replace("replace"),
    replace("replaceAll"),
    simple("match", 1, (value, args) =>
      withPattern(args, (arg) => {
        const regex = toHostRegex(arg, "match")
        const matched = value.match(regex)
        if (matched === null) return null
        // Preserve the own `index` and `groups` properties on non-global matches.
        if (regex.global) return new Arr(builtins.Array, [...matched])
        return matchToValue(builtins, matched)
      }),
    ),
    simple("matchAll", 1, (value, args) =>
      withPattern(args, (arg) => {
        const regex = toHostRegex(arg, "matchAll", "g")
        if (!regex.global) {
          throw typeError(
            `String.matchAll requires a regular expression with the global (g) flag: write /${regex.source}/${regex.flags}g, or use String.match for a single match.`,
          )
        }
        const matches: Array<Value> = []
        for (const match of value.matchAll(regex)) {
          checkArrayLength(matches.length + 1)
          matches.push(matchToValue(builtins, match))
        }
        return new Arr(builtins.Array, matches)
      }),
    ),
    simple("search", 1, (value, args) => withPattern(args, (arg) => value.search(toHostRegex(arg, "search")))),
    simple(
      "repeat",
      1,
      (value, args) => {
        const count = num("repeat", args, 0)
        if (!Number.isFinite(count) || count < 0) {
          throw rangeError("String.repeat expects a finite non-negative count.")
        }
        checkStringLength(value.length * count)
        return value.repeat(count)
      },
      ["number"],
    ),
    simple(
      "padStart",
      1,
      (value, args) => {
        const length = num("padStart", args, 0)
        checkStringLength(length)
        return value.padStart(length, optStr("padStart", args, 1))
      },
      ["number", "string"],
    ),
    simple(
      "padEnd",
      1,
      (value, args) => {
        const length = num("padEnd", args, 0)
        checkStringLength(length)
        return value.padEnd(length, optStr("padEnd", args, 1))
      },
      ["number", "string"],
    ),
    simple("charAt", 1, (value, args) => value.charAt(optNum("charAt", args, 0) ?? 0), ["number"]),
    simple("at", 1, (value, args) => value.at(optNum("at", args, 0) ?? 0), ["number"]),
    simple(
      "substring",
      2,
      (value, args) => value.substring(optNum("substring", args, 0) ?? 0, optNum("substring", args, 1)),
      ["number", "number"],
    ),
    simple("substr", 2, (value, args) => value.substr(optNum("substr", args, 0) ?? 0, optNum("substr", args, 1)), [
      "number",
      "number",
    ]),
    simple("isWellFormed", 0, (value) => value.isWellFormed()),
    simple("toWellFormed", 0, (value) => value.toWellFormed()),
    simple("charCodeAt", 1, (value, args) => value.charCodeAt(optNum("charCodeAt", args, 0) ?? 0), ["number"]),
    simple("codePointAt", 1, (value, args) => value.codePointAt(optNum("codePointAt", args, 0) ?? 0), ["number"]),
    simple("concat", 1, (value, args) =>
      withPrimitives(ctx, "string", args, (parts) => {
        const joined = value.concat(...parts.map((_, index) => str("concat", parts, index)))
        checkStringLength(joined.length)
        return joined
      }),
    ),
  ])
  define(
    builtins.String,
    IteratorSymbol,
    fn(builtins, "[Symbol.iterator]", 0, (thisValue) =>
      hostIterator(builtins, self(thisValue, "[Symbol.iterator]")[Symbol.iterator]()),
    ),
    hidden,
  )
  return string
}
