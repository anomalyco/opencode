export const stringMethods = new Set([
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimStart",
  "trimEnd",
  "trimLeft",
  "trimRight",
  "split",
  "slice",
  "substring",
  "substr",
  "includes",
  "startsWith",
  "endsWith",
  "indexOf",
  "lastIndexOf",
  "replace",
  "replaceAll",
  "repeat",
  "padStart",
  "padEnd",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "at",
  "concat",
  "toString",
  "match",
  "matchAll",
  "search",
  "localeCompare",
  "normalize",
])

export const stringStatics = new Set(["fromCharCode", "fromCodePoint"])

export const invokeStringStatic = (name: string, args: Array<unknown>, node: AstNode): unknown => {
  const codes = args.map((arg) => {
    if (typeof arg !== "number") throw new InterpreterRuntimeError(`String.${name} expects number arguments.`, node)
    return arg
  })
  switch (name) {
    case "fromCharCode":
      return String.fromCharCode(...codes)
    case "fromCodePoint":
      return String.fromCodePoint(...codes)
    default:
      throw new InterpreterRuntimeError(`String.${name} is not available in CodeMode.`, node)
  }
}
import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
