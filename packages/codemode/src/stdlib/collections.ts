import { Effect } from "effect"
import { isBlockedMember, type SafeObject } from "../data.js"
import { HostFunction, requiresNew } from "../interpreter/host.js"
import { type AstNode, InterpreterRuntimeError, isRecord } from "../interpreter/model.js"
import { isRuntimeReference } from "../interpreter/references.js"
import {
  applyCollectionCallback,
  type CallbackRunner,
  preserveConsumerError,
  type Runner,
  type SyncIteratorRunner,
  toPrimitive,
} from "../interpreter/runner.js"
import { Values } from "../values.js"
import { coerceToString } from "./value.js"

export const arrayMethods = new Set([
  "map",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "includes",
  "join",
  "reduce",
  "reduceRight",
  "flatMap",
  "forEach",
  "sort",
  "toSorted",
  "slice",
  "concat",
  "indexOf",
  "lastIndexOf",
  "at",
  "flat",
  "reverse",
  "toReversed",
  "with",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "toSpliced",
  "fill",
  "copyWithin",
  "keys",
  "values",
  "entries",
])

export const mapMethods = new Set(["get", "set", "has", "delete", "clear", "forEach", "keys", "values", "entries"])

export const setMethods = new Set([
  "add",
  "has",
  "delete",
  "clear",
  "forEach",
  "keys",
  "values",
  "entries",
  "union",
  "intersection",
  "difference",
  "symmetricDifference",
  "isSubsetOf",
  "isSupersetOf",
  "isDisjointFrom",
])

const coerceGroupByPropertyKey = <R>(
  runner: CallbackRunner<R>,
  value: unknown,
  node: AstNode,
): Effect.Effect<string, unknown, R> => {
  if (value instanceof Values.Promise) return Effect.succeed("[object Promise]")
  if (!Values.isValue(value) && isRuntimeReference(value)) {
    throw new InterpreterRuntimeError("Object.groupBy callback must return a data value.", node, "InvalidDataValue")
  }
  return Effect.map(toPrimitive(runner, value, "string", node), coerceToString)
}

/** `Map.groupBy` and `Object.groupBy`: the same iteration, keyed into a Map or a data object. */
export const groupBy = <R>(runner: Runner<R>, namespace: "Map" | "Object") =>
  new HostFunction<R>({
    name: `${namespace}.groupBy`,
    call: (args, node) => {
      const source = args[0]
      if (source === null || source === undefined) {
        throw new InterpreterRuntimeError(`${namespace}.groupBy expects an iterable collection.`, node).as("TypeError")
      }
      const apply = applyCollectionCallback(runner, args[1], `${namespace}.groupBy`, node)
      return Effect.gen(function* () {
        const cursor = yield* runner.syncIterator(source, node)
        if (cursor === undefined) {
          throw new InterpreterRuntimeError(`${namespace}.groupBy expects an iterable collection.`, node).as(
            "TypeError",
          )
        }
        if (namespace === "Map") {
          const result = new Values.Map()
          let index = 0
          while (true) {
            const step = yield* cursor.next
            if (step.done) return result
            const item = step.value
            const key = yield* preserveConsumerError(cursor, apply([item, index]))
            const group = result.map.get(key)
            if (group === undefined) result.map.set(key, [item])
            else (group as Array<unknown>).push(item)
            index += 1
          }
        }

        const result: SafeObject = Object.create(null) as SafeObject
        let index = 0
        while (true) {
          const step = yield* cursor.next
          if (step.done) return result
          const item = step.value
          const key = yield* preserveConsumerError(
            cursor,
            Effect.flatMap(apply([item, index]), (value) => coerceGroupByPropertyKey(runner, value, node)),
          )
          if (isBlockedMember(key)) {
            return yield* preserveConsumerError(
              cursor,
              Effect.fail(new InterpreterRuntimeError(`Property '${key}' is not available.`, node)),
            )
          }
          const group = result[key]
          if (group === undefined) result[key] = [item]
          else (group as Array<unknown>).push(item)
          index += 1
        }
      })
    },
  })

const constructMap = <R>(runner: SyncIteratorRunner<R>, init: unknown, node: AstNode) => {
  const target = new Values.Map()
  if (init === undefined || init === null) return Effect.succeed(target)
  return Effect.gen(function* () {
    const cursor = yield* runner.syncIterator(init, node)
    if (cursor === undefined) {
      throw new InterpreterRuntimeError(
        "new Map(...) expects an iterable of [key, value] pairs or no argument.",
        node,
      ).as("TypeError")
    }
    while (true) {
      const step = yield* cursor.next
      if (step.done) return target
      yield* preserveConsumerError(
        cursor,
        Effect.sync(() => {
          if (!isRecord(step.value) || isRuntimeReference(step.value)) {
            throw new InterpreterRuntimeError("new Map(...) expects [key, value] pairs as entry objects.", node).as(
              "TypeError",
            )
          }
          target.map.set(step.value[0], step.value[1])
        }),
      )
    }
  })
}

const constructSet = <R>(runner: SyncIteratorRunner<R>, init: unknown, node: AstNode) => {
  const target = new Values.Set()
  if (init === undefined || init === null) return Effect.succeed(target)
  return Effect.gen(function* () {
    const cursor = yield* runner.syncIterator(init, node)
    if (cursor === undefined) {
      throw new InterpreterRuntimeError("new Set(...) expects a synchronous iterable or no argument.", node).as(
        "TypeError",
      )
    }
    while (true) {
      const step = yield* cursor.next
      if (step.done) return target
      target.set.add(step.value)
    }
  })
}

export const mapGlobal = <R>(runner: Runner<R>) =>
  new HostFunction<R>({
    name: "Map",
    call: requiresNew("Map"),
    construct: (args, node) => constructMap(runner, args[0], node),
    instanceOf: (value) => value instanceof Values.Map,
    members: { groupBy: groupBy(runner, "Map") },
  })

export const setGlobal = <R>(runner: Runner<R>) =>
  new HostFunction<R>({
    name: "Set",
    call: requiresNew("Set"),
    construct: (args, node) => constructSet(runner, args[0], node),
    instanceOf: (value) => value instanceof Values.Set,
  })
