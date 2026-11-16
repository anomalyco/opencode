import { Effect } from "effect"
import { type Extension, isAsync, StreamingResponse } from "../extension.js"
import { hooked } from "../tool-runtime.js"
import { errorMessage, errorType } from "./errors.js"
import type { Interpreter } from "./interpreter.js"
import { createErrorValue } from "./intrinsics.js"
import { MAX_ARRAY_LENGTH, MAX_VALUE_DEPTH } from "./limits.js"
import { type AstNode, AsyncIteratorSymbol, PendingThrow, rangeError, Throw, typeError } from "./model.js"
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
  PromiseObj,
  MapObj,
  Obj,
  RegExpObj,
  SetObj,
  URLObj,
  URLSearchParamsObj,
  coerceToString,
  type Value,
} from "./objects.js"
import { describeValue, isOpaque } from "./references.js"
import { Push } from "./signals.js"
import type { ExtensionRequest } from "../scheduler.js"
import { type HostOrigin, SnapshotError } from "../snapshot/codec.js"

/**
 * Where a value crossing from the host is: under an extension's global object (`root` undefined), whose functions are
 * entry points that fire the hooks, or inside a value a function of an extension with `snapshot` hooks returned, at
 * `path` (undefined inside a Map or a Set, where no path leads).
 */
type Within = {
  readonly extension: Extension
  readonly root: object | undefined
  readonly path: ReadonlyArray<string | number> | undefined
}

/**
 * The global bindings of one run's extensions. Everything crossing the boundary is converted: plain data and built-in
 * wrappers are copied, a host function becomes a program function whose calls cross the same way, and a host Promise
 * or Effect becomes a program promise.
 */
export const extensionGlobals = <R>(
  ctx: Interpreter<R>,
  extensions: ReadonlyArray<Extension>,
): ReadonlyArray<readonly [string, Value]> => {
  const builtins = ctx.builtins
  const byName = new Map(extensions.map((extension) => [extension.name, extension]))
  // The program functions wrapping functions inside values a hooked extension returned, by where they came from.
  const origins = new WeakMap<object, HostOrigin>()

  const toHost = (value: Value, label: string, depth = 0, seen = new Set<object>()): unknown => {
    if (depth > MAX_VALUE_DEPTH) throw typeError(`${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
    if (isPrimitive(value)) return value
    if (!(value instanceof Obj) || isOpaque(value)) {
      throw typeError(`${label} contains ${describeValue(value)}, which cannot be passed to an extension.`)
    }
    if (seen.has(value)) throw typeError(`${label} contains a circular value.`)
    seen.add(value)
    const next = (item: Value) => toHost(item, label, depth + 1, seen)
    if (value instanceof ErrorObj) {
      const name = coerceToString(get(value, "name"))
      const message = get(value, "message")
      const text = message === undefined ? "" : coerceToString(message)
      const copied =
        name === "AggregateError" ? new AggregateError([], text) : new (hostErrors.get(name) ?? Error)(text)
      for (const key of new Set(["cause", ...keys(value)])) {
        if (uncrossed.has(key) || !has(value, key)) continue
        const item = crossing(() => next(get(value, key)))
        if (item === left) continue
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

  // `within` says where the value is, so a function inside it fires the hooks, or can be saved; see `Within`.
  const fromHost = (value: unknown, label: string, depth = 0, seen = new Set<object>(), within?: Within): Value => {
    if (depth > MAX_VALUE_DEPTH) throw typeError(`${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
    if (isPrimitive(value)) return value
    if (typeof value === "function") return wrap(value, label, within)
    if (value !== null && typeof value === "object") {
      const next = (item: unknown, path: string, key?: string | number) =>
        fromHost(
          item,
          path,
          depth + 1,
          seen,
          within && {
            ...within,
            path: key === undefined || within.path === undefined ? undefined : [...within.path, key],
          },
        )
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

  // A host function as a program function. Arguments cross in; for a global or a global object's function, the
  // `extension.before` hook runs before the host function is called, so a call it denies never reaches the host. The
  // host's result, or what it threw, crosses out so the program catches a copy, and `extension.after` sees how the
  // call ended. Functions inside results are part of a value's API and skip the hooks; one inside a value an extension
  // with `snapshot` hooks returned is known by where it came from, so a suspended run can save it.
  const wrap = (value: Function, label: string, within: Within | undefined) => {
    // The host function's own `name` and `length` can be anything, even getters: each is read once, and only text
    // and a count cross.
    const name: unknown = value.name
    const length: unknown = value.length
    const extension = within?.extension.name
    const root = within?.root
    const wrapped = native(builtins, {
      runtime: "extension",
      name: typeof name === "string" ? name : "",
      length: typeof length === "number" && Number.isSafeInteger(length) && length >= 0 ? length : 0,
      call: (_, values, site) => {
        const args = values.map((item, index) => toHost(item, `Argument ${index + 1} to ${label}`))
        const invocation =
          within !== undefined && root === undefined ? { extension: extension!, name: label, args } : undefined
        // A denied call fails the way the global would: an async global rejects its promise, a sync one throws.
        if (isAsync(value)) {
          return pending(ctx, { stage: "run", label, extension, invocation, host: value, args, threw: false }, site)
        }
        return new Push("extension call", [value, args, label, invocation, extension])
      },
    })
    if (root !== undefined && within!.path !== undefined) {
      origins.set(wrapped, { extension: extension!, root, path: within!.path, label })
    }
    return wrapped
  }

  ctx.hosts = {
    extensions: extensions.map((extension) => ({ name: extension.name, hooked: extension.snapshot !== undefined })),
    origin: (value) => origins.get(value),
    encode: (name, root) => hostStep(name, "save", () => hooks(name).encode(root)),
    decode: (name, data) => {
      const root = hostStep(name, "restore", () => hooks(name).decode(data))
      if ((typeof root !== "object" && typeof root !== "function") || root === null) {
        throw new SnapshotError(
          `The extension "${name}" restored a value it returned as ${typeof root}, not an object.`,
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
          `The extension "${origin.extension}" restored a value with no function at ${origin.label}, so this state can't resume.`,
        )
      }
      const made = wrap(host, origin.label, {
        extension: byName.get(origin.extension)!,
        root: origin.root,
        path: origin.path,
      })
      // The restored function keeps its own properties; only what calling it does comes from the new one.
      Object.assign(target, { tag: made.tag, call: made.call, construct: made.construct, callback: made.callback })
      origins.set(target, origin)
    },
  }

  const hooks = (name: string) => {
    const snapshot = byName.get(name)?.snapshot
    if (snapshot === undefined) throw new SnapshotError(`The extension "${name}" has no snapshot hooks.`)
    return snapshot
  }

  // The Effect each step of an extension call runs as, with the program's services in its requirements.
  ctx.extensionWork = (request: ExtensionRequest) => {
    const label = request.label
    const call = request.invocation
    const cross = (reason: unknown) => new Throw(fromHost(reason, label))
    const hooks = ctx.tools.hooks
    const before = call && hooks["extension.before"]?.(call).pipe(Effect.mapError(cross))
    if (request.stage === "before") return before ?? Effect.void
    const after = call && hooks["extension.after"]
    const extension = request.extension === undefined ? undefined : byName.get(request.extension)
    // What a function returns is a value of its extension's, which its `snapshot` hooks save, when it has them.
    const settle = (effect: Effect.Effect<unknown, unknown, R>) =>
      (after ? hooked(call, undefined, after, effect) : effect).pipe(
        Effect.mapBoth({
          onFailure: cross,
          onSuccess: (result) =>
            fromHost(
              result,
              label,
              0,
              new Set(),
              extension?.snapshot !== undefined &&
                ((typeof result === "object" && result !== null) || typeof result === "function")
                ? { extension, root: result, path: [] }
                : undefined,
            ),
        }),
      )
    if (request.stage === "settle") return settle(outcome<R>(request.host, request.threw))
    return Effect.andThen(
      before ?? Effect.void,
      settle(Effect.suspend(() => outcome<R>(...callHost(request.host as Function, request.args)))),
    )
  }

  return extensions.flatMap((extension) =>
    Object.entries(extension.globals).map(
      ([name, value]) =>
        [name, fromHost(value, name, 0, new Set(), { extension, root: undefined, path: undefined })] as const,
    ),
  )
}

// An asynchronous host call: the program holds a promise that settles when the host's work does.
const pending = <R>(ctx: Interpreter<R>, call: ExtensionRequest, site: AstNode | undefined) => {
  const resolving = ctx.vm.scheduler.resolving(ctx.vm.scheduler.newPromise(), site)
  ctx.vm.hosts.host({ kind: "extension", call }, { label: call.label, result: "value", resolving, site })
  return resolving.promise
}

/**
 * Calls a synchronous extension function's host function, once its `extension.before` hook allowed it: a promise for
 * a result that settles later (an Effect or a Promise), or the request that settles what it returned or threw now.
 */
export const startExtensionCall = <R>(
  ctx: Interpreter<R>,
  host: Function,
  args: ReadonlyArray<unknown>,
  call: Pick<ExtensionRequest, "label" | "extension" | "invocation">,
  site: AstNode | undefined,
): PromiseObj | ExtensionRequest => {
  const [result, threw] = callHost(host, args)
  const request = { stage: "settle", ...call, host: result, args, threw } as const
  if (!threw && (Effect.isEffect(result) || result instanceof Promise)) return pending(ctx, request, site)
  return request
}

// Runs an extension's `snapshot` hook; what goes wrong is the state's problem, said as such.
const hostStep = <A>(extension: string, what: "save" | "restore", step: () => A): A => {
  try {
    return step()
  } catch (error) {
    if (error instanceof SnapshotError) throw error
    throw new SnapshotError(
      `The extension "${extension}" couldn't ${what} a value it returned: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Calls a host function: what it returned, or what it threw. */
const callHost = (value: Function, args: ReadonlyArray<unknown>): [result: unknown, threw: boolean] => {
  try {
    return [value.apply(undefined, args), false]
  } catch (reason) {
    return [reason, true]
  }
}

/**
 * What a host function's call settles as: a returned Effect or Promise settles later; a returned value or a throw
 * settles now.
 */
const outcome = <R>(result: unknown, threw: boolean): Effect.Effect<unknown, unknown, R> => {
  if (threw) return Effect.fail(result)
  // Extension.Services adds an Effect global's requirements to R.
  if (Effect.isEffect(result)) return result as Effect.Effect<unknown, unknown, R>
  if (result instanceof Promise) return Effect.tryPromise({ try: () => result, catch: (reason) => reason })
  return Effect.succeed(result)
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
