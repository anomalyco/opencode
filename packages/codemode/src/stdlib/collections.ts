import { Invoke } from "../runtime/signals.js"
import { constructor, methods, prototypeFrom, receiver, requiresNew, iteratorMethods } from "../runtime/native.js"
import { IteratorSymbol, typeError } from "../runtime/model.js"
import {
  define,
  defineAccessor,
  get,
  hidden,
  type Callable,
  MapObj,
  Obj,
  SetObj,
  type Value,
  WeakMapObj,
  WeakSetObj,
} from "../runtime/objects.js"
import { describeValue } from "../runtime/references.js"
import { requireCallback } from "../runtime/callback.js"
import type { Interpreter } from "../runtime/interpreter.js"

// A collection from an iterable is filled by the prelude, which iterates it.
const filled = <R>(ctx: Interpreter<R>, target: Obj, init: Value, kind: string) =>
  init === undefined || init === null
    ? target
    : new Invoke(ctx.prelude.fn("fillCollection"), undefined, [target, init, kind], undefined)

// The callback sees the stored key (-0 is +0) and its result wins over anything it inserted itself.
const getOrInsertComputed = <R>(
  ctx: Interpreter<R>,
  owner: MapObj | WeakMapObj,
  key: Value,
  callback: Callable,
): Value | Invoke => {
  const table = owner.map as Map<Value, Value>
  if (table.has(key)) return table.get(key)
  return new Invoke(ctx.prelude.fn("insertComputed"), undefined, [owner, key === 0 ? 0 : key, callback], undefined)
}

export const mapGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Map
  const map = constructor(builtins, proto, {
    name: "Map",
    call: requiresNew("Map"),
    construct: (args, newTarget) => filled(ctx, new MapObj(prototypeFrom(newTarget, proto)), args[0], "Map"),
  })
  const self = (thisValue: Value, name: string) => receiver(MapObj, thisValue, `Map.prototype.${name}`)
  defineAccessor(proto, "size", (thisValue) => receiver(MapObj, thisValue, "Map.prototype.size").map.size)
  methods(builtins, proto, [
    ["get", 1, (thisValue, args) => self(thisValue, "get").map.get(args[0])],
    ["has", 1, (thisValue, args) => self(thisValue, "has").map.has(args[0])],
    [
      "set",
      2,
      (thisValue, args) => {
        const target = self(thisValue, "set")
        target.map.set(args[0], args[1])
        return target
      },
    ],
    [
      "getOrInsert",
      2,
      (thisValue, args) => {
        const target = self(thisValue, "getOrInsert").map
        if (!target.has(args[0])) target.set(args[0], args[1])
        return target.get(args[0])
      },
    ],
    [
      "getOrInsertComputed",
      2,
      (thisValue, args) => {
        const target = self(thisValue, "getOrInsertComputed")
        return getOrInsertComputed(ctx, target, args[0], requireCallback(args[1], "Map.getOrInsertComputed"))
      },
    ],
    ["delete", 1, (thisValue, args) => self(thisValue, "delete").map.delete(args[0])],
    [
      "clear",
      0,
      (thisValue) => {
        self(thisValue, "clear").map.clear()
        return undefined
      },
    ],
    ...iteratorMethods(builtins, self),
  ])
  define(proto, IteratorSymbol, get(proto, "entries"), hidden)
  return map
}

export const setGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Set
  const set = constructor(builtins, proto, {
    name: "Set",
    call: requiresNew("Set"),
    construct: (args, newTarget) => filled(ctx, new SetObj(prototypeFrom(newTarget, proto)), args[0], "Set"),
  })
  const self = (thisValue: Value, name: string) => receiver(SetObj, thisValue, `Set.prototype.${name}`)
  defineAccessor(proto, "size", (thisValue) => receiver(SetObj, thisValue, "Set.prototype.size").set.size)
  methods(builtins, proto, [
    ["has", 1, (thisValue, args) => self(thisValue, "has").set.has(args[0])],
    [
      "add",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "add")
        target.set.add(args[0])
        return target
      },
    ],
    ["delete", 1, (thisValue, args) => self(thisValue, "delete").set.delete(args[0])],
    [
      "clear",
      0,
      (thisValue) => {
        self(thisValue, "clear").set.clear()
        return undefined
      },
    ],
    ...iteratorMethods(builtins, self),
  ])
  define(proto, IteratorSymbol, get(proto, "values"), hidden)
  return set
}

// CanBeHeldWeakly: only program objects; tool references are rebuilt on every access, so they could never be found again.
export const weakKey = (value: Value, label: string) => {
  if (value instanceof Obj) return value
  throw typeError(`Invalid value used ${label}: ${describeValue(value)} cannot be held weakly.`)
}

export const weakMapGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.WeakMap
  const weakMap = constructor(builtins, proto, {
    name: "WeakMap",
    call: requiresNew("WeakMap"),
    construct: (args, newTarget) => filled(ctx, new WeakMapObj(prototypeFrom(newTarget, proto)), args[0], "WeakMap"),
  })
  const self = (thisValue: Value, name: string) => receiver(WeakMapObj, thisValue, `WeakMap.prototype.${name}`).map
  // Lookups pass any key through: the host collection answers false for a non-object, as the spec requires.
  const key = (value: Value) => weakKey(value, "as weak map key")
  methods(builtins, proto, [
    [
      "get",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "get")
        return args[0] instanceof Obj ? target.get(args[0]) : undefined
      },
    ],
    ["has", 1, (thisValue, args) => self(thisValue, "has").has(args[0] as Obj)],
    ["delete", 1, (thisValue, args) => self(thisValue, "delete").delete(args[0] as Obj)],
    [
      "set",
      2,
      (thisValue, args) => {
        self(thisValue, "set").set(key(args[0]), args[1])
        return thisValue
      },
    ],
    [
      "getOrInsert",
      2,
      (thisValue, args) => {
        const target = self(thisValue, "getOrInsert")
        const k = key(args[0])
        if (!target.has(k)) target.set(k, args[1])
        return target.get(k)
      },
    ],
    [
      "getOrInsertComputed",
      2,
      (thisValue, args) => {
        const target = receiver(WeakMapObj, thisValue, "WeakMap.prototype.getOrInsertComputed")
        const k = key(args[0])
        return getOrInsertComputed(ctx, target, k, requireCallback(args[1], "WeakMap.getOrInsertComputed"))
      },
    ],
  ])
  return weakMap
}

export const weakSetGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.WeakSet
  const weakSet = constructor(builtins, proto, {
    name: "WeakSet",
    call: requiresNew("WeakSet"),
    construct: (args, newTarget) => filled(ctx, new WeakSetObj(prototypeFrom(newTarget, proto)), args[0], "WeakSet"),
  })
  const self = (thisValue: Value, name: string) => receiver(WeakSetObj, thisValue, `WeakSet.prototype.${name}`).set
  methods(builtins, proto, [
    ["has", 1, (thisValue, args) => self(thisValue, "has").has(args[0] as Obj)],
    ["delete", 1, (thisValue, args) => self(thisValue, "delete").delete(args[0] as Obj)],
    [
      "add",
      1,
      (thisValue, args) => {
        self(thisValue, "add").add(weakKey(args[0], "in weak set"))
        return thisValue
      },
    ],
  ])
  return weakSet
}
