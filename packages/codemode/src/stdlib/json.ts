import { methods } from "../runtime/native.js"
import { requireCallback } from "../runtime/callback.js"
import type { Interpreter } from "../runtime/interpreter.js"
import { syntaxError } from "../runtime/model.js"
import { typeofValue } from "../runtime/references.js"
import { fromJson } from "../data.js"
import { Arr, Obj, coerceToString, record, type Value } from "../runtime/objects.js"
import { Invoke, Push } from "../runtime/signals.js"

export const jsonGlobal = <R>(ctx: Interpreter<R>) => {
  const json = new Obj(ctx.builtins.Object)
  methods(ctx.builtins, json, [
    ["parse", 2, (_, args) => parse(ctx, args)],
    ["stringify", 3, (_, args) => stringify(args)],
  ])
  return json
}

const parse = <R>(ctx: Interpreter<R>, args: Array<Value>) => {
  const text = coerceToString(args[0])

  const parsed = (() => {
    try {
      return fromJson(ctx, JSON.parse(text))
    } catch (error) {
      throw syntaxError(`JSON.parse received invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
  if (typeofValue(args[1]) !== "function") return parsed
  const reviver = requireCallback(args[1], "JSON.parse")
  return new Invoke(
    ctx.prelude.fn("revive"),
    undefined,
    [record(ctx.builtins.Object, { "": parsed }), "", reviver],
    undefined,
  )
}

const stringify = (args: Array<Value>) => {
  const space = args[2]
  const indent = typeof space === "number" || typeof space === "string" ? space : undefined
  const replacer = args[1]
  const properties =
    replacer instanceof Arr
      ? replacer.items
          .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
          .map(String)
      : undefined
  const callback = typeofValue(replacer) === "function" ? requireCallback(replacer, "JSON.stringify") : undefined
  return new Push("JSON.stringify", [args[0], callback, properties, indent])
}
