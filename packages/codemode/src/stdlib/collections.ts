import { Effect } from "effect"
import { constructor, fn, type Method, methods, prototypeFrom, receiver, requiresNew } from "../interpreter/native.js"
import { invalidData, typeError } from "../interpreter/model.js"
import {
  define,
  defineAccessor,
  get,
  getOwn,
  hidden,
  isWrapper,
  Arr,
  MapObj,
  Obj,
  PromiseObj,
  SetObj,
} from "../interpreter/objects.js"
import { describeValue, isRuntimeReference } from "../interpreter/references.js"
import {
  applyCollectionCallback,
  isSupportedCallback,
  preserveConsumerError,
  toPrimitiveNumber,
  toPrimitiveString,
} from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"

const coerceGroupByPropertyKey = <R>(ctx: Interpreter<R>, value: unknown): Effect.Effect<string, unknown, R> => {
  if (value instanceof PromiseObj) return Effect.succeed("[object Promise]")
  if (!isWrapper(value) && isRuntimeReference(value)) {
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
          const key = yield* preserveConsumerError(cursor, apply([item, index]))
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
          cursor,
          Effect.flatMap(apply([item, index]), (value) => coerceGroupByPropertyKey(ctx, value)),
        )
        const group = getOwn(result, key)
        if (group === undefined) define(result, key, new Arr(builtins.Array, [item]))
        else (group as Arr).items.push(item)
        index += 1
      }
    })
  })

const constructMap = <R>(ctx: Interpreter<R>, init: unknown, proto: Obj) => {
  const target = new MapObj(proto)
  if (init === undefined || init === null) return Effect.succeed(target)
  return Effect.gen(function* () {
    const cursor = yield* ctx.iterate(init)
    if (cursor === undefined) {
      throw typeError("new Map(...) expects an iterable of [key, value] pairs or no argument.")
    }
    while (true) {
      const step = yield* cursor.next
      if (step.done) return target
      yield* preserveConsumerError(
        cursor,
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

const constructSet = <R>(ctx: Interpreter<R>, init: unknown, proto: Obj) => {
  const target = new SetObj(proto)
  if (init === undefined || init === null) return Effect.succeed(target)
  return Effect.gen(function* () {
    const cursor = yield* ctx.iterate(init)
    if (cursor === undefined) {
      throw typeError("new Set(...) expects a synchronous iterable or no argument.")
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
  const self = (thisValue: unknown, name: string) => receiver(MapObj, thisValue, `Map.prototype.${name}`)
  const wrap = (items: Array<unknown>) => new Arr(builtins.Array, items)
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
    ["delete", 1, (thisValue, args) => self(thisValue, "delete").map.delete(args[0])],
    [
      "clear",
      0,
      (thisValue) => {
        self(thisValue, "clear").map.clear()
        return undefined
      },
    ],
    ["keys", 0, (thisValue) => wrap(Array.from(self(thisValue, "keys").map.keys()))],
    ["values", 0, (thisValue) => wrap(Array.from(self(thisValue, "values").map.values()))],
    [
      "entries",
      0,
      (thisValue) => wrap(Array.from(self(thisValue, "entries").map.entries(), ([key, item]) => wrap([key, item]))),
    ],
    [
      "forEach",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "forEach")
        const apply = applyCollectionCallback(ctx, args[0], "Map.forEach")
        return Effect.gen(function* () {
          for (const [key, item] of Array.from(target.map.entries())) yield* apply([item, key, target])
          return undefined
        })
      },
    ],
  ])
  return map
}

type SetRecord<R> = {
  readonly size: number
  readonly has: (item: unknown) => Effect.Effect<boolean, unknown, R>
  readonly keys: () => Effect.Effect<Iterable<unknown>, unknown, R>
}

const loadSetRecord = <R>(
  ctx: Interpreter<R>,
  source: unknown,
  name: string,
): Effect.Effect<SetRecord<R>, unknown, R> => {
  if (source instanceof SetObj) {
    return Effect.succeed({
      size: source.set.size,
      has: (item: unknown) => Effect.succeed(source.set.has(item)),
      keys: () => Effect.succeed(source.set.values()),
    })
  }
  if (source instanceof MapObj) {
    return Effect.succeed({
      size: source.map.size,
      has: (item: unknown) => Effect.succeed(source.map.has(item)),
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
      has: (item: unknown) => Effect.map(ctx.call(has, source, [item]), Boolean),
      keys: () =>
        Effect.flatMap(ctx.call(keys, source, []), (result) => {
          if (result instanceof Arr) return Effect.succeed(result.items)
          throw typeError(`Set.${name} expected 'keys' to return an iterator.`)
        }),
    }
  })
}

const setOperation = <R>(
  ctx: Interpreter<R>,
  target: SetObj,
  name: string,
  source: unknown,
): Effect.Effect<unknown, unknown, R> =>
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
  const self = (thisValue: unknown, name: string) => receiver(SetObj, thisValue, `Set.prototype.${name}`)
  const wrap = (items: Array<unknown>) => new Arr(builtins.Array, items)
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
    ["keys", 0, (thisValue) => wrap(Array.from(self(thisValue, "keys").set.values()))],
    ["values", 0, (thisValue) => wrap(Array.from(self(thisValue, "values").set.values()))],
    [
      "entries",
      0,
      (thisValue) => wrap(Array.from(self(thisValue, "entries").set.values(), (item) => wrap([item, item]))),
    ],
    [
      "forEach",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "forEach")
        const apply = applyCollectionCallback(ctx, args[0], "Set.forEach")
        return Effect.gen(function* () {
          for (const item of Array.from(target.set.values())) yield* apply([item, item, target])
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
  return set
}
