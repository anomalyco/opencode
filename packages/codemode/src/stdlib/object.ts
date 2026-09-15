import { Effect } from "effect"
import { constructor, methods, receiver } from "../interpreter/native.js"
import {
  type AstNode,
  AsyncIteratorSymbol,
  invalidData,
  IteratorSymbol,
  rangeError,
  typeError,
} from "../interpreter/model.js"
import {
  Callable,
  define,
  entries,
  enumerableKeys,
  getOwn,
  hasOwn,
  hasPrototype,
  hidden,
  keys,
  own,
  Arr,
  Bytes,
  DateObj,
  ErrorObj,
  Obj,
  PromiseObj,
  RegExpObj,
  set,
} from "../interpreter/objects.js"
import { containsOpaqueReference, describeValue, rejectCircularInsertion } from "../interpreter/references.js"
import { preserveConsumerError } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { ToolReference } from "../tool-runtime.js"
import { groupBy } from "./collections.js"
import { coerceToString } from "./value.js"

// ToObject for enumeration.
export const enumerableSource = <R>(ctx: Interpreter<R>, label: string, value: unknown, node?: AstNode): Obj => {
  if (value === null || value === undefined) {
    throw typeError(`${label} cannot convert ${describeValue(value)} to an object.`, node)
  }
  if (value instanceof PromiseObj) {
    throw invalidData(`${label} received an un-awaited Promise; await it before inspecting the result.`, node)
  }
  if (value instanceof ToolReference) {
    throw invalidData(
      `${label} cannot read tool references: they are not plain data. Use Object.keys(tools) for names, or search({ query }) for signatures.`,
      node,
    )
  }
  if (typeof value === "string") return new Arr(ctx.builtins.Array, [...value])
  if (value instanceof Obj) return value
  return new Obj(ctx.builtins.Object)
}

export const objectAssign = <R>(ctx: Interpreter<R>, args: Array<unknown>): unknown => {
  const target = args[0]
  // JS would box a primitive target; wrappers and primitives cannot hold fields here.
  if (!(target instanceof Obj)) {
    throw typeError(`Object.assign expects a data object or array target, received ${describeValue(target)}.`)
  }
  const seen = new Set<object>()
  for (const source of args.slice(1)) {
    if (source === null || source === undefined) continue
    const from = enumerableSource(ctx, "Object.assign(...)", source)
    for (const key of enumerableKeys(from)) {
      rejectCircularInsertion(target, getOwn(from, key), "Object.assign result", seen)
      if (!set(target, key, getOwn(from, key))) {
        if (target instanceof Arr && key === "length") throw rangeError("Invalid array length")
        throw typeError(`Cannot assign to read only property '${String(key)}'.`)
      }
    }
  }
  return target
}

const objectFromEntries = <R>(ctx: Interpreter<R>, source: unknown): Effect.Effect<Obj, unknown, R> => {
  const out = new Obj(ctx.builtins.Object)
  return Effect.gen(function* () {
    const cursor = yield* ctx.iterate(source)
    if (cursor === undefined) {
      throw typeError("Object.fromEntries expects a synchronous iterable of entries.")
    }
    while (true) {
      const step = yield* cursor.next
      if (step.done) return out
      yield* preserveConsumerError(
        cursor,
        Effect.sync(() => {
          if (!(step.value instanceof Obj) || containsOpaqueReference(step.value)) {
            throw typeError("Object.fromEntries expects [key, value] entry objects.")
          }
          define(out, coerceToString(getOwn(step.value, 0)), getOwn(step.value, 1))
        }),
      )
    }
  })
}

export const classTag = (value: unknown): string => {
  if (value === null) return "Null"
  if (value === undefined) return "Undefined"
  if (value instanceof Arr) return "Array"
  if (value instanceof Callable) return "Function"
  if (value instanceof ErrorObj) return "Error"
  if (value instanceof DateObj) return "Date"
  if (value instanceof RegExpObj) return "RegExp"
  if (value instanceof Bytes) return "Uint8Array"
  if (typeof value === "string") return "String"
  if (typeof value === "number") return "Number"
  if (typeof value === "boolean") return "Boolean"
  return "Object"
}

const propertyKey = (value: unknown): PropertyKey =>
  value === AsyncIteratorSymbol || value === IteratorSymbol ? value : coerceToString(value)

// Object constructs identically with or without new, like JS. Only `keys` copies its result into the
// program; `values`, `entries`, `assign`, and `fromEntries` hand back the program's own values.
export const objectGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const construct = (args: Array<unknown>): unknown => {
    const first = args[0]
    if (first === null || first === undefined) return new Obj(builtins.Object)
    if (first instanceof Obj) return first
    throw typeError(`Object(${typeof first}) wrapper objects are not supported; use the primitive value directly.`)
  }
  const object = constructor<R>(builtins, builtins.Object, {
    name: "Object",
    length: 1,
    call: (_, args) => Effect.sync(() => construct(args)),
    construct: (args) => Effect.sync(() => construct(args)),
  })
  methods(builtins, object, [
    [
      "keys",
      1,
      (_, args) =>
        new Arr(
          builtins.Array,
          args[0] instanceof ToolReference
            ? [...ctx.tools.keys(args[0].path)]
            : keys(enumerableSource(ctx, "Object.keys(...)", args[0])),
        ),
    ],
    [
      "values",
      1,
      (_, args) =>
        new Arr(
          builtins.Array,
          entries(enumerableSource(ctx, "Object.values(...)", args[0])).map((entry) => entry[1]),
        ),
    ],
    [
      "entries",
      1,
      (_, args) =>
        new Arr(
          builtins.Array,
          entries(enumerableSource(ctx, "Object.entries(...)", args[0])).map((entry) => new Arr(builtins.Array, entry)),
        ),
    ],
    ["hasOwn", 2, (_, args) => hasOwn(enumerableSource(ctx, "Object.hasOwn(...)", args[0]), propertyKey(args[1]))],
    [
      "is",
      2,
      (_, args) => {
        if (containsOpaqueReference(args[0]) || containsOpaqueReference(args[1])) {
          throw invalidData("Object.is requires data values.")
        }
        return Object.is(args[0], args[1])
      },
    ],
    ["assign", 2, (_, args) => objectAssign(ctx, args)],
    ["fromEntries", 1, (_, args) => objectFromEntries(ctx, args[0])],
  ])
  define(object, "groupBy", groupBy(ctx, "Object"), hidden)
  methods(builtins, builtins.Object, [
    [
      "hasOwnProperty",
      1,
      (thisValue, args) => hasOwn(receiver(Obj, thisValue, "Object.prototype.hasOwnProperty"), propertyKey(args[0])),
    ],
    [
      "isPrototypeOf",
      1,
      (thisValue, args) => hasPrototype(args[0], receiver(Obj, thisValue, "Object.prototype.isPrototypeOf")),
    ],
    [
      "propertyIsEnumerable",
      1,
      (thisValue, args) =>
        own(receiver(Obj, thisValue, "Object.prototype.propertyIsEnumerable"), propertyKey(args[0]))?.enumerable ===
        true,
    ],
    ["toString", 0, (thisValue) => `[object ${classTag(thisValue)}]`],
    ["toLocaleString", 0, (thisValue) => `[object ${classTag(thisValue)}]`],
    [
      "valueOf",
      0,
      (thisValue) => {
        if (thisValue === null || thisValue === undefined) {
          throw typeError("Object.prototype.valueOf called on null or undefined.")
        }
        return thisValue
      },
    ],
  ])
  return object
}
