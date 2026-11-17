import { Effect } from "effect"
import { DurableFn, Fn, Namespace, type Snapshot } from "../host-function.js"
import type { HostTarget } from "../host.js"
import { BufferObj } from "../stdlib/buffer.js"
import { StreamingResponse } from "../streaming-response.js"
import { errorMessage, errorType } from "./errors.js"
import type { Interpreter } from "./interpreter.js"
import { createErrorValue } from "./intrinsics.js"
import { member } from "./intrinsic-names.js"
import { MAX_ARRAY_LENGTH, MAX_VALUE_DEPTH } from "./limits.js"
import { AsyncIteratorSymbol, HostFailure, PendingThrow, rangeError, Throw, typeError } from "./model.js"
import { native } from "./native.js"
import {
  define,
  defineAccessor,
  get,
  has,
  hidden,
  keys,
  Arr,
  Bytes,
  DateObj,
  ErrorObj,
  HeadersObj,
  HostNamespace,
  MapObj,
  Obj,
  OMITTED,
  PromiseObj,
  RegExpObj,
  SetObj,
  URLObj,
  URLSearchParamsObj,
  coerceToString,
  type Value,
} from "./objects.js"
import { describeValue, isOpaque, typeofValue } from "./references.js"
import type { Translate } from "../runtime.js"
import { Interruption } from "./signals.js"
import { type HostOrigin, SnapshotError } from "../snapshot/codec.js"

/**
 * Where a value crossing from the host is: among the run's host globals, at `global` (so a function there can be found
 * again on resume), or inside a value a host function with `snapshot` hooks returned (`within`), at `path`
 * (undefined inside a Map or a Set, where no path leads).
 */
type Place = {
  readonly global?: ReadonlyArray<string> | undefined
  readonly within?: Within | undefined
  /** Whether it is among the globals at all, even where no path of names leads: inside an array, a Map or a Set. */
  readonly installed?: boolean | undefined
}

type Within = {
  readonly owner: string
  readonly root: object
  readonly path: ReadonlyArray<string | number> | undefined
}

/**
 * The global bindings of one run's host globals (see `Host`), and the bridge its calls cross (`ctx.hosts`).
 * Everything crossing the boundary is converted: plain data and built-in wrappers are copied, a host function becomes
 * a program function whose calls cross the same way, a namespace becomes a path the program reads into, and a host
 * Promise or Effect becomes a program promise.
 */
export const hostGlobals = <R>(
  ctx: Interpreter<R>,
  globals: Readonly<Record<string, unknown>>,
  translate: Required<Translate> = { functions: "error", promises: "error" },
): ReadonlyArray<readonly [string, Value]> => {
  const builtins = ctx.builtins
  // The `snapshot` hooks of the host functions among the globals that have them, by label.
  const owners = new Map<string, Snapshot>()
  const shape: Array<string> = []
  // The program functions wrapping functions inside values a hooked host function returned, by where they came from.
  const origins = new WeakMap<object, HostOrigin>()
  // The host function behind each function inside a result, so passing it back to a host function that takes
  // functions hands the host its own function. The functions among the globals are left out: whatever the host runs
  // around their calls (permission checks, say) runs when the program calls them, and the host could call one
  // without it.
  const hosted = new WeakMap<object, Function>()

  // With `waiting`, a promise that hasn't fulfilled goes there instead, and the copy is to be made again once it settles.
  // `back` collects the host functions that cross back; without it they are treated like any function.
  const toHost = (
    value: Value,
    label: string,
    depth: number,
    seen: Set<object>,
    waiting: Array<PromiseObj> | undefined,
    back: Array<Function> | undefined,
  ): unknown => {
    if (depth > MAX_VALUE_DEPTH) throw typeError(`${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
    if (isPrimitive(value)) return value
    const host = value instanceof Obj ? hosted.get(value) : undefined
    if (back !== undefined && host !== undefined) {
      back.push(host)
      return host
    }
    if (translate.functions === "drop" && typeofValue(value) === "function") return OMITTED
    if (seen.has(value as object)) throw typeError(`${label} contains a circular value.`)
    if (waiting !== undefined && value instanceof PromiseObj) {
      if (value.state !== "fulfilled") {
        waiting.push(value)
        return undefined
      }
      seen.add(value)
      const copied = toHost(value.result as Value, label, depth + 1, seen, waiting, back)
      seen.delete(value)
      return copied
    }
    if (!(value instanceof Obj) || isOpaque(value)) {
      throw typeError(`${label} contains ${describeValue(value)}, which cannot be passed to the host.`)
    }
    seen.add(value)
    const next = (item: Value) => {
      const copied = toHost(item, label, depth + 1, seen, waiting, back)
      return copied === OMITTED && (value instanceof MapObj || value instanceof SetObj) ? undefined : copied
    }
    if (value instanceof ErrorObj) {
      const name = coerceToString(get(value, "name"))
      const message = get(value, "message")
      const text = message === undefined ? "" : coerceToString(message)
      const copied =
        name === "AggregateError" ? new AggregateError([], text) : new (hostErrors.get(name) ?? Error)(text)
      for (const key of new Set(["cause", ...keys(value)])) {
        if (uncrossed.has(key) || !has(value, key)) continue
        const item = crossing(() => next(get(value, key)))
        if (item === left || item === OMITTED) continue
        Object.defineProperty(copied, key, {
          value: item,
          writable: true,
          configurable: true,
          enumerable: key !== "cause",
        })
      }
      seen.delete(value)
      return copied
    }
    const copied = value.toHost(next)
    seen.delete(value)
    return copied
  }

  const fromHost = (value: unknown, label: string, depth = 0, seen = new Set<object>(), place: Place = {}): Value => {
    if (depth > MAX_VALUE_DEPTH) throw typeError(`${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
    if (isPrimitive(value)) return value
    if (place.global !== undefined) {
      if (value instanceof Namespace) return namespace(value, label, place.global)
      if (value instanceof Fn && value.snapshot !== undefined) {
        owners.set(label, value.snapshot)
        shape.push(`${label} (snapshot hooks)`)
      }
    }
    if (value instanceof Fn || value instanceof DurableFn) {
      const owner =
        value instanceof Fn && value.snapshot !== undefined && place.global !== undefined ? label : undefined
      return wrap(value, label, { label, path: place.global, owner })
    }
    if (typeof value === "function") {
      const within = place.within
      const made = wrap(plain(value), label, { label, path: place.global, owner: within?.owner }, value)
      if (place.installed !== true) hosted.set(made, value)
      if (within !== undefined && within.path !== undefined) {
        origins.set(made, { owner: within.owner, root: within.root, path: within.path, label })
      }
      return made
    }
    if (value !== null && typeof value === "object") {
      const next = (item: unknown, path: string, key?: string | number) =>
        fromHost(item, path, depth + 1, seen, {
          global: place.global !== undefined && typeof key === "string" ? [...place.global, key] : undefined,
          within: place.within && {
            ...place.within,
            path: key === undefined || place.within.path === undefined ? undefined : [...place.within.path, key],
          },
          installed: place.installed,
        })
      // Nothing a host value hands back is kept: results are read as primitives or copied. Where the value's own
      // method could hand back host storage or an object (`getTime`, `slice`, `map`), its internal data is read.
      if (value instanceof Date) return new DateObj(builtins.Date, Date.prototype.getTime.call(value))
      if (value instanceof StreamingResponse) {
        const response = value.response
        const body = response.body
        const stream = new Obj(builtins.Object)
        if (body) {
          defineAccessor(stream, "locked", () => body.locked)
          define(
            stream,
            "cancel",
            next(async (reason?: unknown) => body.cancel(reason), `${label}.body.cancel`),
          )
          define(
            stream,
            "getReader",
            next((options?: { mode?: string }) => {
              if (options?.mode !== undefined) throw new TypeError("Only the default stream reader is supported.")
              const reader = body.getReader()
              return {
                read: async () => reader.read(),
                cancel: async (reason?: unknown) => reader.cancel(reason),
                releaseLock: () => reader.releaseLock(),
              }
            }, `${label}.body.getReader`),
          )
          define(
            stream,
            AsyncIteratorSymbol,
            next(() => {
              const iterator = body.values()
              return {
                next: async () => iterator.next(),
                return: async () => iterator.return!(),
              }
            }, `${label}.body[Symbol.asyncIterator]`),
          )
        }
        const result = new Obj(builtins.Object)
        for (const key of ["url", "status", "statusText", "ok", "headers"] as const)
          define(result, key, next(response[key], `${label}.${key}`))
        define(result, "redirected", value.redirected)
        define(result, "body", body ? stream : null)
        defineAccessor(result, "bodyUsed", () => response.bodyUsed)
        for (const key of ["text", "json", "bytes", "arrayBuffer"] as const)
          define(
            result,
            key,
            next(async () => response[key](), `${label}.${key}`),
          )
        return result
      }
      if (value instanceof RegExp) return new RegExpObj(builtins.RegExp, value.source, value.flags)
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
        return new BufferObj(builtins.Buffer, new Uint8Array(value))
      if (value instanceof Uint8Array) return new Bytes(builtins.Uint8Array, new Uint8Array(value))
      if (value instanceof ArrayBuffer) {
        const view = new Uint8Array(value)
        // Only a real buffer has bytes to view; anything else would be read as array-like and lose them silently.
        if (view.buffer !== value)
          throw typeError(`${label} produced ${describeHost(value)}, which the program cannot hold.`)
        return new Bytes(builtins.Uint8Array, new Uint8Array(view))
      }
      if (value instanceof Error) {
        if (seen.has(value)) throw typeError(`${label} produced a circular value.`)
        seen.add(value)
        const copied = createErrorValue(builtins[errorType(value)], errorMessage(value))
        const fields = value as unknown as Record<string, unknown>
        for (const key of new Set(["cause", ...Object.keys(value)])) {
          if (uncrossed.has(key) || !(key in value)) continue
          // Read once: a getter could pass the check and then hand back a function.
          const field = fields[key]
          if (typeof field === "function") continue
          const item = crossing(() => next(field, `${label}.${key}`, key))
          if (item === left) continue
          define(copied, key, item, key === "cause" ? hidden : undefined)
        }
        seen.delete(value)
        return copied
      }
      if (value instanceof URL) return new URLObj(builtins.URL, builtins.URLSearchParams, new URL(value.href))
      if (value instanceof URLSearchParams) {
        return new URLSearchParamsObj(builtins.URLSearchParams, new URLSearchParams(value))
      }
      if (value instanceof Headers) return new HeadersObj(builtins.Headers, new Headers(value))
      if (value instanceof Map) {
        const wrapped = new MapObj(builtins.Map)
        for (const [key, item] of value) wrapped.map.set(next(key, label), next(item, label))
        return wrapped
      }
      if (value instanceof Set) {
        const wrapped = new SetObj(builtins.Set)
        for (const item of value) wrapped.set.add(next(item, label))
        return wrapped
      }
      if (seen.has(value)) throw typeError(`${label} produced a circular value.`)
      seen.add(value)
      if (Array.isArray(value)) {
        const length = value.length
        if (length > MAX_ARRAY_LENGTH) {
          throw rangeError(`${label} produced an array of ${length} items; at most ${MAX_ARRAY_LENGTH} can cross.`)
        }
        // Filled in order so the copy stays a dense array; holes stay holes, as a copy made with `map` would leave them.
        const items: Array<Value> = []
        for (let index = 0; index < length; index += 1) {
          if (index in value) items[index] = next(value[index], `${label}[${index}]`, index)
        }
        items.length = length
        seen.delete(value)
        return new Arr(builtins.Array, items)
      }
      const prototype = Object.getPrototypeOf(value)
      if (prototype === Object.prototype || prototype === null) {
        const copied = new Obj(builtins.Object)
        for (const [key, item] of Object.entries(value)) define(copied, key, next(item, `${label}.${key}`, key))
        seen.delete(value)
        return copied
      }
    }
    throw typeError(`${label} produced ${describeHost(value)}, which the program cannot hold.`)
  }

  // A host function as a program function: its calls go through the run's host calls (see `HostCalls.call`). The
  // name and length come from the host function, read once, and only as text and a count.
  // `callee` is the program function calling it, when that is not the one made here (see `rewrap`).
  const wrap = (
    fn: Fn<unknown> | DurableFn<unknown>,
    label: string,
    target: HostTarget,
    source?: Function,
    callee?: Obj,
  ) => {
    const named = source ?? (fn instanceof Fn ? fn.run : undefined)
    const own: unknown = named?.name
    // A host function made inline has no name of its own: it is named by where it is.
    const name =
      source === undefined && (typeof own !== "string" || own === "") ? label.slice(label.lastIndexOf(".") + 1) : own
    const length: unknown = named?.length ?? 0
    const made = native(builtins, {
      runtime: "host",
      name: typeof name === "string" ? name : "",
      length: typeof length === "number" && Number.isSafeInteger(length) && length >= 0 ? length : 0,
      call: (_, values, site) => ctx.vm.hosts.call(fn, values, site, target, callee ?? made),
      ...(fn instanceof Fn && fn.constructible
        ? { construct: (values, _, site) => ctx.vm.hosts.call(fn, values, site, target, callee ?? made) }
        : {}),
    })
    return made
  }

  // A namespace among the globals: a path the program reads into, whose calls ask `resolve` for the function.
  const namespace = (value: Namespace<unknown>, label: string, global: ReadonlyArray<string>) => {
    ctx.hostNamespaces.set(label, {
      keys: (path) => value.keys(path),
      call: (path, values, site) => {
        const found = value.resolve(path)
        if (found instanceof HostFailure) throw found
        return ctx.vm.hosts.call(
          found,
          values,
          site,
          {
            label: path.reduce<string>((at, key) => member(at, key), label),
            path: [...global, ...path],
            owner: undefined,
          },
          new HostNamespace(label, path),
        )
      },
    })
    shape.push(`${label} (namespace)`)
    return new HostNamespace(label, [])
  }

  const failure = (reason: unknown, label: string): unknown => {
    if (
      reason instanceof HostFailure ||
      reason instanceof PendingThrow ||
      reason instanceof Interruption ||
      reason instanceof Throw
    ) {
      return reason
    }
    try {
      return new Throw(fromHost(reason, label))
    } catch (error) {
      return error
    }
  }

  const hooks = (owner: string) => {
    const snapshot = owners.get(owner)
    if (snapshot === undefined) throw new SnapshotError(`The host function ${owner} has no snapshot hooks.`)
    return snapshot
  }

  ctx.hosts = {
    shape,
    toHost: (values, label, waiting, back) =>
      values.map((item, index) => {
        const copied = toHost(
          item,
          `Argument ${index + 1} to ${label}`,
          0,
          new Set(),
          translate.promises === "await" ? waiting : undefined,
          back,
        )
        return copied === OMITTED ? undefined : copied
      }),
    fromHost: (value, label, owner) =>
      fromHost(value, label, 0, new Set(), {
        within:
          owner !== undefined && ((typeof value === "object" && value !== null) || typeof value === "function")
            ? { owner, root: value, path: [] }
            : undefined,
      }),
    failure,
    isPending: (value) => value instanceof Promise || Effect.isEffect(value),
    invoke: (fn, args, key, label) => {
      let result: unknown
      try {
        result = fn.run(args, { key, suspending: () => false })
      } catch (reason) {
        throw failure(reason, label)
      }
      if (Effect.isEffect(result)) return { kind: "block", work: result }
      if (result instanceof Promise) return { kind: "pending", work: result }
      return { kind: "value", value: result }
    },
    resolve: (path) => {
      let at: unknown = globals
      for (let index = 0; index < path.length; index++) {
        if (at instanceof Namespace) {
          const found = at.resolve(path.slice(index))
          return found instanceof HostFailure ? undefined : found
        }
        if (typeof at !== "object" || at === null || !Object.hasOwn(at, path[index]!)) return undefined
        at = (at as { readonly [key: string]: unknown })[path[index]!]
      }
      return at instanceof Fn || at instanceof DurableFn ? at : undefined
    },
    origin: (value) => origins.get(value),
    encode: (owner, root) => hostStep(owner, "save", () => hooks(owner).encode(root)),
    decode: (owner, data) => {
      const root = hostStep(owner, "restore", () => hooks(owner).decode(data))
      if ((typeof root !== "object" && typeof root !== "function") || root === null) {
        throw new SnapshotError(
          `The host function ${owner} restored a value it returned as ${typeof root}, not an object.`,
        )
      }
      return root
    },
    rewrap: (target, origin) => {
      const host = origin.path.reduce<unknown>(
        (at, key) =>
          (typeof at === "object" && at !== null) || typeof at === "function"
            ? (at as { readonly [key: string | number]: unknown })[key]
            : undefined,
        origin.root,
      )
      if (typeof host !== "function") {
        throw new SnapshotError(
          `The host function ${origin.owner} restored a value with no function at ${origin.label}, so this state can't resume.`,
        )
      }
      const made = wrap(
        plain(host),
        origin.label,
        { label: origin.label, path: undefined, owner: origin.owner },
        host,
        target,
      )
      // The restored function keeps its own properties; only what calling it does comes from the new one.
      Object.assign(target, { tag: made.tag, call: made.call, construct: made.construct, callback: made.callback })
      origins.set(target, origin)
      hosted.set(target, host)
    },
  }

  return Object.entries(globals).map(
    ([name, value]) => [name, fromHost(value, name, 0, new Set(), { global: [name], installed: true })] as const,
  )
}

// A plain host function (one inside a result, or among the globals) is called like a `sync` host function that takes
// functions.
const plain = (value: Function) => new Fn((args) => value(...args), "sync", false, undefined, false, true)

// Runs a host function's `snapshot` hook; what goes wrong is the state's problem, said as such.
const hostStep = <A>(owner: string, what: "save" | "restore", step: () => A): A => {
  try {
    return step()
  } catch (error) {
    if (error instanceof SnapshotError) throw error
    throw new SnapshotError(
      `The host function ${owner} couldn't ${what} a value it returned: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * An error crosses as its name, message, `cause`, and own enumerable fields, such as Node's `code`, `errno`,
 * `syscall`, and `path`. `stack` stays on its own side, `message` crosses once as text, and no field may shadow an
 * Error method. A field that cannot cross (a socket, a handle, a function) is left behind so the error itself always
 * arrives.
 */
const uncrossed = new Set(["stack", "message", "constructor", "toString", "__proto__"])
const left = Symbol("left behind")
const crossing = <T>(convert: () => T): T | typeof left => {
  try {
    return convert()
  } catch (reason) {
    if (reason instanceof PendingThrow) return left
    throw reason
  }
}

const hostErrors = new Map<string, ErrorConstructor>([
  ["TypeError", TypeError],
  ["RangeError", RangeError],
  ["SyntaxError", SyntaxError],
  ["ReferenceError", ReferenceError],
  ["EvalError", EvalError],
  ["URIError", URIError],
])

// The primitives the interpreter operates on; symbols and BigInts are not among them.
const isPrimitive = (value: unknown): value is string | number | boolean | null | undefined =>
  value === null ||
  value === undefined ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"

const describeHost = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return `a ${typeof value}`
  const name = (value as { constructor?: { name?: string } }).constructor?.name
  if (name === undefined || name === "") return "an object"
  return `${/^[AEIO]/.test(name) ? "an" : "a"} ${name}`
}
