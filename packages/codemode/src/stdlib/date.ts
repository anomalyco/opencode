import type { Eval } from "../interpreter/runner.js"
import { constructor, type Method, methods, prototypeFrom, receiver } from "../interpreter/native.js"
import { rangeError } from "../interpreter/model.js"
import { DateObj, Obj, coerceToNumber, coerceToString, type Value } from "../interpreter/objects.js"
import { toPrimitive, toPrimitiveNumber } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"

function* constructDate<R>(ctx: Interpreter<R>, args: Array<Value>, proto: Obj): Eval<DateObj> {
  if (args.length === 0) return new DateObj(proto, Date.now())
  if (args.length === 1) {
    const arg = args[0]
    if (arg instanceof DateObj) return new DateObj(proto, arg.time)
    const value = yield* toPrimitive(ctx, arg, "default")
    return typeof value === "string"
      ? new DateObj(proto, Date.parse(value))
      : new DateObj(proto, new Date(coerceToNumber(value)).getTime())
  }
  // The spec converts at most seven components, in order, so extra arguments never run program code.
  const parts = yield* toNumbers(ctx, args.slice(0, 7))
  return new DateObj(proto, new Date(...(parts as [number, number])).getTime())
}

// ToNumber on each value in turn, so a symbol throws before any later value's conversion runs program code.
function* toNumbers<R>(ctx: Interpreter<R>, values: Array<Value>): Eval<Array<number>> {
  const numbers: Array<number> = []
  for (const value of values) numbers.push(yield* toPrimitiveNumber(ctx, value))
  return numbers
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
    construct: (args, newTarget) => constructDate(ctx, args, prototypeFrom(newTarget, proto)),
  })
  methods(builtins, date, [
    ["now", 0, () => Date.now()],
    ["parse", 1, (_, args) => Date.parse(coerceToString(args[0]))],
    [
      "UTC",
      7,
      function* (_, args) {
        const parts = yield* toNumbers(ctx, args.slice(0, 7))
        return Date.UTC(...(parts as Parameters<typeof Date.UTC>))
      },
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
        (thisValue) => new Date(self(thisValue, name).time)[name]("en-US", { timeZone: "UTC" }),
      ],
    ),
    ...getters.map((name): Method => [name, 0, (thisValue) => new Date(self(thisValue, name).time)[name]()]),
    ...setters.map(
      ([name, length]): Method => [
        name,
        length,
        function* (thisValue, args) {
          const target = self(thisValue, name)
          // Native setters read the current time before argument coercion, whose callbacks may mutate the Date.
          const hosted = new Date(target.time)
          const values = yield* toNumbers(ctx, args.slice(0, length))
          // Every setter but setTime and setFullYear leaves an invalid Date untouched and answers NaN.
          if (Number.isNaN(hosted.getTime()) && name !== "setTime" && !name.endsWith("FullYear")) return NaN
          target.time = hosted[name](...(values as [number, number, number, number]))
          return target.time
        },
      ],
    ),
  ])
  return date
}
