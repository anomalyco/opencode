import { constructor, methods, receiver } from "../runtime/native.js"
import { type AstNode, AsyncIteratorSymbol, invalidData, IteratorSymbol, typeError } from "../runtime/model.js"
import {
  changed,
  entries,
  enumerableKeys,
  getOwn,
  hasOwn,
  hasPrototype,
  HostNamespace,
  keys,
  own,
  ownKeys,
  Arr,
  Bytes,
  Obj,
  PromiseObj,
  set,
  coerceToString,
  type Value,
  accessorFunction,
  Callable,
  define,
  defineOwnProperty,
  type Descriptor,
  get,
  has,
  parseArrayIndex,
  record,
  type Slot,
} from "../runtime/objects.js"
import { type Builtins, primitivePrototype } from "../runtime/intrinsics.js"
import { describeValue, rejectCircularInsertion } from "../runtime/references.js"
import { invokeMethod, readsPending, withPrimitives, withReads } from "../runtime/callback.js"
import { Invoke } from "../runtime/signals.js"
import type { Interpreter } from "../runtime/interpreter.js"

// ToObject for enumeration.
export const enumerableSource = <R>(ctx: Interpreter<R>, label: string, value: Value, node?: AstNode): Obj => {
  if (value === null || value === undefined) {
    throw typeError(`${label} cannot convert ${describeValue(value)} to an object.`, node)
  }
  if (value instanceof PromiseObj) {
    throw invalidData(`${label} received an un-awaited Promise; await it before inspecting the result.`, node)
  }
  if (value instanceof HostNamespace) {
    throw invalidData(
      `${label} cannot read ${value.root}: it is a namespace of host functions, not plain data. Use Object.keys(${value.root}) for its names.`,
      node,
    )
  }
  if (typeof value === "string") return new Arr(ctx.builtins.Array, [...value])
  if (value instanceof Obj) return value
  return new Obj(ctx.builtins.Object)
}

export const objectAssign = <R>(ctx: Interpreter<R>, args: Array<Value>): Value | Invoke => {
  const target = args[0]
  // JS would box a primitive target; wrappers and primitives cannot hold fields here.
  if (!(target instanceof Obj)) {
    throw typeError(`Object.assign expects a data object or array target, received ${describeValue(target)}.`)
  }
  const sources = args
    .slice(1)
    .filter((source) => source !== null && source !== undefined)
    .map((source) => enumerableSource(ctx, "Object.assign(...)", source))
  // Program getters on a source or setters on the target's chain run in the prelude, Get then Set per key.
  if (sources.some((from) => from.hasProgramAccessors) || accessorsOnChain(target)) {
    return new Invoke(
      ctx.prelude.fn("objectAssign"),
      undefined,
      [target, new Arr(ctx.builtins.Array, sources)],
      undefined,
    )
  }
  const seen = new Set<object>()
  for (const from of sources) {
    for (const key of enumerableKeys(from)) {
      rejectCircularInsertion(target, getOwn(from, key), "Object.assign result", seen)
      if (set(target, key, getOwn(from, key)) !== true) {
        throw typeError(`Cannot assign to read only property '${String(key)}'.`)
      }
    }
  }
  return target
}

const accessorsOnChain = (target: Obj): boolean => {
  for (let current: Obj | null = target; current !== null; current = current.proto) {
    if (current.hasProgramAccessors) return true
  }
  return false
}

const classTag = (value: Value): string => {
  if (value === null) return "Null"
  if (value === undefined) return "Undefined"
  if (value instanceof Obj) return value.tag
  if (typeof value === "string") return "String"
  if (typeof value === "number") return "Number"
  if (typeof value === "boolean") return "Boolean"
  return "Object"
}

const propertyKey = (value: Value): PropertyKey =>
  value === AsyncIteratorSymbol || value === IteratorSymbol ? value : coerceToString(value)

// SetIntegrityLevel: primitives pass through. A typed array's bytes cannot carry attributes, so JS throws after
// already making it non-extensible.
const restrict = (level: "freeze" | "seal" | "preventExtensions", value: Value): Value => {
  if (!(value instanceof Obj)) return value
  changed(value)
  value.extensible = false
  if (level === "preventExtensions") return value
  if (value instanceof Bytes && value.bytes.length > 0) {
    throw typeError(`Cannot ${level} array buffer views with elements.`)
  }
  for (const slot of value.props.values()) {
    slot.configurable = false
    if (level === "freeze" && "value" in slot) slot.writable = false
  }
  if (value instanceof Arr) value.elements = { writable: level === "seal", enumerable: true, configurable: false }
  return value
}

// TestIntegrityLevel: array elements and `length` answer through `own`, so a non-extensible empty array is sealed
// but not frozen, as in JS.
const integrity = (value: Value, frozen: boolean): boolean => {
  if (!(value instanceof Obj)) return true
  if (value.extensible) return false
  return ownKeys(value).every((key) => {
    const slot = own(value, key)
    return slot !== undefined && !slot.configurable && !(frozen && "value" in slot && slot.writable)
  })
}

// ToPropertyDescriptor, under `withReads`: each field through the chain, in the spec's order.
const toPropertyDescriptor = (value: Value): Descriptor => {
  if (!(value instanceof Obj)) throw typeError(`Property description must be an object: ${describeValue(value)}`)
  const desc: Descriptor = {}
  if (has(value, "enumerable")) desc.enumerable = Boolean(get(value, "enumerable"))
  if (has(value, "configurable")) desc.configurable = Boolean(get(value, "configurable"))
  if (has(value, "value")) desc.value = get(value, "value")
  if (has(value, "writable")) desc.writable = Boolean(get(value, "writable"))
  for (const half of ["get", "set"] as const) {
    if (!has(value, half)) continue
    const fn = get(value, half)
    if (fn !== undefined && !(fn instanceof Callable)) {
      throw typeError(`${half === "get" ? "Getter" : "Setter"} must be a function: ${describeValue(fn)}`)
    }
    desc[half] = fn
  }
  if (("get" in desc || "set" in desc) && ("value" in desc || "writable" in desc)) {
    throw typeError("Invalid property descriptor. Cannot both specify accessors and a value or writable attribute.")
  }
  return desc
}

// DefinePropertyOrThrow.
const defineOrThrow = (target: Obj, key: PropertyKey, desc: Descriptor): void => {
  if (desc.value instanceof Obj) {
    rejectCircularInsertion(
      target,
      desc.value,
      target instanceof Arr ? "Array assignment result" : "Object assignment result",
    )
  }
  if (defineOwnProperty(target, key, desc)) return
  if (!target.extensible && own(target, key) === undefined) {
    throw typeError(`Cannot define property ${String(key)}, object is not extensible`)
  }
  throw typeError(`Cannot redefine property: ${String(key)}`)
}

const requireTarget = (value: Value, name: string): Obj => {
  if (value instanceof Obj) return value
  throw typeError(`Object.${name} called on non-object`)
}

// ObjectDefineProperties: every descriptor is read (getters included) before the first one is defined.
const defineProperties = (target: Obj, props: Value): Obj => {
  if (props === null || props === undefined) throw typeError(`Cannot convert ${props} to object`)
  // ToObject: a string's indexes are its only own enumerable properties; other primitives have none.
  const descriptors =
    props instanceof Obj
      ? ownKeys(props)
          .filter((key) => own(props, key)?.enumerable === true)
          .map((key) => [key, toPropertyDescriptor(get(props, key))] as const)
      : typeof props === "string"
        ? [...props].map((char, index) => [String(index), toPropertyDescriptor(char)] as const)
        : []
  if (readsPending()) return target
  for (const [key, desc] of descriptors) defineOrThrow(target, key, desc)
  return target
}

// FromPropertyDescriptor: a native accessor half shows as its companion function.
const fromSlot = (builtins: Builtins, slot: Slot | undefined): Value => {
  if (slot === undefined) return undefined
  const fields: Record<string, Value> =
    "value" in slot
      ? { value: slot.value, writable: slot.writable }
      : { get: accessorFunction(slot.get), set: accessorFunction(slot.set) }
  return record(builtins.Object, { ...fields, enumerable: slot.enumerable, configurable: slot.configurable })
}

// The own properties a primitive has after ToObject, which only a string's are: its indexes and `length`.
const primitiveSlot = (value: Value, key: PropertyKey): Slot | undefined => {
  if (typeof value !== "string") return undefined
  if (key === "length") return { value: value.length, writable: false, enumerable: false, configurable: false }
  const at = typeof key === "symbol" ? undefined : parseArrayIndex(key)
  return at !== undefined && at < value.length
    ? { value: value[at], writable: false, enumerable: true, configurable: false }
    : undefined
}

const primitiveKeys = (value: Value): Array<string> =>
  typeof value === "string" ? [...Object.keys(value), "length"] : []

const requireObjectCoercible = (value: Value, name: string): void => {
  if (value === null || value === undefined) throw typeError(`Object.${name} cannot convert ${value} to an object.`)
  if (value instanceof HostNamespace) {
    throw typeError(`Object.${name} cannot read ${value.root}: it is a namespace of host functions, not an object.`)
  }
}

// Object constructs identically with or without new, like JS. Only `keys` copies its result into the
// program; `values`, `entries`, `assign`, and `fromEntries` hand back the program's own values.
export const objectGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const construct = (args: Array<Value>): Value => {
    const first = args[0]
    if (first === null || first === undefined) return new Obj(builtins.Object)
    if (first instanceof Obj) return first
    throw typeError(`Object(${typeof first}) wrapper objects are not supported; use the primitive value directly.`)
  }
  const object = constructor(builtins, builtins.Object, {
    name: "Object",
    length: 1,
    call: (_, args) => construct(args),
    construct: (args) => construct(args),
  })
  methods(builtins, object, [
    [
      "keys",
      1,
      (_, args) =>
        new Arr(
          builtins.Array,
          args[0] instanceof HostNamespace
            ? [...ctx.namespaceKeys(args[0])]
            : keys(enumerableSource(ctx, "Object.keys(...)", args[0])),
        ),
    ],
    [
      "values",
      1,
      (_, args) => {
        const source = enumerableSource(ctx, "Object.values(...)", args[0])
        if (source.hasProgramAccessors)
          return new Invoke(ctx.prelude.fn("objectEntries"), undefined, [source, true], undefined)
        return new Arr(
          builtins.Array,
          entries(source).map((entry) => entry[1]),
        )
      },
    ],
    [
      "entries",
      1,
      (_, args) => {
        const source = enumerableSource(ctx, "Object.entries(...)", args[0])
        if (source.hasProgramAccessors)
          return new Invoke(ctx.prelude.fn("objectEntries"), undefined, [source, false], undefined)
        return new Arr(
          builtins.Array,
          entries(source).map((entry) => new Arr(builtins.Array, entry)),
        )
      },
    ],
    ["hasOwn", 2, (_, args) => hasOwn(enumerableSource(ctx, "Object.hasOwn(...)", args[0]), propertyKey(args[1]))],
    ["is", 2, (_, args) => Object.is(args[0], args[1])],
    ["assign", 2, (_, args) => objectAssign(ctx, args)],
    ["freeze", 1, (_, args) => restrict("freeze", args[0])],
    ["seal", 1, (_, args) => restrict("seal", args[0])],
    ["preventExtensions", 1, (_, args) => restrict("preventExtensions", args[0])],
    ["isFrozen", 1, (_, args) => integrity(args[0], true)],
    ["isSealed", 1, (_, args) => integrity(args[0], false)],
    ["isExtensible", 1, (_, args) => args[0] instanceof Obj && args[0].extensible],
    [
      "getPrototypeOf",
      1,
      (_, args) => {
        if (args[0] instanceof Obj) return args[0].proto
        const proto = primitivePrototype(builtins, args[0])
        if (proto === undefined) {
          throw typeError(`Object.getPrototypeOf cannot convert ${describeValue(args[0])} to an object.`)
        }
        return proto
      },
    ],
    [
      "create",
      2,
      (_, args) => {
        const proto = args[0]
        if (proto !== null && !(proto instanceof Obj)) {
          throw typeError("Object prototype may only be an Object or null.")
        }
        if (args[1] === undefined) return new Obj(proto)
        return withReads(() => defineProperties(new Obj(proto), args[1]))
      },
    ],
    [
      "defineProperty",
      3,
      (_, args) => {
        const target = requireTarget(args[0], "defineProperty")
        return withPrimitives("string", [args[1]], ([key]) =>
          withReads(() => {
            const desc = toPropertyDescriptor(args[2])
            if (readsPending()) return target
            defineOrThrow(target, propertyKey(key), desc)
            return target
          }),
        )
      },
    ],
    [
      "defineProperties",
      2,
      (_, args) => {
        const target = requireTarget(args[0], "defineProperties")
        return withReads(() => defineProperties(target, args[1]))
      },
    ],
    [
      "getOwnPropertyDescriptor",
      2,
      (_, args) => {
        const value = args[0]
        requireObjectCoercible(value, "getOwnPropertyDescriptor")
        return withPrimitives("string", [args[1]], ([raw]) => {
          const key = propertyKey(raw)
          return fromSlot(builtins, value instanceof Obj ? own(value, key) : primitiveSlot(value, key))
        })
      },
    ],
    [
      "getOwnPropertyDescriptors",
      1,
      (_, args) => {
        const value = args[0]
        requireObjectCoercible(value, "getOwnPropertyDescriptors")
        const result = new Obj(builtins.Object)
        if (value instanceof Obj)
          for (const key of ownKeys(value)) define(result, key, fromSlot(builtins, own(value, key)))
        else for (const key of primitiveKeys(value)) define(result, key, fromSlot(builtins, primitiveSlot(value, key)))
        return result
      },
    ],
    [
      "getOwnPropertyNames",
      1,
      (_, args) => {
        const value = args[0]
        if (value instanceof HostNamespace) return new Arr(builtins.Array, [...ctx.namespaceKeys(value)])
        requireObjectCoercible(value, "getOwnPropertyNames")
        const names =
          value instanceof Obj ? ownKeys(value).filter((key) => typeof key === "string") : primitiveKeys(value)
        return new Arr(builtins.Array, names)
      },
    ],
  ])
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
    [
      "toLocaleString",
      0,
      (thisValue) =>
        withReads(() => invokeMethod(ctx.builtins, thisValue, "toString", "Object.prototype.toLocaleString")),
    ],
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
