import { sync } from "../interpreter/host.js"
import { InterpreterRuntimeError } from "../interpreter/model.js"
import { coercion } from "./value.js"

export const stringMethods = new Set([
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimStart",
  "trimEnd",
  "split",
  "slice",
  "substring",
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

const codeUnits = (name: string, op: (...codes: Array<number>) => string) =>
  sync(`String.${name}`, (args, node) =>
    op(
      ...args.map((arg) => {
        if (typeof arg !== "number") throw new InterpreterRuntimeError(`String.${name} expects number arguments.`, node)
        return arg
      }),
    ),
  )

export const stringGlobal = coercion("String", {
  instanceOf: () => false,
  members: {
    fromCharCode: codeUnits("fromCharCode", String.fromCharCode),
    fromCodePoint: codeUnits("fromCodePoint", String.fromCodePoint),
  },
})
