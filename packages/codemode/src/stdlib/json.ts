import { nativeKind } from "../machine/native-kind.js"
import { methods } from "../interpreter/native.js"
import { requireCallback } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { syntaxError } from "../interpreter/model.js"
import { typeofValue } from "../interpreter/references.js"
import { fromJson, JsonWalk, walk } from "../data.js"
import {
  get,
  keys,
  Arr,
  type Callable,
  Obj,
  coerceToString,
  record,
  remove,
  set,
  type Value,
} from "../interpreter/objects.js"
import { Push } from "../interpreter/signals.js"
import { type Frame, PENDING } from "../machine/frame.js"

export const jsonGlobal = <R>(ctx: Interpreter<R>) => {
  const json = new Obj(ctx.builtins.Object)
  methods(ctx.builtins, json, [
    ["parse", 2, (_, args) => parse(ctx, args)],
    ["stringify", 3, (_, args) => stringify(ctx, args)],
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
  return new Push(Revive, [reviver, [revival(record(ctx.builtins.Object, { "": parsed }), "")]])
}

/** One value the reviver walk is at: its holder and key, the value, and its property names and the next one. */
type Revival = {
  readonly holder: Obj
  readonly key: string
  readonly value: Value
  names: Array<string>
  index: number
}

const revival = (holder: Obj, key: string): Revival => {
  const value = get(holder, key)
  return { holder, key, value, names: value instanceof Obj ? keys(value) : [], index: 0 }
}

// Slots: the reviver, and the values being revived, innermost last. Children are revived first, each replacing (or,
// when the reviver gives undefined, removing) its property; then the reviver sees the value itself.
const Revive = nativeKind("JSON.parse reviver", (task, frame: Frame, input) => {
  const reviver = frame.slots[0] as Callable
  const stack = frame.slots[1] as Array<Revival>
  let resumed = frame.phase === 1
  while (true) {
    const current = stack[stack.length - 1]!
    let revived: Value
    if (resumed) {
      resumed = false
      revived = input as Value
    } else {
      if (current.index < current.names.length) {
        stack.push(revival(current.value as Obj, current.names[current.index++]!))
        continue
      }
      frame.phase = 1
      const result = task.call(reviver, current.holder, [current.key, current.value], undefined)
      if (result === PENDING) return PENDING
      revived = result
    }
    stack.pop()
    const parent = stack[stack.length - 1]
    if (parent === undefined) return revived
    const name = parent.names[parent.index - 1]!
    if (revived === undefined) remove(parent.value as Obj, name)
    else set(parent.value as Obj, name, revived)
  }
})

const stringify = <R>(ctx: Interpreter<R>, args: Array<Value>) => {
  const space = args[2]
  const indent = typeof space === "number" || typeof space === "string" ? space : undefined
  const replacer = args[1]
  const properties =
    replacer instanceof Arr
      ? replacer.items
          .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
          .map(String)
      : null
  const callback = typeofValue(replacer) === "function" ? requireCallback(replacer, "JSON.stringify") : undefined
  return new Push(JsonWalk, walk(ctx.builtins, args[0], false, callback, properties, indent))
}
