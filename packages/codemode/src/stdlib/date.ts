import { Effect } from "effect"
import { HostFunction, sync } from "../interpreter/host.js"
import { type AstNode, InterpreterRuntimeError, rangeError } from "../interpreter/model.js"
import { type Runner, toPrimitive } from "../interpreter/runner.js"
import { Values } from "../values.js"
import { coerceToNumber, coerceToString } from "./value.js"

const dateSetterArguments = new Map<string, number>([
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
])

export const dateMethods = new Set([
  "getTime",
  "valueOf",
  "toISOString",
  "toJSON",
  "toString",
  "toDateString",
  "toTimeString",
  "toUTCString",
  "toGMTString",
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
  ...dateSetterArguments.keys(),
])

const constructDate = <R>(runner: Runner<R>, args: Array<unknown>, node: AstNode) => {
  if (args.length === 0) return Effect.succeed(new Values.Date(Date.now()))
  if (args.length === 1) {
    const arg = args[0]
    if (arg instanceof Values.Date) return Effect.succeed(new Values.Date(arg.time))
    return Effect.map(toPrimitive(runner, arg, "number", node), (value) =>
      typeof value === "string"
        ? new Values.Date(Date.parse(value))
        : new Values.Date(new Date(coerceToNumber(value)).getTime()),
    )
  }
  const parts = args.map((arg) => coerceToNumber(arg))
  return Effect.succeed(new Values.Date(new Date(...(parts as [number, number])).getTime()))
}

export const dateGlobal = <R>(runner: Runner<R>) =>
  new HostFunction<R>({
    name: "Date",
    // ISO instead of the host's locale string: date strings are deterministic and must not leak the host timezone.
    call: () => Effect.sync(() => new Date().toISOString()),
    construct: (args, node) => constructDate(runner, args, node),
    instanceOf: (value) => value instanceof Values.Date,
    members: {
      now: sync("Date.now", () => Date.now()),
      parse: sync("Date.parse", (args) => Date.parse(coerceToString(args[0]))),
      UTC: sync("Date.UTC", (args) =>
        Date.UTC(...(args.map((arg) => coerceToNumber(arg)) as Parameters<typeof Date.UTC>)),
      ),
    },
  })

export const dateSetterArgumentCount = (name: string): number | undefined => dateSetterArguments.get(name)

export const invokeDateMethod = (
  value: Values.Date,
  name: string,
  args: Array<number>,
  node: AstNode,
  initialTime = value.time,
): unknown => {
  const hosted = new Date(initialTime)
  switch (name) {
    case "getTime":
    case "valueOf":
      return value.time
    case "toISOString":
      if (!Number.isFinite(value.time)) throw rangeError("Invalid time value.", node)
      return hosted.toISOString()
    case "toJSON":
      return Number.isFinite(value.time) ? hosted.toISOString() : null
    case "toString":
      return coerceToString(value)
    case "toDateString":
      return hosted.toDateString()
    case "toTimeString":
      return hosted.toTimeString()
    case "toUTCString":
    case "toGMTString":
      return hosted.toUTCString()
    case "getFullYear":
      return hosted.getFullYear()
    case "getMonth":
      return hosted.getMonth()
    case "getDate":
      return hosted.getDate()
    case "getDay":
      return hosted.getDay()
    case "getHours":
      return hosted.getHours()
    case "getMinutes":
      return hosted.getMinutes()
    case "getSeconds":
      return hosted.getSeconds()
    case "getMilliseconds":
      return hosted.getMilliseconds()
    case "getUTCFullYear":
      return hosted.getUTCFullYear()
    case "getUTCMonth":
      return hosted.getUTCMonth()
    case "getUTCDate":
      return hosted.getUTCDate()
    case "getUTCDay":
      return hosted.getUTCDay()
    case "getUTCHours":
      return hosted.getUTCHours()
    case "getUTCMinutes":
      return hosted.getUTCMinutes()
    case "getUTCSeconds":
      return hosted.getUTCSeconds()
    case "getUTCMilliseconds":
      return hosted.getUTCMilliseconds()
    case "getTimezoneOffset":
      return hosted.getTimezoneOffset()
    case "setTime":
      return updateDate(value, hosted.setTime(args[0]))
    case "setMilliseconds":
      return updateDate(value, hosted.setMilliseconds(args[0]))
    case "setUTCMilliseconds":
      return updateDate(value, hosted.setUTCMilliseconds(args[0]))
    case "setSeconds":
      if (args.length < 2) return updateDate(value, hosted.setSeconds(args[0]))
      return updateDate(value, hosted.setSeconds(args[0], args[1]))
    case "setUTCSeconds":
      if (args.length < 2) return updateDate(value, hosted.setUTCSeconds(args[0]))
      return updateDate(value, hosted.setUTCSeconds(args[0], args[1]))
    case "setMinutes":
      if (args.length < 2) return updateDate(value, hosted.setMinutes(args[0]))
      if (args.length < 3) return updateDate(value, hosted.setMinutes(args[0], args[1]))
      return updateDate(value, hosted.setMinutes(args[0], args[1], args[2]))
    case "setUTCMinutes":
      if (args.length < 2) return updateDate(value, hosted.setUTCMinutes(args[0]))
      if (args.length < 3) return updateDate(value, hosted.setUTCMinutes(args[0], args[1]))
      return updateDate(value, hosted.setUTCMinutes(args[0], args[1], args[2]))
    case "setHours":
      if (args.length < 2) return updateDate(value, hosted.setHours(args[0]))
      if (args.length < 3) return updateDate(value, hosted.setHours(args[0], args[1]))
      if (args.length < 4) return updateDate(value, hosted.setHours(args[0], args[1], args[2]))
      return updateDate(value, hosted.setHours(args[0], args[1], args[2], args[3]))
    case "setUTCHours":
      if (args.length < 2) return updateDate(value, hosted.setUTCHours(args[0]))
      if (args.length < 3) return updateDate(value, hosted.setUTCHours(args[0], args[1]))
      if (args.length < 4) return updateDate(value, hosted.setUTCHours(args[0], args[1], args[2]))
      return updateDate(value, hosted.setUTCHours(args[0], args[1], args[2], args[3]))
    case "setDate":
      return updateDate(value, hosted.setDate(args[0]))
    case "setUTCDate":
      return updateDate(value, hosted.setUTCDate(args[0]))
    case "setMonth":
      if (args.length < 2) return updateDate(value, hosted.setMonth(args[0]))
      return updateDate(value, hosted.setMonth(args[0], args[1]))
    case "setUTCMonth":
      if (args.length < 2) return updateDate(value, hosted.setUTCMonth(args[0]))
      return updateDate(value, hosted.setUTCMonth(args[0], args[1]))
    case "setFullYear":
      if (args.length < 2) return updateDate(value, hosted.setFullYear(args[0]))
      if (args.length < 3) return updateDate(value, hosted.setFullYear(args[0], args[1]))
      return updateDate(value, hosted.setFullYear(args[0], args[1], args[2]))
    case "setUTCFullYear":
      if (args.length < 2) return updateDate(value, hosted.setUTCFullYear(args[0]))
      if (args.length < 3) return updateDate(value, hosted.setUTCFullYear(args[0], args[1]))
      return updateDate(value, hosted.setUTCFullYear(args[0], args[1], args[2]))
    default:
      throw new InterpreterRuntimeError(`Date method '${name}' is not available.`, node)
  }
}

const updateDate = (value: Values.Date, time: number): number => {
  value.time = time
  return time
}
