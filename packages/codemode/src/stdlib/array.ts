import { Effect } from "effect"
import { HostFunction, sync, syncCall } from "../interpreter/host.js"
import { type AstNode, CodeModeGenerator, InterpreterRuntimeError, rangeError } from "../interpreter/model.js"
import { get, ProgramArray, ProgramObject } from "../interpreter/objects.js"
import { describeValue } from "../interpreter/references.js"
import { applyCollectionCallback, preserveConsumerError, type Runner } from "../interpreter/runner.js"

const constructArray = (args: Array<unknown>, node: AstNode): ProgramArray => {
  if (args.length !== 1) return new ProgramArray([...args])
  const first = args[0]
  if (typeof first !== "number") return new ProgramArray([first])
  if (!Number.isInteger(first) || first < 0 || first > 4294967295) {
    throw rangeError("Invalid array length.", node)
  }
  // Sparse like JS: Array(3) has holes, and combinator loops already skip them.
  return new ProgramArray(new Array(first))
}

const arrayLikeSource = (
  source: unknown,
  node: AstNode,
): { readonly length: number; readonly source: ProgramObject } => {
  if (source instanceof ProgramObject && typeof get(source, "length") === "number") {
    const length = get(source, "length") as number
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
        throw new InterpreterRuntimeError("Array.from expects a synchronous iterable or array-like value.", node)
      }
      const arrayLike = arrayLikeSource(source, node)
      const values: Array<unknown> = []
      for (let index = 0; index < arrayLike.length; index += 1) {
        const item = get(arrayLike.source, index)
        values.push(apply === undefined ? item : yield* apply([item, index]))
      }
      return new ProgramArray(values)
    }
    const values: Array<unknown> = []
    let index = 0
    while (true) {
      const step = yield* cursor.next
      if (step.done) return new ProgramArray(values)
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
    instanceOf: (value) => value instanceof ProgramArray,
    members: {
      isArray: sync("Array.isArray", (args) => args[0] instanceof ProgramArray),
      of: sync("Array.of", (args) => new ProgramArray([...args])),
      from: new HostFunction<R>({ name: "Array.from", call: (args, node) => arrayFrom(runner, args, node) }),
    },
  })
