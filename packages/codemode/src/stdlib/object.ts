import { Effect } from "effect"
import { toProgram } from "../data.js"
import { HostFunction, sync, syncCall } from "../interpreter/host.js"
import { type AstNode, AsyncIteratorSymbol, InterpreterRuntimeError, IteratorSymbol } from "../interpreter/model.js"
import { getOwn, hasOwn, ownEntries, ownKeys, ProgramArray, ProgramObject, set } from "../interpreter/objects.js"
import {
  containsOpaqueReference,
  describeValue,
  rejectCircularInsertion,
  typeofValue,
} from "../interpreter/references.js"
import { preserveConsumerError, type Runner } from "../interpreter/runner.js"
import { ToolReference } from "../tool-runtime.js"
import { Values } from "../values.js"
import { groupBy } from "./collections.js"
import { coerceToString } from "./value.js"

// ToObject for enumeration.
export const enumerableSource = (label: string, value: unknown, node: AstNode): ProgramObject => {
  if (value === null || value === undefined) {
    throw new InterpreterRuntimeError(`${label} cannot convert ${describeValue(value)} to an object.`, node).as(
      "TypeError",
    )
  }
  if (value instanceof Values.Promise) {
    throw new InterpreterRuntimeError(
      `${label} received an un-awaited Promise; await it before inspecting the result.`,
      node,
      "InvalidDataValue",
    )
  }
  if (value instanceof ToolReference) {
    throw new InterpreterRuntimeError(
      `${label} cannot read tool references: they are not plain data. Use Object.keys(tools) for names, or search({ query }) for signatures.`,
      node,
      "InvalidDataValue",
    )
  }
  if (typeof value === "string") return new ProgramArray([...value])
  if (value instanceof ProgramObject) return value
  return new ProgramObject()
}

export const objectAssign = (args: Array<unknown>, node: AstNode): unknown => {
  const target = args[0]
  // JS would box a primitive target; wrappers and primitives cannot hold fields here.
  if (!(target instanceof ProgramObject)) {
    throw new InterpreterRuntimeError(
      `Object.assign expects a data object or array target, received ${describeValue(target)}.`,
      node,
    ).as("TypeError")
  }
  const seen = new Set<object>()
  for (const source of args.slice(1)) {
    if (source === null || source === undefined) continue
    const from = enumerableSource("Object.assign(...)", source, node)
    for (const key of ownKeys(from)) {
      if (typeof key === "symbol" && key !== AsyncIteratorSymbol && key !== IteratorSymbol) continue
      rejectCircularInsertion(target, getOwn(from, key), "Object.assign result", node, seen)
      if (!set(target, key, getOwn(from, key))) {
        throw new InterpreterRuntimeError("Invalid array length", node).as("RangeError")
      }
    }
  }
  return target
}

const objectFromEntries = <R>(
  runner: Runner<R>,
  source: unknown,
  node: AstNode,
): Effect.Effect<ProgramObject, unknown, R> => {
  const out = new ProgramObject()
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
          if (!(step.value instanceof ProgramObject) || containsOpaqueReference(step.value)) {
            throw new InterpreterRuntimeError("Object.fromEntries expects [key, value] entry objects.", node).as(
              "TypeError",
            )
          }
          set(out, coerceToString(getOwn(step.value, 0)), getOwn(step.value, 1))
        }),
      )
    }
  })
}

const constructObject = (args: Array<unknown>, node: AstNode): unknown => {
  const first = args[0]
  if (first === null || first === undefined) return new ProgramObject()
  if (typeof first === "object") return first
  throw new InterpreterRuntimeError(
    `Object(${typeof first}) wrapper objects are not supported; use the primitive value directly.`,
    node,
  )
}

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
            : ownKeys(enumerableSource("Object.keys(...)", args[0], node)).filter((key) => typeof key === "string"),
          "Object.keys result",
        ),
      ),
      values: sync(
        "Object.values",
        (args, node) =>
          new ProgramArray(ownEntries(enumerableSource("Object.values(...)", args[0], node)).map((entry) => entry[1])),
      ),
      entries: sync(
        "Object.entries",
        (args, node) =>
          new ProgramArray(
            ownEntries(enumerableSource("Object.entries(...)", args[0], node)).map((entry) => new ProgramArray(entry)),
          ),
      ),
      hasOwn: sync("Object.hasOwn", (args, node) =>
        hasOwn(
          enumerableSource("Object.hasOwn(...)", args[0], node),
          args[1] === AsyncIteratorSymbol || args[1] === IteratorSymbol ? args[1] : String(args[1]),
        ),
      ),
      is: sync("Object.is", (args, node) => {
        if (containsOpaqueReference(args[0]) || containsOpaqueReference(args[1])) {
          throw new InterpreterRuntimeError("Object.is requires data values.", node, "InvalidDataValue")
        }
        return Object.is(args[0], args[1])
      }),
      assign: sync("Object.assign", objectAssign),
      fromEntries: new HostFunction<R>({
        name: "Object.fromEntries",
        call: (args, node) => Effect.suspend(() => objectFromEntries(runner, args[0], node)),
      }),
      groupBy: groupBy(runner, "Object"),
    },
  })
