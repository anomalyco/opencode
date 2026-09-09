import { Effect } from "effect"
import { isBlockedMember, toProgram } from "../data.js"
import { HostFunction, sync, syncCall } from "../interpreter/host.js"
import { type AstNode, AsyncIteratorSymbol, InterpreterRuntimeError, IteratorSymbol } from "../interpreter/model.js"
import { containsOpaqueReference, rejectCircularInsertion, typeofValue } from "../interpreter/references.js"
import { preserveConsumerError, type Runner } from "../interpreter/runner.js"
import { ToolReference } from "../tool-runtime.js"
import { Values } from "../values.js"
import { groupBy } from "./collections.js"
import { coerceToString } from "./value.js"

const requireObject = (name: string, input: unknown, node: AstNode): Record<string, unknown> => {
  if (Array.isArray(input)) return input as unknown as Record<string, unknown>
  if (Values.isValue(input)) return {}
  if (input instanceof Values.Promise) {
    throw new InterpreterRuntimeError(
      `Object.${name} received an un-awaited Promise; await it before inspecting the result.`,
      node,
      "InvalidDataValue",
    )
  }
  if (input === null || typeof input !== "object") {
    throw new InterpreterRuntimeError(`Object.${name} expects a data object or array.`, node, "InvalidDataValue")
  }
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== null && prototype !== Object.prototype) {
    throw new InterpreterRuntimeError(`Object.${name} expects a data object or array.`, node, "InvalidDataValue")
  }
  return input as Record<string, unknown>
}

export const objectAssign = (args: Array<unknown>, node: AstNode): unknown => {
  const target = args[0]
  if (target === null || typeof target !== "object" || Array.isArray(target) || Values.isValue(target)) {
    throw new InterpreterRuntimeError("Object.assign expects a data object target.", node)
  }
  const out = target as Record<string, unknown>
  const seen = new Set<object>()
  const guardedSet = (key: PropertyKey, item: unknown): void => {
    if (typeof key === "string" && isBlockedMember(key))
      throw new InterpreterRuntimeError(`Property '${key}' is not available.`, node)
    rejectCircularInsertion(out, item, "Object.assign result", node, seen)
    if (!Reflect.set(out, key, item))
      throw new InterpreterRuntimeError(`Object.assign could not assign property '${String(key)}'.`, node).as(
        "TypeError",
      )
  }
  for (const source of args.slice(1)) {
    if (source === null || source === undefined || Values.isValue(source)) continue
    if (typeof source !== "object" || Array.isArray(source)) {
      throw new InterpreterRuntimeError("Object.assign expects data objects.", node)
    }
    for (const key of Reflect.ownKeys(source)) {
      if (typeof key === "string") {
        if (Object.prototype.propertyIsEnumerable.call(source, key)) guardedSet(key, Reflect.get(source, key))
        continue
      }
      if (key !== AsyncIteratorSymbol && key !== IteratorSymbol) continue
      if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue
      guardedSet(key, Reflect.get(source, key))
    }
  }
  return out
}

const objectFromEntries = <R>(
  runner: Runner<R>,
  source: unknown,
  node: AstNode,
): Effect.Effect<Record<string, unknown>, unknown, R> => {
  const out: Record<string, unknown> = Object.create(null)
  return Effect.gen(function* () {
    const cursor = yield* runner.syncIterator(source, node)
    if (cursor === undefined) {
      throw new InterpreterRuntimeError("Object.fromEntries expects a synchronous iterable of entries.", node).as(
        "TypeError",
      )
    }
    while (true) {
      const step = yield* cursor.next
      if (step.done) return out
      yield* preserveConsumerError(
        cursor,
        Effect.sync(() => {
          if (
            step.value === null ||
            typeof step.value !== "object" ||
            Values.isValue(step.value) ||
            containsOpaqueReference(step.value)
          ) {
            throw new InterpreterRuntimeError("Object.fromEntries expects [key, value] entry objects.", node).as(
              "TypeError",
            )
          }
          const entry = step.value as Record<string, unknown>
          toProgram(entry[0], "Object.fromEntries key")
          toProgram(entry[1], "Object.fromEntries value")
          const key = coerceToString(entry[0])
          if (isBlockedMember(key)) throw new InterpreterRuntimeError(`Property '${key}' is not available.`, node)
          out[key] = entry[1]
        }),
      )
    }
  })
}

const constructObject = (args: Array<unknown>, node: AstNode): unknown => {
  const first = args[0]
  if (first === null || first === undefined) return {}
  if (typeof first === "object") return first
  throw new InterpreterRuntimeError(
    `Object(${typeof first}) wrapper objects are not supported; use the primitive value directly.`,
    node,
  )
}

// Tool references are not data; only Object.keys(tools) reads them, for tool names.
const rejectTools = (name: string, args: Array<unknown>, node: AstNode): void => {
  if (!(args[0] instanceof ToolReference)) return
  throw new InterpreterRuntimeError(
    `Object.${name}(...) cannot read tool references: they are not plain data. Use Object.keys(tools) for names, or search({ query }) for signatures.`,
    node,
    "InvalidDataValue",
  )
}

const objectStatic = (name: string, impl: (args: Array<unknown>, node: AstNode) => unknown) =>
  sync(`Object.${name}`, (args, node) => {
    rejectTools(name, args, node)
    return impl(args, node)
  })

// Object constructs identically with or without new, like JS. Only `keys` copies its result into the
// program; `values`, `entries`, `assign`, and `fromEntries` hand back the program's own values.
export const objectGlobal = <R>(runner: Runner<R>, toolKeys: (path: ReadonlyArray<string>) => ReadonlyArray<string>) =>
  new HostFunction<R>({
    name: "Object",
    call: syncCall(constructObject),
    construct: syncCall(constructObject),
    instanceOf: (value) => value !== null && (typeof value === "object" || typeofValue(value) === "function"),
    members: {
      keys: sync("Object.keys", (args, node) =>
        toProgram(
          args[0] instanceof ToolReference
            ? [...toolKeys(args[0].path)]
            : Object.keys(requireObject("keys", args[0], node)),
          "Object.keys result",
        ),
      ),
      values: objectStatic("values", (args, node) => Object.values(requireObject("values", args[0], node))),
      entries: objectStatic("entries", (args, node) =>
        Object.entries(requireObject("entries", args[0], node)).map(([key, item]) => [key, item]),
      ),
      hasOwn: objectStatic("hasOwn", (args, node) =>
        Object.hasOwn(
          requireObject("hasOwn", args[0], node),
          args[1] === AsyncIteratorSymbol || args[1] === IteratorSymbol ? args[1] : String(args[1]),
        ),
      ),
      is: objectStatic("is", (args, node) => {
        if (containsOpaqueReference(args[0]) || containsOpaqueReference(args[1])) {
          throw new InterpreterRuntimeError("Object.is requires data values.", node, "InvalidDataValue")
        }
        return Object.is(args[0], args[1])
      }),
      assign: objectStatic("assign", objectAssign),
      fromEntries: new HostFunction<R>({
        name: "Object.fromEntries",
        call: (args, node) =>
          Effect.suspend(() => {
            rejectTools("fromEntries", args, node)
            return objectFromEntries(runner, args[0], node)
          }),
      }),
      groupBy: groupBy(runner, "Object"),
    },
  })
