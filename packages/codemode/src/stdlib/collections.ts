import { type Consumer, nativeKind, STATE, SUB } from "../machine/native-kind.js"
import { Push } from "../interpreter/signals.js"
import type { Builtins } from "../interpreter/intrinsics.js"
import { locate } from "../interpreter/errors.js"
import type { AstNode } from "../interpreter/model.js"
import type { TableCursor } from "../interpreter/table.js"
import { PENDING } from "../machine/frame.js"
import { toPrimitive } from "../machine/calls.js"
import { iterateDirect, iteratorStep } from "../machine/iteration.js"
import { Drain, drain } from "../machine/natives.js"
import { constructor, fn, type Method, methods, prototypeFrom, receiver, requiresNew } from "../interpreter/native.js"
import { invalidData, IteratorSymbol, typeError } from "../interpreter/model.js"
import {
  define,
  defineAccessor,
  get,
  getOwn,
  hidden,
  Arr,
  type Callable,
  coerceToNumber,
  coerceToString,
  type Cursor,
  MapObj,
  Position,
  positionIterator,
  Obj,
  PromiseObj,
  SetObj,
  type Step,
  type Value,
  WeakMapObj,
  WeakSetObj,
} from "../interpreter/objects.js"
import { describeValue, isOpaque } from "../interpreter/references.js"
import { isSupportedCallback, requireCallback } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"

/** `Map.groupBy` and `Object.groupBy`: the same iteration, keyed into a Map or a data object. */
export const groupBy = <R>(ctx: Interpreter<R>, namespace: "Map" | "Object") =>
  fn(ctx.builtins, "groupBy", 2, (_, args) => {
    const source = args[0]
    if (source === null || source === undefined) {
      throw typeError(`${namespace}.groupBy expects an iterable collection.`)
    }
    const callback = requireCallback(args[1], `${namespace}.groupBy`)
    // Object.groupBy returns a null-prototype object, so group names never collide with inherited methods.
    const result = namespace === "Map" ? new MapObj(ctx.builtins.Map) : new Obj(null)
    return new Push(Drain, drain(GroupBy, source, [namespace, callback, result, undefined]))
  })

// State: the namespace, the callback, the groups, and the item being grouped. A value's work: call the callback,
// then (Object.groupBy) convert its result to a property key.
const GroupBy: Consumer = {
  name: "groupBy",
  notIterable: (_task, frame) => {
    throw typeError(`${frame.slots[STATE] as string}.groupBy expects an iterable collection.`)
  },
  each: (task, frame, value, index) => {
    const slots = frame.slots
    slots[STATE + 3] = value
    const key = task.call(slots[STATE + 1] as Callable, undefined, [value, index], frame.node)
    if (key === PENDING) return PENDING
    return GroupBy.resume!(task, frame, key, index)
  },
  resume: (task, frame, input) => {
    const slots = frame.slots
    const item = slots[STATE + 3] as Value
    const builtins = task.ctx.builtins
    const result = slots[STATE + 2] as Obj
    if (result instanceof MapObj) {
      const group = result.map.get(input as Value)
      if (group === undefined) result.map.set(input as Value, new Arr(builtins.Array, [item]))
      else (group as Arr).items.push(item)
      return undefined
    }
    let key = input as Value
    if (slots[SUB] === 0) {
      if (key instanceof PromiseObj) key = coerceToString(key)
      else if (isOpaque(key)) {
        throw invalidData(`Object.groupBy callback must return a data value, received ${describeValue(key)}.`)
      }
      slots[SUB] = 1
      const converted = toPrimitive(task, key, "string", frame.node as AstNode)
      if (converted === PENDING) return PENDING
      key = converted
    }
    const name = coerceToString(key)
    const group = getOwn(result, name)
    if (group === undefined) define(result, name, new Arr(builtins.Array, [item]))
    else (group as Arr).items.push(item)
    return undefined
  },
  done: (_task, frame) => frame.slots[STATE + 2] as Obj,
}

const constructMap = (init: Value, proto: Obj) => {
  const target = new MapObj(proto)
  if (init === undefined || init === null) return target
  return new Push(Drain, drain(MapEntries, init, [target]))
}

// State: the collection being filled.
const MapEntries: Consumer = {
  name: "new Map",
  notIterable: (_task, _frame, init) => {
    throw typeError(`new Map(...) expects an iterable of [key, value] pairs, received ${describeValue(init)}.`)
  },
  each: (_task, frame, entry) => {
    if (!(entry instanceof Obj)) {
      throw typeError("new Map(...) expects [key, value] pairs as entry objects.")
    }
    ;(frame.slots[STATE] as MapObj).map.set(getOwn(entry, 0), getOwn(entry, 1))
  },
  done: (_task, frame) => frame.slots[STATE] as Value,
}

const constructSet = (init: Value, proto: Obj) => {
  const target = new SetObj(proto)
  if (init === undefined || init === null) return target
  return new Push(Drain, drain(SetValues, init, [target]))
}

const SetValues: Consumer = {
  name: "new Set",
  notIterable: (_task, _frame, init) => {
    throw typeError(`new Set(...) expects a synchronous iterable, received ${describeValue(init)}.`)
  },
  take: (frame, value) => {
    ;(frame.slots[STATE] as SetObj).set.add(value)
  },
  done: (_task, frame) => frame.slots[STATE] as Value,
}

const WeakMapEntries: Consumer = {
  name: "new WeakMap",
  notIterable: (_task, _frame, init) => {
    throw typeError(`new WeakMap(...) expects an iterable of [key, value] pairs, received ${describeValue(init)}.`)
  },
  each: (_task, frame, entry) => {
    if (!(entry instanceof Obj)) {
      throw typeError("new WeakMap(...) expects [key, value] pairs as entry objects.")
    }
    ;(frame.slots[STATE] as WeakMapObj).map.set(weakKey(getOwn(entry, 0), "as weak map key"), getOwn(entry, 1))
  },
  done: (_task, frame) => frame.slots[STATE] as Value,
}

const WeakSetValues: Consumer = {
  name: "new WeakSet",
  notIterable: (_task, _frame, init) => {
    throw typeError(`new WeakSet(...) expects a synchronous iterable, received ${describeValue(init)}.`)
  },
  each: (_task, frame, value) => {
    ;(frame.slots[STATE] as WeakSetObj).set.add(weakKey(value, "in weak set"))
  },
  done: (_task, frame) => frame.slots[STATE] as Value,
}

// The callback sees the stored key (-0 is +0) and its result wins over anything it inserted itself.
const getOrInsertComputed = (table: MapObj["map"] | WeakMapObj["map"], key: Value, callback: Callable) => {
  if (table.has(key as never)) return table.get(key as never)
  return new Push(GetOrInsertComputedCall, [table, key, callback])
}

const GetOrInsertComputedCall = nativeKind("getOrInsertComputed callback", (task, frame, input) => {
  const slots = frame.slots
  let value = input as Value
  if (frame.phase === 0) {
    const key = slots[1] as Value
    const called = task.call(slots[2] as Callable, undefined, [key === 0 ? 0 : key], frame.node)
    if (called === PENDING) {
      frame.phase = 1
      return PENDING
    }
    value = called
  }
  ;(slots[0] as MapObj["map"]).set(slots[1] as Value, value)
  return value
})

// Slots: the collection, its table cursor, the callback, its `this`. `forEach` visits entries live, as in JS.
const CollectionForEach = nativeKind(
  "collection forEach",
  (task, frame) => {
    const slots = frame.slots
    const target = slots[0] as MapObj | SetObj
    const table = target instanceof MapObj ? target.map : target.set
    const cursor = slots[1] as TableCursor
    for (let at = table.advance(cursor); at >= 0; at = table.advance(cursor)) {
      const key = table.keys[at] as Value
      const value = target instanceof MapObj ? table.values[at] : key
      if (task.call(slots[2] as Callable, slots[3] as Value, [value, key, target], frame.node) === PENDING)
        return PENDING
    }
    return undefined
  },
  {
    unwind: (_task, frame, error) => {
      ;(frame.slots[1] as TableCursor).done = true
      throw locate(error, frame.node)
    },
  },
)

const forEach = (target: MapObj | SetObj, callback: Callable, thisArg: Value) =>
  new Push(CollectionForEach, [
    target,
    (target instanceof MapObj ? target.map : target.set).cursor(),
    callback,
    thisArg,
  ])

export const mapGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Map
  const map = constructor(builtins, proto, {
    name: "Map",
    call: requiresNew("Map"),
    construct: (args, newTarget) => constructMap(args[0], prototypeFrom(newTarget, proto)),
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
        const callback = requireCallback(args[1], "Map.getOrInsertComputed")
        return getOrInsertComputed(target, args[0], callback)
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
    ["keys", 0, (thisValue) => positionIterator(builtins, self(thisValue, "keys"), "keys")],
    ["values", 0, (thisValue) => positionIterator(builtins, self(thisValue, "values"), "values")],
    ["entries", 0, (thisValue) => positionIterator(builtins, self(thisValue, "entries"), "entries")],
    [
      "forEach",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "forEach")
        return forEach(target, requireCallback(args[0], "Map.forEach"), args[1])
      },
    ],
  ])
  define(proto, IteratorSymbol, get(proto, "entries"), hidden)
  return map
}

type SetOp =
  | "union"
  | "intersection"
  | "difference"
  | "symmetricDifference"
  | "isSubsetOf"
  | "isSupersetOf"
  | "isDisjointFrom"

/**
 * How a Set method uses the other set: asking it whether it has each of this set's values (`has`), or taking all of
 * its values (`keys`). The result set, when the method makes one, starts as a copy or empty.
 */
const plan = (name: SetOp, size: number, otherSize: number) => {
  switch (name) {
    case "union":
    case "symmetricDifference":
      return "keys"
    case "intersection":
    case "difference":
    case "isDisjointFrom":
      return size <= otherSize ? "has" : "keys"
    case "isSubsetOf":
      return size > otherSize ? false : "has"
    case "isSupersetOf":
      return size < otherSize ? false : "keys"
  }
}

const startResult = (builtins: Builtins, name: SetOp, target: SetObj) => {
  if (name === "intersection") return new SetObj(builtins.Set)
  if (name !== "union" && name !== "difference" && name !== "symmetricDifference") return undefined
  const result = new SetObj(builtins.Set)
  for (const item of target.set.liveKeys()) result.set.add(item)
  return result
}

// One answer from the other set's `has` for `item`: the method's result once it is decided, or undefined to go on.
const hasAnswer = (name: SetOp, result: SetObj | undefined, item: Value, has: boolean): Value | undefined => {
  if (name === "intersection") {
    if (has) result!.set.add(item)
    return undefined
  }
  if (name === "difference") {
    if (has) result!.set.delete(item)
    return undefined
  }
  if (name === "isSubsetOf") return has ? undefined : false
  return has ? false : undefined
}

// The method's result from all the other set's values.
const fromKeys = (name: SetOp, target: SetObj, result: SetObj | undefined, items: Iterable<Value>): Value => {
  for (const item of items) {
    if (name === "union") result!.set.add(item)
    else if (name === "intersection") {
      if (target.set.has(item)) result!.set.add(item)
    } else if (name === "difference") result!.set.delete(item)
    else if (name === "symmetricDifference") {
      if (target.set.has(item)) result!.set.delete(item)
      else result!.set.add(item)
    } else if (name === "isSupersetOf") {
      if (!target.set.has(item)) return false
    } else if (target.set.has(item)) return false
  }
  return finish(name, result)
}

const finish = (name: SetOp, result: SetObj | undefined): Value =>
  result ?? (name === "isSubsetOf" || name === "isSupersetOf" || name === "isDisjointFrom")

// A Set or Map as the other set answers without running program code.
const withTable = (builtins: Builtins, name: SetOp, target: SetObj, other: SetObj | MapObj): Value => {
  const table = other instanceof SetObj ? other.set : other.map
  const mode = plan(name, target.set.size, table.size)
  if (mode === false) return false
  const result = startResult(builtins, name, target)
  if (mode === "keys") return fromKeys(name, target, result, [...table.liveKeys()])
  for (const item of (result !== undefined && name === "difference" ? result : target).set.liveKeys()) {
    const decided = hasAnswer(name, result, item, table.has(item))
    if (decided !== undefined) return decided
  }
  return finish(name, result)
}

const setOperation = (builtins: Builtins, target: SetObj, name: SetOp, source: Value): Value | Push => {
  if (source instanceof SetObj || source instanceof MapObj) return withTable(builtins, name, target, source)
  if (!(source instanceof Obj)) {
    throw typeError(`Set.${name} expects a Set-like object.`)
  }
  return new Push(SetOperation, [name, target, source])
}

// The phases of a Set method over a Set-like object: convert its size, ask `has` for each value, or call `keys` and
// step the iterator it returns.
const SIZED = 1
const HAS = 2
const KEYS = 3
const STEPPED = 4

// Slots: the method, this set, the other set, its size, its `has` and `keys`, the result set, the cursor over the set
// whose values `has` is asked about (or the other set's iterator), the value asked about, and the values taken.
const SetOperation = nativeKind(
  "Set method",
  (task, frame, input) => {
    const slots = frame.slots
    const name = slots[0] as SetOp
    const target = slots[1] as SetObj
    const source = slots[2] as Obj
    let phase = frame.phase
    if (phase === 0) {
      const size = toPrimitive(task, get(source, "size"), "number", frame.node as AstNode)
      if (size === PENDING) {
        frame.phase = SIZED
        return PENDING
      }
      input = size
      phase = SIZED
    }
    if (phase === SIZED) {
      const size = coerceToNumber(input as Value)
      if (Number.isNaN(size)) {
        throw typeError(`Set.${name} received a Set-like object with an invalid size.`)
      }
      const has = get(source, "has")
      const keys = get(source, "keys")
      if (!isSupportedCallback(has) || !isSupportedCallback(keys)) {
        throw typeError(`Set.${name} expects callable 'has' and 'keys' methods.`)
      }
      slots[3] = Math.max(Math.trunc(size), 0)
      slots[4] = has
      slots[5] = keys
      const mode = plan(name, target.set.size, slots[3] as number)
      if (mode === false) return false
      const result = startResult(task.ctx.builtins, name, target)
      slots[6] = result
      if (mode === "has") {
        slots[7] = (result !== undefined && name === "difference" ? result : target).set.cursor()
        phase = HAS
      } else {
        frame.phase = KEYS
        const iterator = task.call(keys, source, [], frame.node)
        if (iterator === PENDING) return PENDING
        input = iterator
        phase = KEYS
      }
    }
    const result = slots[6] as SetObj | undefined
    if (phase === HAS) {
      const asked = (result !== undefined && name === "difference" ? result : target).set
      const cursor = slots[7] as TableCursor
      if (frame.phase === HAS) {
        const decided = hasAnswer(name, result, slots[8] as Value, Boolean(input))
        if (decided !== undefined) {
          cursor.done = true
          return decided
        }
      }
      frame.phase = HAS
      for (let at = asked.advance(cursor); at >= 0; at = asked.advance(cursor)) {
        const item = asked.keys[at] as Value
        slots[8] = item
        const has = task.call(slots[4] as Value, source, [item], frame.node)
        if (has === PENDING) return PENDING
        const decided = hasAnswer(name, result, item, Boolean(has))
        if (decided !== undefined) {
          cursor.done = true
          return decided
        }
      }
      return finish(name, result)
    }
    if (phase === KEYS) {
      const iterator = input as Value
      slots[7] =
        iterator instanceof Arr
          ? new Position(iterator, "values", task.ctx.builtins.Array)
          : iterateDirect(iterator, undefined)
      slots[9] = []
    }
    const items = slots[9] as Array<Value>
    if (frame.phase === STEPPED) {
      const step = input as Step
      if (step.done) return fromKeys(name, target, result, items)
      items.push(step.value)
    }
    frame.phase = STEPPED
    while (true) {
      const step = iteratorStep(task, slots[7] as Cursor, frame.node as AstNode)
      if (step === PENDING) return PENDING
      if (step.done) return fromKeys(name, target, result, items)
      items.push(step.value)
    }
  },
  {
    unwind: (_task, frame, error) => {
      if (frame.phase === HAS) (frame.slots[7] as TableCursor).done = true
      throw locate(error, frame.node)
    },
  },
)

export const setGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Set
  const set = constructor(builtins, proto, {
    name: "Set",
    call: requiresNew("Set"),
    construct: (args, newTarget) => constructSet(args[0], prototypeFrom(newTarget, proto)),
  })
  const self = (thisValue: Value, name: string) => receiver(SetObj, thisValue, `Set.prototype.${name}`)
  const operation = (name: SetOp): Method => [
    name,
    1,
    (thisValue, args) => setOperation(builtins, self(thisValue, name), name, args[0]),
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
    ["keys", 0, (thisValue) => positionIterator(builtins, self(thisValue, "keys"), "keys")],
    ["values", 0, (thisValue) => positionIterator(builtins, self(thisValue, "values"), "values")],
    ["entries", 0, (thisValue) => positionIterator(builtins, self(thisValue, "entries"), "entries")],
    [
      "forEach",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "forEach")
        return forEach(target, requireCallback(args[0], "Set.forEach"), args[1])
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
  const weakMap = constructor(builtins, proto, {
    name: "WeakMap",
    call: requiresNew("WeakMap"),
    construct: (args, newTarget) => {
      const target = new WeakMapObj(prototypeFrom(newTarget, proto))
      if (args[0] === undefined || args[0] === null) return target
      return new Push(Drain, drain(WeakMapEntries, args[0], [target]))
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
        return getOrInsertComputed(target, k, requireCallback(args[1], "WeakMap.getOrInsertComputed"))
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
    construct: (args, newTarget) => {
      const target = new WeakSetObj(prototypeFrom(newTarget, proto))
      if (args[0] === undefined || args[0] === null) return target
      return new Push(Drain, drain(WeakSetValues, args[0], [target]))
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
