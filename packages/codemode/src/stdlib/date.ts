export const dateMethods = new Set([
  "getTime",
  "valueOf",
  "toISOString",
  "toJSON",
  "toString",
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
])

export const dateStatics = new Set(["now", "parse", "UTC"])

export const invokeDateStatic = (name: string, args: Array<unknown>, node: AstNode): number => {
  switch (name) {
    case "now":
      return Date.now()
    case "parse":
      return Date.parse(coerceToString(args[0]))
    case "UTC":
      return Date.UTC(...(args.map((arg) => coerceToNumber(arg)) as Parameters<typeof Date.UTC>))
    default:
      throw new InterpreterRuntimeError(`Date.${name} is not available in CodeMode.`, node)
  }
}

export const invokeDateMethod = (value: SandboxDate, name: string, node: AstNode): unknown => {
  const hosted = new Date(value.time)
  switch (name) {
    case "getTime":
    case "valueOf":
      return value.time
    case "toISOString":
      if (!Number.isFinite(value.time)) throw new InterpreterRuntimeError("Invalid time value.", node)
      return hosted.toISOString()
    case "toJSON":
      return Number.isFinite(value.time) ? hosted.toISOString() : null
    case "toString":
      return coerceToString(value)
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
    default:
      throw new InterpreterRuntimeError(`Date method '${name}' is not available in CodeMode.`, node)
  }
}
import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
import { SandboxDate } from "../values.js"
import { coerceToNumber, coerceToString } from "./value.js"
