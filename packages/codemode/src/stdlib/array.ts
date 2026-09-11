import { Effect } from "effect"
import { HostFunction, sync, syncCall } from "../interpreter/host.js"
import { type AstNode, CodeModeGenerator, InterpreterRuntimeError } from "../interpreter/model.js"
import { describeValue } from "../interpreter/references.js"
import { applyCollectionCallback, preserveConsumerError, type Runner } from "../interpreter/runner.js"

const constructArray = (args: Array<unknown>, node: AstNode): Array<unknown> => {
  if (args.length !== 1) return [...args]
  const first = args[0]
  if (typeof first !== "number") return [first]
  if (!Number.isInteger(first) || first < 0 || first > 4294967295) {
    throw new InterpreterRuntimeError("Invalid array length.", node).as("RangeError")
  }
  // Sparse like JS: Array(3) has holes, and combinator loops already skip them.
  return new Array(first)
}

const arrayLikeSource = (source: unknown, node: AstNode): { readonly length: number; readonly source: object } => {
  if (
    source !== null &&
    typeof source === "object" &&
    (Object.getPrototypeOf(source) === Object.prototype || Object.getPrototypeOf(source) === null) &&
    typeof (source as { length?: unknown }).length === "number"
  ) {
    const length = (source as { length: number }).length
    const normalized = Number.isNaN(length) || length <= 0 ? 0 : Math.trunc(length)
    if (normalized > 4_294_967_295) throw new RangeError("Invalid array length")
    return { length: normalized, source }
  }
  throw new InterpreterRuntimeError(
    `Array.from expects an array, string, Map, Set, or array-like value, received ${describeValue(source)}.`,
    node,
    "InvalidDataValue",
  )
}

const arrayFrom = <R>(runner: Runner<R>, args: Array<unknown>, node: AstNode): Effect.Effect<unknown, unknown, R> => {
  const source = args[0]
  const apply =
    args.length < 2 || args[1] === undefined ? undefined : applyCollectionCallback(runner, args[1], "Array.from", node)
  return Effect.gen(function* () {
    const cursor = yield* runner.syncIterator(source, node)
    if (cursor === undefined) {
      if (source instanceof CodeModeGenerator) {
        throw new InterpreterRuntimeError("Array.from expects a synchronous iterable or array-like value.", node).as(
          "TypeError",
        )
      }
      const arrayLike = arrayLikeSource(source, node)
      const values: Array<unknown> = []
      for (let index = 0; index < arrayLike.length; index += 1) {
        const item = Reflect.get(arrayLike.source, index)
        values.push(apply === undefined ? item : yield* apply([item, index]))
      }
      return values
    }
    const values: Array<unknown> = []
    let index = 0
    while (true) {
      const step = yield* cursor.next
      if (step.done) return values
      values.push(apply === undefined ? step.value : yield* preserveConsumerError(cursor, apply([step.value, index])))
      index += 1
    }
  })
}

// Array constructs identically with or without new, like JS.
export const arrayGlobal = <R>(runner: Runner<R>) =>
  new HostFunction<R>({
    name: "Array",
    call: syncCall(constructArray),
    construct: syncCall(constructArray),
    instanceOf: (value) => Array.isArray(value),
    members: {
      isArray: sync("Array.isArray", (args) => Array.isArray(args[0])),
      of: sync("Array.of", (args) => [...args]),
      from: new HostFunction<R>({ name: "Array.from", call: (args, node) => arrayFrom(runner, args, node) }),
    },
  })
