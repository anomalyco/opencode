import { Effect } from "effect"
import type { Extension } from "../extension.js"
import { coerceToString } from "../stdlib/value.js"
import type { Interpreter } from "./interpreter.js"
import { createErrorValue, isErrorType } from "./intrinsics.js"
import { MAX_VALUE_DEPTH } from "./limits.js"
import { Throw, typeError } from "./model.js"
import { constructor, fn } from "./native.js"
import {
  Callable,
  define,
  defineAccessor,
  entries,
  get,
  hidden,
  type Native,
  Arr,
  Bytes,
  DateObj,
  ErrorObj,
  GeneratorObj,
  Handle,
  MapObj,
  Obj,
  PromiseObj,
  RegExpObj,
  SetObj,
  URLObj,
  URLSearchParamsObj,
} from "./objects.js"
import { describeValue } from "./references.js"

type Class = Function & { readonly prototype: object }

const isClass = (value: unknown): value is Class =>
  typeof value === "function" && typeof value.prototype === "object" && value.prototype !== null

// Own keys the native function already carries.
const ownFunctionKeys = new Set(["length", "name", "prototype"])
const ownPrototypeKeys = new Set(["constructor"])

/**
 * The global bindings of one run's extensions. Everything crossing the boundary is converted: plain data is
 * copied, built-in wrappers are copied, instances of exposed classes travel as handles, and a host Promise becomes
 * a program promise. Prototypes, constructors, and handle identity are all per run.
 */
export const extensionGlobals = <R>(
  ctx: Interpreter<R>,
  extensions: ReadonlyArray<Extension>,
): ReadonlyArray<readonly [string, unknown]> => {
  const builtins = ctx.builtins
  const classes = new Set(extensions.flatMap((extension) => Object.values(extension.globals)).filter(isClass))
  // Host prototype object → this run's program prototype, so an instance wraps as its most-derived exposed class.
  const protoOf = new Map<object, Obj>()
  const exposed = new Map<Class, { ctor: Native<R>; proto: Obj }>()
  const classOf = new Map<unknown, Class>()
  const handles = new WeakMap<object, Handle>()

  const toHost = (value: unknown, label: string, depth = 0, seen = new Set<object>()): unknown => {
    if (depth > MAX_VALUE_DEPTH) throw typeError(`${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
    if (value === null || typeof value !== "object") {
      if (isPrimitive(value)) return value
      throw typeError(`${label} contains ${describeValue(value)}, which cannot be passed to an extension.`)
    }
    if (value instanceof Handle) return value.instance
    if (value instanceof Bytes) return new Uint8Array(value.bytes)
    if (value instanceof DateObj) return new Date(value.time)
    if (value instanceof RegExpObj) return new RegExp(value.regex.source, value.regex.flags)
    if (value instanceof URLObj) return new URL(value.url.href)
    if (value instanceof URLSearchParamsObj) return new URLSearchParams(value.params)
    const next = (item: unknown) => toHost(item, label, depth + 1, seen)
    if (value instanceof MapObj) return new Map([...value.map].map(([key, item]) => [next(key), next(item)]))
    if (value instanceof SetObj) return new Set([...value.set].map(next))
    if (
      !(value instanceof Obj) ||
      value instanceof Callable ||
      value instanceof GeneratorObj ||
      value instanceof PromiseObj
    ) {
      throw typeError(`${label} contains ${describeValue(value)}, which cannot be passed to an extension.`)
    }
    if (value instanceof ErrorObj) {
      const name = coerceToString(get(value, "name"))
      const message = get(value, "message")
      const text = message === undefined ? "" : coerceToString(message)
      return name === "AggregateError" ? new AggregateError([], text) : new (hostErrors[name] ?? Error)(text)
    }
    if (seen.has(value)) throw typeError(`${label} contains a circular value.`)
    seen.add(value)
    const copied =
      value instanceof Arr
        ? value.items.map(next)
        : Object.fromEntries(
            entries(value)
              .filter(([key]) => key !== "__proto__")
              .map(([key, item]) => [key, next(item)]),
          )
    seen.delete(value)
    return copied
  }

  const fromHost = (value: unknown, label: string, depth = 0, seen = new Set<object>()): unknown => {
    if (depth > MAX_VALUE_DEPTH) throw typeError(`${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
    if (isPrimitive(value)) return value
    if (value !== null && typeof value === "object") {
      const existing = handles.get(value)
      if (existing !== undefined) return existing
      const proto = handlePrototype(value)
      if (proto !== undefined) {
        const handle = new Handle(proto, value)
        handles.set(value, handle)
        return handle
      }
      if (value instanceof Date) return new DateObj(builtins.Date, value.getTime())
      if (value instanceof RegExp) return new RegExpObj(builtins.RegExp, value.source, value.flags)
      if (value instanceof Uint8Array) return new Bytes(builtins.Uint8Array, new Uint8Array(value))
      if (value instanceof ArrayBuffer) return new Bytes(builtins.Uint8Array, new Uint8Array(value.slice(0)))
      if (value instanceof Error) {
        return createErrorValue(builtins[isErrorType(value.name) ? value.name : "Error"], value.message)
      }
      if (value instanceof URL) return new URLObj(builtins.URL, builtins.URLSearchParams, new URL(value.href))
      if (value instanceof URLSearchParams) {
        return new URLSearchParamsObj(builtins.URLSearchParams, new URLSearchParams(value))
      }
      const next = (item: unknown) => fromHost(item, label, depth + 1, seen)
      if (value instanceof Map) {
        const wrapped = new MapObj(builtins.Map)
        for (const [key, item] of value) wrapped.map.set(next(key), next(item))
        return wrapped
      }
      if (value instanceof Set) {
        const wrapped = new SetObj(builtins.Set)
        for (const item of value) wrapped.set.add(next(item))
        return wrapped
      }
      if (seen.has(value)) throw typeError(`${label} produced a circular value.`)
      seen.add(value)
      if (Array.isArray(value)) {
        const copied = new Arr(builtins.Array, value.map(next))
        seen.delete(value)
        return copied
      }
      const prototype = Object.getPrototypeOf(value)
      if (prototype === Object.prototype || prototype === null) {
        const copied = new Obj(builtins.Object)
        for (const [key, item] of Object.entries(value)) define(copied, key, next(item))
        seen.delete(value)
        return copied
      }
    }
    throw typeError(`${label} produced ${describeHost(value)}, which the program cannot hold.`)
  }

  const handlePrototype = (instance: object): Obj | undefined => {
    for (let level = Object.getPrototypeOf(instance); level !== null; level = Object.getPrototypeOf(level)) {
      const proto = protoOf.get(level)
      if (proto !== undefined) return proto
    }
    return undefined
  }

  // Runs host code with already-converted inputs. Whatever it returns, resolves, throws, or rejects with crosses
  // the same way, so the program catches what the author threw.
  const invoke = (run: () => unknown, label: string): Effect.Effect<unknown, unknown, R> => {
    const thrown = (reason: unknown) => new Throw(fromHost(reason, label))
    let result: unknown
    try {
      result = run()
    } catch (reason) {
      return Effect.fail(thrown(reason))
    }
    if (!(result instanceof Promise)) return Effect.succeed(fromHost(result, label))
    return ctx.pending.create(
      Effect.map(Effect.tryPromise({ try: () => result, catch: thrown }), (settled) => fromHost(settled, label)),
    )
  }

  const args = (values: Array<unknown>, label: string): Array<unknown> =>
    values.map((value, index) => toHost(value, `Argument ${index + 1} to ${label}`))

  // Own members of each level from `from` up to (excluding) `root`, child first, as JS resolves them.
  const members = (
    target: Obj,
    from: object,
    root: object,
    skip: ReadonlySet<string>,
    label: string,
    receiver: (thisValue: unknown, member: string) => unknown,
  ): void => {
    for (let level: object | null = from; level !== null && level !== root; level = Object.getPrototypeOf(level)) {
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(level))) {
        if (skip.has(key) || target.props.has(key)) continue
        const name = `${label}.${key}`
        if (typeof descriptor.value === "function") {
          const method: Function = descriptor.value
          const impl = (thisValue: unknown, values: Array<unknown>) => {
            const self = receiver(thisValue, name)
            const converted = args(values, name)
            return invoke(() => method.apply(self, converted), name)
          }
          define(target, key, fn<R>(builtins, key, method.length, impl), hidden)
          continue
        }
        // Data properties stay host-side: a program write to one would change the host class itself.
        if ("value" in descriptor) continue
        const get = descriptor.get
        const set = descriptor.set
        defineAccessor(
          target,
          key,
          get === undefined
            ? undefined
            : (thisValue) => {
                const value = get.call(receiver(thisValue, name))
                if (value instanceof Promise)
                  throw typeError(`${name} returned a Promise; a getter must be synchronous.`)
                return fromHost(value, name)
              },
          set === undefined
            ? undefined
            : (thisValue, value) => {
                set.call(receiver(thisValue, name), toHost(value, `${name} value`))
              },
        )
      }
    }
  }

  const expose = (cls: Class): { ctor: Native<R>; proto: Obj } => {
    const existing = exposed.get(cls)
    if (existing !== undefined) return existing
    const ancestor = exposedAncestor(cls)
    const base = ancestor === undefined ? undefined : expose(ancestor)
    const proto = new Obj(base === undefined ? builtins.Object : base.proto)
    protoOf.set(cls.prototype, proto)
    const name = cls.name
    const ctor = constructor<R>(builtins, proto, {
      name,
      length: cls.length,
      call: (_, values) => {
        const converted = args(values, name)
        return invoke(() => cls.apply(undefined, converted), name)
      },
      construct: (values) => {
        const label = `new ${name}`
        const construct = cls as new (...values: Array<unknown>) => object
        const converted = args(values, label)
        return invoke(() => new construct(...converted), label)
      },
    })
    if (base !== undefined) ctor.proto = base.ctor
    const entry = { ctor, proto }
    exposed.set(cls, entry)
    classOf.set(ctor, cls)
    // A static called through an exposed subclass sees that subclass as `this`, like JS.
    members(ctor, cls, ancestor ?? Function.prototype, ownFunctionKeys, name, (thisValue) => {
      const called = classOf.get(thisValue)
      return called !== undefined && (called === cls || called.prototype instanceof cls) ? called : cls
    })
    members(
      proto,
      cls.prototype,
      ancestor?.prototype ?? Object.prototype,
      ownPrototypeKeys,
      `${name}.prototype`,
      (thisValue, member) => {
        if (thisValue instanceof Handle && thisValue.instance instanceof cls) return thisValue.instance
        throw typeError(`Illegal invocation: ${member} called on ${describeValue(thisValue)}.`)
      },
    )
    return entry
  }

  const exposedAncestor = (cls: Class): Class | undefined => {
    for (let level = Object.getPrototypeOf(cls); isClass(level); level = Object.getPrototypeOf(level)) {
      if (classes.has(level)) return level
    }
    return undefined
  }

  return extensions.flatMap((extension) =>
    Object.entries(extension.globals).map(([name, value]) => {
      if (isClass(value)) return [name, expose(value).ctor] as const
      const impl = (_: unknown, values: Array<unknown>) => {
        const converted = args(values, name)
        return invoke(() => value.apply(undefined, converted), name)
      }
      return [name, fn<R>(builtins, name, value.length, impl)] as const
    }),
  )
}

const hostErrors: Record<string, ErrorConstructor | undefined> = {
  TypeError,
  RangeError,
  SyntaxError,
  ReferenceError,
  EvalError,
  URIError,
}

// The primitives the interpreter operates on; symbols and BigInts are not among them.
const isPrimitive = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"

const describeHost = (value: unknown): string => {
  if (typeof value === "function") return "a function"
  if (typeof value !== "object" || value === null) return `a ${typeof value}`
  const name = (value as { constructor?: { name?: string } }).constructor?.name
  return name === undefined || name === "" ? "an object" : `a ${name}`
}
