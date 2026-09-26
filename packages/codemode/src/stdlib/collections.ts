import { Effect } from "effect"
import { constructor, fn, type Method, methods, prototypeFrom, receiver, requiresNew } from "../interpreter/native.js"
import { invalidData, IteratorSymbol, typeError } from "../interpreter/model.js"
import {
  define,
  defineAccessor,
  get,
  getOwn,
  hidden,
  Arr,
  coerceToString,
  hostCursor,
  hostIterator,
  MapObj,
  Obj,
  PromiseObj,
  SetObj,
  type Value,
  WeakMapObj,
  WeakSetObj,
} from "../interpreter/objects.js"
import { describeValue, isOpaque } from "../interpreter/references.js"
import {
  applyCollectionCallback,
  isSupportedCallback,
  preserveConsumerError,
  toPrimitiveNumber,
  toPrimitiveString,
} from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"

const coerceGroupByPropertyKey = <R>(ctx: Interpreter<R>, value: Value): Effect.Effect<string, unknown, R> => {
  if (value instanceof PromiseObj) return Effect.succeed(coerceToString(value))
  if (isOpaque(value)) {
    throw invalidData(`Object.groupBy callback must return a data value, received ${describeValue(value)}.`)
  }
  return toPrimitiveString(ctx, value)
}

/** `Map.groupBy` and `Object.groupBy`: the same iteration, keyed into a Map or a data object. */
export const groupBy = <R>(ctx: Interpreter<R>, namespace: "Map" | "Object") =>
  fn<R>(ctx.builtins, "groupBy", 2, (_, args) => {
    const builtins = ctx.builtins
    const source = args[0]
    if (source === null || source === undefined) {
      throw typeError(`${namespace}.groupBy expects an iterable collection.`)
    }
    const apply = applyCollectionCallback(ctx, args[1], `${namespace}.groupBy`)
    return Effect.gen(function* () {
      const cursor = yield* ctx.iterate(source)
      if (cursor === undefined) {
        throw typeError(`${namespace}.groupBy expects an iterable collection.`)
      }
      if (namespace === "Map") {
        const result = new MapObj(builtins.Map)
        let index = 0
        while (true) {
          const step = yield* cursor.next
          if (step.done) return result
          const item = step.value
          const key = yield* preserveConsumerError(cursor.close, apply([item, index]))
          const group = result.map.get(key)
          if (group === undefined) result.map.set(key, new Arr(builtins.Array, [item]))
          else (group as Arr).items.push(item)
          index += 1
        }
      }

      // Object.groupBy returns a null-prototype object, so group names never collide with inherited methods.
      const result = new Obj(null)
      let index = 0
      while (true) {
        const step = yield* cursor.next
        if (step.done) return result
        const item = step.value
        const key = yield* preserveConsumerError(
          cursor.close,
          Effect.flatMap(apply([item, index]), (value) => coerceGroupByPropertyKey(ctx, value)),
        )
        const group = getOwn(result, key)
        if (group === undefined) define(result, key, new Arr(builtins.Array, [item]))
        else (group as Arr).items.push(item)
        index += 1
      }
    })
  })

const constructMap = <R>(ctx: Interpreter<R>, init: Value, proto: Obj) => {
  const target = new MapObj(proto)
  if (init === undefined || init === null) return Effect.succeed(target)
  return Effect.gen(function* () {
    const cursor = yield* ctx.iterate(init)
    if (cursor === undefined) {
      throw typeError(`new Map(...) expects an iterable of [key, value] pairs, received ${describeValue(init)}.`)
    }
    while (true) {
      const step = yield* cursor.next
      if (step.done) return target
      yield* preserveConsumerError(
        cursor.close,
        Effect.sync(() => {
          if (!(step.value instanceof Obj)) {
            throw typeError("new Map(...) expects [key, value] pairs as entry objects.")
          }
          target.map.set(getOwn(step.value, 0), getOwn(step.value, 1))
        }),
      )
    }
  })
}

const constructSet = <R>(ctx: Interpreter<R>, init: Value, proto: Obj) => {
  const target = new SetObj(proto)
  if (init === undefined || init === null) return Effect.succeed(target)
  return Effect.gen(function* () {
    const cursor = yield* ctx.iterate(init)
    if (cursor === undefined) {
      throw typeError(`new Set(...) expects a synchronous iterable, received ${describeValue(init)}.`)
    }
    while (true) {
      const step = yield* cursor.next
      if (step.done) return target
      target.set.add(step.value)
    }
  })
}

export const mapGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Map
  const map = constructor<R>(builtins, proto, {
    name: "Map",
    call: requiresNew("Map"),
    construct: (args, newTarget) => constructMap(ctx, args[0], prototypeFrom(newTarget, proto)),
  })
  define(map, "groupBy", groupBy(ctx, "Map"), hidden)
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
        const target = self(thisValue, "getOrInsertComputed").map
        const apply = applyCollectionCallback(ctx, args[1], "Map.getOrInsertComputed")
        if (target.has(args[0])) return target.get(args[0])
        // The callback sees the stored key (-0 is +0) and its result wins over anything it inserted itself.
        return Effect.map(apply([args[0] === 0 ? 0 : args[0]]), (value) => {
          target.set(args[0], value)
          return value
        })
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
    ["keys", 0, (thisValue) => hostIterator(builtins, self(thisValue, "keys").map.keys())],
    ["values", 0, (thisValue) => hostIterator(builtins, self(thisValue, "values").map.values())],
    ["entries", 0, (thisValue) => hostIterator(builtins, self(thisValue, "entries").iterator(builtins))],
    [
      "forEach",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "forEach")
        const apply = applyCollectionCallback(ctx, args[0], "Map.forEach")
        return Effect.gen(function* () {
          for (const [key, item] of target.map.entries()) yield* apply([item, key, target], args[1])
          return undefined
        })
      },
    ],
  ])
  define(proto, IteratorSymbol, get(proto, "entries"), hidden)
  return map
}

type SetRecord<R> = {
  readonly size: number
  readonly has: (item: Value) => Effect.Effect<boolean, unknown, R>
  readonly keys: () => Effect.Effect<Iterable<Value>, unknown, R>
}

const loadSetRecord = <R>(
  ctx: Interpreter<R>,
  source: Value,
  name: string,
): Effect.Effect<SetRecord<R>, unknown, R> => {
  if (source instanceof SetObj) {
    return Effect.succeed({
      size: source.set.size,
      has: (item: Value) => Effect.succeed(source.set.has(item)),
      keys: () => Effect.succeed(source.set.values()),
    })
  }
  if (source instanceof MapObj) {
    return Effect.succeed({
      size: source.map.size,
      has: (item: Value) => Effect.succeed(source.map.has(item)),
      keys: () => Effect.succeed(source.map.keys()),
    })
  }
  if (!(source instanceof Obj)) {
    throw typeError(`Set.${name} expects a Set-like object.`)
  }
  return Effect.gen(function* () {
    const size = yield* toPrimitiveNumber(ctx, get(source, "size"))
    if (Number.isNaN(size)) {
      throw typeError(`Set.${name} received a Set-like object with an invalid size.`)
    }
    const has = get(source, "has")
    const keys = get(source, "keys")
    if (!isSupportedCallback(has) || !isSupportedCallback(keys)) {
      throw typeError(`Set.${name} expects callable 'has' and 'keys' methods.`)
    }
    return {
      size: Math.max(Math.trunc(size), 0),
      has: (item: Value) => Effect.map(ctx.call(has, source, [item]), Boolean),
      keys: () =>
        Effect.gen(function* () {
          const result = yield* ctx.call(keys, source, [])
          const cursor = result instanceof Arr ? hostCursor(result.items.values()) : ctx.iterateDirect(result)
          const items: Array<Value> = []
          while (true) {
            const step = yield* cursor.next
            if (step.done) return items
            items.push(step.value)
          }
        }),
    }
  })
}

const setOperation = <R>(
  ctx: Interpreter<R>,
  target: SetObj,
  name: string,
  source: Value,
): Effect.Effect<Value, unknown, R> =>
  Effect.gen(function* () {
    const other = yield* loadSetRecord(ctx, source, name)
    const copy = () => {
      const result = new SetObj(ctx.builtins.Set)
      for (const item of target.set.values()) result.set.add(item)
      return result
    }
    if (name === "union") {
      const result = copy()
      for (const item of yield* other.keys()) result.set.add(item)
      return result
    }
    if (name === "intersection") {
      const result = new SetObj(ctx.builtins.Set)
      if (target.set.size <= other.size) {
        for (const item of target.set.values()) {
          if (yield* other.has(item)) result.set.add(item)
        }
        return result
      }
      for (const item of yield* other.keys()) {
        if (target.set.has(item)) result.set.add(item)
      }
      return result
    }
    if (name === "difference") {
      const result = copy()
      if (target.set.size <= other.size) {
        for (const item of result.set.values()) {
          if (yield* other.has(item)) result.set.delete(item)
        }
        return result
      }
      for (const item of yield* other.keys()) result.set.delete(item)
      return result
    }
    if (name === "symmetricDifference") {
      const result = copy()
      for (const item of yield* other.keys()) {
        if (target.set.has(item)) result.set.delete(item)
        else result.set.add(item)
      }
      return result
    }
    if (name === "isSubsetOf") {
      if (target.set.size > other.size) return false
      for (const item of target.set.values()) {
        if (!(yield* other.has(item))) return false
      }
      return true
    }
    if (name === "isSupersetOf") {
      if (target.set.size < other.size) return false
      for (const item of yield* other.keys()) {
        if (!target.set.has(item)) return false
      }
      return true
    }
    if (target.set.size <= other.size) {
      for (const item of target.set.values()) {
        if (yield* other.has(item)) return false
      }
      return true
    }
    for (const item of yield* other.keys()) {
      if (target.set.has(item)) return false
    }
    return true
  })

export const setGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Set
  const set = constructor<R>(builtins, proto, {
    name: "Set",
    call: requiresNew("Set"),
    construct: (args, newTarget) => constructSet(ctx, args[0], prototypeFrom(newTarget, proto)),
  })
  const self = (thisValue: Value, name: string) => receiver(SetObj, thisValue, `Set.prototype.${name}`)
  const wrap = (items: Array<Value>) => new Arr(builtins.Array, items)
  const operation = (name: string): Method => [
    name,
    1,
    (thisValue, args) => setOperation(ctx, self(thisValue, name), name, args[0]),
  ]
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
    ["keys", 0, (thisValue) => hostIterator(builtins, self(thisValue, "keys").set.values())],
    ["values", 0, (thisValue) => hostIterator(builtins, self(thisValue, "values").set.values())],
    [
      "entries",
      0,
      (thisValue) =>
        hostIterator(
          builtins,
          self(thisValue, "entries")
            .set.values()
            .map((item) => wrap([item, item])),
        ),
    ],
    [
      "forEach",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "forEach")
        const apply = applyCollectionCallback(ctx, args[0], "Set.forEach")
        return Effect.gen(function* () {
          for (const item of target.set.values()) yield* apply([item, item, target], args[1])
          return undefined
        })
      },
    ],
    operation("union"),
    operation("intersection"),
    operation("difference"),
    operation("symmetricDifference"),
    operation("isSubsetOf"),
    operation("isSupersetOf"),
    operation("isDisjointFrom"),
  ])
  define(proto, IteratorSymbol, get(proto, "values"), hidden)
  return set
}

// CanBeHeldWeakly: only program objects; tool references are rebuilt on every access, so they could never be found again.
const weakKey = (value: Value, label: string) => {
  if (value instanceof Obj) return value
  throw typeError(`Invalid value used ${label}: ${describeValue(value)} cannot be held weakly.`)
}

export const weakMapGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.WeakMap
  const weakMap = constructor<R>(builtins, proto, {
    name: "WeakMap",
    call: requiresNew("WeakMap"),
    construct: (args, newTarget) => {
      const target = new WeakMapObj(prototypeFrom(newTarget, proto))
      if (args[0] === undefined || args[0] === null) return Effect.succeed(target)
      return Effect.gen(function* () {
        const cursor = yield* ctx.iterate(args[0]!)
        if (cursor === undefined) {
          throw typeError(
            `new WeakMap(...) expects an iterable of [key, value] pairs, received ${describeValue(args[0])}.`,
          )
        }
        while (true) {
          const step = yield* cursor.next
          if (step.done) return target
          yield* preserveConsumerError(
            cursor.close,
            Effect.sync(() => {
              if (!(step.value instanceof Obj)) {
                throw typeError("new WeakMap(...) expects [key, value] pairs as entry objects.")
              }
              target.map.set(weakKey(getOwn(step.value, 0), "as weak map key"), getOwn(step.value, 1))
            }),
          )
        }
      })
    },
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
        const target = self(thisValue, "getOrInsertComputed")
        const k = key(args[0])
        const apply = applyCollectionCallback(ctx, args[1], "WeakMap.getOrInsertComputed")
        if (target.has(k)) return target.get(k)
        return Effect.map(apply([k]), (value) => {
          target.set(k, value)
          return value
        })
      },
    ],
  ])
  return weakMap
}

export const weakSetGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.WeakSet
  const weakSet = constructor<R>(builtins, proto, {
    name: "WeakSet",
    call: requiresNew("WeakSet"),
    construct: (args, newTarget) => {
      const target = new WeakSetObj(prototypeFrom(newTarget, proto))
      if (args[0] === undefined || args[0] === null) return Effect.succeed(target)
      return Effect.gen(function* () {
        const cursor = yield* ctx.iterate(args[0]!)
        if (cursor === undefined) {
          throw typeError(`new WeakSet(...) expects a synchronous iterable, received ${describeValue(args[0])}.`)
        }
        while (true) {
          const step = yield* cursor.next
          if (step.done) return target
          yield* preserveConsumerError(
            cursor.close,
            Effect.sync(() => {
              target.set.add(weakKey(step.value, "in weak set"))
            }),
          )
        }
      })
    },
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
