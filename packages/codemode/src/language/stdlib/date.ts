import { constructor, type Method, methods, prototypeFrom, receiver } from "../runtime/native.js"
import { rangeError, typeError } from "../runtime/model.js"
import { Arr, DateObj, Obj, coerceToNumber, get, has, coerceToString, type Value } from "../runtime/objects.js"
import { withPrimitives, withReads } from "../runtime/callback.js"
import type { Interpreter } from "../runtime/interpreter.js"
import { checkArrayLength } from "../runtime/limits.js"

const constructDate = (args: Array<Value>, proto: Obj) => {
  if (args.length === 0) return new DateObj(proto, Date.now())
  if (args.length === 1) {
    const arg = args[0]
    if (arg instanceof DateObj) return new DateObj(proto, arg.time)
    return withPrimitives("default", [arg], ([value]) =>
      typeof value === "string"
        ? new DateObj(proto, Date.parse(value))
        : new DateObj(proto, new Date(coerceToNumber(value)).getTime()),
    )
  }
  // The spec converts at most seven components, in order, so extra arguments never run program code.
  return toNumbers(args.slice(0, 7), (parts) => new DateObj(proto, new Date(...(parts as [number, number])).getTime()))
}

// ToNumber on each value in turn, so a symbol throws before any later value's conversion runs program code.
const toNumbers = (values: Array<Value>, body: (numbers: Array<number>) => Value) =>
  withPrimitives("number", values, (primitives) => body(primitives.map(coerceToNumber)), true)

// The options Intl.DateTimeFormat reads.
const dateTimeOptions = [
  "localeMatcher",
  "calendar",
  "numberingSystem",
  "hour12",
  "hourCycle",
  "timeZone",
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "timeZoneName",
  "formatMatcher",
  "dateStyle",
  "timeStyle",
]

const arrayLikeTags = (locales: Obj) => {
  const length = get(locales, "length")
  const count = length instanceof Obj ? 0 : Math.max(0, Math.floor(coerceToNumber(length)) || 0)
  checkArrayLength(count)
  return Array.from({ length: count }, (_, index) => index)
    .filter((index) => has(locales, String(index)))
    .map((index) => get(locales, String(index)))
}

type Getter = keyof {
  [K in keyof Date as Date[K] extends () => number ? K : never]: never
}

const getters: ReadonlyArray<Getter> = [
  "getFullYear",
  "getMonth",
  "getDate",
  "getDay",
  "getHours",
  "getMinutes",
  "getSeconds",
  "getMilliseconds",
  "getUTCFullYear",
  "getUTCMonth",
  "getUTCDate",
  "getUTCDay",
  "getUTCHours",
  "getUTCMinutes",
  "getUTCSeconds",
  "getUTCMilliseconds",
  "getTimezoneOffset",
]

type Setter = keyof {
  [K in keyof Date as Date[K] extends (value: number, ...rest: Array<number>) => number ? K : never]: never
}

const setters: ReadonlyArray<readonly [Setter, number]> = [
  ["setTime", 1],
  ["setMilliseconds", 1],
  ["setUTCMilliseconds", 1],
  ["setSeconds", 2],
  ["setUTCSeconds", 2],
  ["setMinutes", 3],
  ["setUTCMinutes", 3],
  ["setHours", 4],
  ["setUTCHours", 4],
  ["setDate", 1],
  ["setUTCDate", 1],
  ["setMonth", 2],
  ["setUTCMonth", 2],
  ["setFullYear", 3],
  ["setUTCFullYear", 3],
]

export const dateGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Date
  const date = constructor(builtins, proto, {
    name: "Date",
    length: 7,
    // ISO instead of the host's locale string: date strings are deterministic and must not leak the host timezone.
    call: () => new Date().toISOString(),
    construct: (args, newTarget) => constructDate(args, prototypeFrom(newTarget, proto)),
  })
  methods(builtins, date, [
    ["now", 0, () => Date.now()],
    ["parse", 1, (_, args) => Date.parse(coerceToString(args[0]))],
    [
      "UTC",
      7,
      (_, args) => toNumbers(args.slice(0, 7), (parts) => Date.UTC(...(parts as Parameters<typeof Date.UTC>))),
    ],
  ])

  const self = (thisValue: Value, name: string) => receiver(DateObj, thisValue, `Date.prototype.${name}`)
  const iso = (value: DateObj) => {
    if (!Number.isFinite(value.time)) throw rangeError("Invalid time value.")
    return new Date(value.time).toISOString()
  }
  methods(builtins, proto, [
    ["getTime", 0, (thisValue) => self(thisValue, "getTime").time],
    ["valueOf", 0, (thisValue) => self(thisValue, "valueOf").time],
    ["toISOString", 0, (thisValue) => iso(self(thisValue, "toISOString"))],
    [
      "toJSON",
      1,
      (thisValue) => {
        const value = self(thisValue, "toJSON")
        return Number.isFinite(value.time) ? iso(value) : null
      },
    ],
    ["toString", 0, (thisValue) => coerceToString(self(thisValue, "toString"))],
    ["toDateString", 0, (thisValue) => new Date(self(thisValue, "toDateString").time).toDateString()],
    ["toTimeString", 0, (thisValue) => new Date(self(thisValue, "toTimeString").time).toTimeString()],
    ["toUTCString", 0, (thisValue) => new Date(self(thisValue, "toUTCString").time).toUTCString()],
    ["toGMTString", 0, (thisValue) => new Date(self(thisValue, "toGMTString").time).toUTCString()],
    ...(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"] as const).map(
      (name): Method => [
        name,
        0,
        (thisValue, args) => {
          const time = self(thisValue, name).time
          const [locales, options] = args
          if (locales === null || options === null) throw typeError("Cannot convert undefined or null to object.")
          return withReads(() => {
            // Bun's default locale is en-US whatever the environment says; pinning it keeps output off the host's.
            // A non-array object is array-like to Intl, so its elements are the tags.
            const tags =
              locales === undefined
                ? ["en-US"]
                : locales instanceof Arr
                  ? locales.items.filter(() => true)
                  : locales instanceof Obj
                    ? arrayLikeTags(locales)
                    : [locales]
            const entries =
              options instanceof Obj
                ? dateTimeOptions.flatMap((key) => {
                    const value = get(options, key)
                    if (value === undefined) return []
                    return [[key, key === "hour12" ? Boolean(value) : value] as const]
                  })
                : []
            // The host's Intl formats; program objects among the arguments are converted first, as Intl's ToString would.
            return withPrimitives(
              [
                ...tags.map(() => "string" as const),
                ...entries.map((entry) =>
                  entry[0] === "fractionalSecondDigits" ? ("number" as const) : ("string" as const),
                ),
              ],
              [...tags, ...entries.map((entry) => entry[1])],
              (primitives) =>
                new Date(time)[name](
                  (locales instanceof Obj ? primitives.slice(0, tags.length) : primitives[0]) as Intl.LocalesArgument,
                  options instanceof Obj
                    ? Object.fromEntries(entries.map((entry, at) => [entry[0], primitives[tags.length + at]]))
                    : (options as Intl.DateTimeFormatOptions | undefined),
                ),
            )
          })
        },
      ],
    ),
    ...getters.map((name): Method => [name, 0, (thisValue) => new Date(self(thisValue, name).time)[name]()]),
    ...setters.map(
      ([name, length]): Method => [
        name,
        length,
        (thisValue, args) => {
          const target = self(thisValue, name)
          // Native setters read the current time before argument coercion, whose callbacks may mutate the Date.
          return toNumbers([target.time, ...args.slice(0, length)], ([time, ...values]) => {
            const hosted = new Date(time!)
            // Every setter but setTime and setFullYear leaves an invalid Date untouched and answers NaN.
            if (Number.isNaN(hosted.getTime()) && name !== "setTime" && !name.endsWith("FullYear")) return NaN
            target.time = hosted[name](...(values as [number, number, number, number]))
            return target.time
          })
        },
      ],
    ),
  ])
  return date
}
