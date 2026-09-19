import type { BlockStatement, Expression, Pattern } from "acorn"
import type { Effect, Fiber } from "effect"
import { checkArrayLength } from "./limits.js"
import {
  AsyncIteratorSymbol,
  type Binding,
  type GeneratorRequestKind,
  IteratorSymbol,
  type PendingThrow,
} from "./model.js"

/** Property attributes, as in a JS property descriptor. */
export type Attributes = {
  readonly writable: boolean
  readonly enumerable: boolean
  readonly configurable: boolean
}

export type Getter = (receiver: unknown) => unknown
export type Setter = (receiver: unknown, value: unknown) => void

/** One own property: a data slot or a native accessor pair. */
export type Slot =
  | { value: unknown; writable: boolean; enumerable: boolean; configurable: boolean }
  | { get: Getter | undefined; set: Setter | undefined; enumerable: boolean; configurable: boolean }

/** Ordinary assignment: writable, enumerable, configurable. */
export const data: Attributes = { writable: true, enumerable: true, configurable: true }
/** Built-in methods and `constructor`: writable and configurable but hidden from enumeration. */
export const hidden: Attributes = { writable: true, enumerable: false, configurable: true }
/** Function `name` and `length`: read-only but deletable. */
export const readonly: Attributes = { writable: false, enumerable: false, configurable: true }
/** Constants such as `Math.PI` and a constructor's `prototype`. */
export const frozen: Attributes = { writable: false, enumerable: false, configurable: false }

/** An object owned by the program: own properties plus a prototype link. */
export class Obj {
  readonly props = new Map<string | symbol, Slot>()
  constructor(public proto: Obj | null) {}
}

export class Arr extends Obj {
  constructor(
    proto: Obj,
    readonly items: Array<unknown> = [],
  ) {
    super(proto)
  }
}

/** An object with the [[ErrorData]] slot: what `Error.prototype.toString` and the host boundary recognize as an error. */
export class ErrorObj extends Obj {
  /** The interpreter failure this error materialized from, so rethrowing it keeps the diagnostic kind and location. */
  host?: PendingThrow
}

export abstract class Callable extends Obj {
  constructor(proto: Obj, name: string, length: number) {
    super(proto)
    define(this, "length", length, readonly)
    define(this, "name", name, readonly)
  }
}

export class Fn extends Callable {
  constructor(
    proto: Obj,
    name: string,
    readonly parameters: ReadonlyArray<Pattern>,
    readonly body: BlockStatement | Expression,
    readonly capturedScopes: ReadonlyArray<Map<string, Binding>>,
    readonly async: boolean,
    readonly generator: boolean,
  ) {
    const optional = parameters.findIndex((p) => p.type === "AssignmentPattern" || p.type === "RestElement")
    super(proto, name, optional === -1 ? parameters.length : optional)
  }
}

export type NativeCall<R> = (thisValue: unknown, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
export type NativeConstruct<R> = (args: Array<unknown>, newTarget: Callable) => Effect.Effect<unknown, unknown, R>

export type NativeOptions<R> = {
  readonly name: string
  readonly length?: number
  readonly call: NativeCall<R>
  /** `new name(...)`; without it the function is not a constructor. */
  readonly construct?: NativeConstruct<R>
  /** Whether callback sites (array methods, replacers, promise reactions) admit this function. Defaults to true. */
  readonly callback?: boolean
}

export class Native<R = never> extends Callable {
  readonly call: NativeCall<R>
  readonly construct: NativeConstruct<R> | undefined
  readonly callback: boolean

  constructor(proto: Obj, options: NativeOptions<R>) {
    super(proto, options.name, options.length ?? 0)
    this.call = options.call
    this.construct = options.construct
    this.callback = options.callback ?? true
  }
}

export class PromiseObj extends Obj {
  constructor(
    proto: Obj,
    readonly fiber: Fiber.Fiber<unknown, unknown>,
  ) {
    super(proto)
  }
}

export class GeneratorObj extends Obj {
  constructor(
    proto: Obj,
    readonly asynchronous: boolean,
    readonly request: (kind: GeneratorRequestKind, value: unknown) => Effect.Effect<unknown, unknown, unknown>,
  ) {
    super(proto)
  }
}

export class DateObj extends Obj {
  constructor(
    proto: Obj,
    public time: number,
  ) {
    super(proto)
  }
}

export class RegExpObj extends Obj {
  readonly regex: RegExp
  constructor(proto: Obj, pattern: string, flags: string) {
    super(proto)
    this.regex = new RegExp(pattern, flags)
  }
}

export class MapObj extends Obj {
  readonly map = new Map<unknown, unknown>()
}

export class SetObj extends Obj {
  readonly set = new Set<unknown>()
}

export class URLSearchParamsObj extends Obj {
  constructor(
    proto: Obj,
    readonly params: URLSearchParams,
  ) {
    super(proto)
  }
}

export class HeadersObj extends Obj {
  constructor(
    proto: Obj,
    readonly headers: Headers,
  ) {
    super(proto)
  }
}

export class URLObj extends Obj {
  readonly searchParams: URLSearchParamsObj
  constructor(
    proto: Obj,
    searchParamsProto: Obj,
    readonly url: URL,
  ) {
    super(proto)
    this.searchParams = new URLSearchParamsObj(searchParamsProto, url.searchParams)
  }
}

/** A `Uint8Array`: the host array does the byte clamping and ignores out-of-range writes, as JS does. */
export class Bytes extends Obj {
  constructor(
    proto: Obj,
    readonly bytes: Uint8Array,
  ) {
    super(proto)
  }
}

/** Built-in objects that wrap a host value; data-like, but never plain data. */
export const isWrapper = (
  value: unknown,
): value is DateObj | RegExpObj | MapObj | SetObj | URLObj | URLSearchParamsObj | HeadersObj | Bytes =>
  value instanceof DateObj ||
  value instanceof RegExpObj ||
  value instanceof MapObj ||
  value instanceof SetObj ||
  value instanceof URLObj ||
  value instanceof URLSearchParamsObj ||
  value instanceof HeadersObj ||
  value instanceof Bytes

const MAX_ARRAY_INDEX = 4_294_967_295

export const parseArrayIndex = (key: string | number): number | undefined => {
  const property = String(key)
  if (!/^(0|[1-9]\d*)$/.test(property)) return undefined
  const index = Number(property)
  return index < MAX_ARRAY_INDEX ? index : undefined
}

const canonical = (key: PropertyKey): string | symbol => (typeof key === "symbol" ? key : String(key))

/** Objects whose integer keys are live elements rather than own property slots. */
type Indexed = Arr | Bytes

const isIndexed = (target: Obj): target is Indexed => target instanceof Arr || target instanceof Bytes

const elements = (target: Indexed): Array<unknown> | Uint8Array => (target instanceof Arr ? target.items : target.bytes)

const index = (target: Obj, key: string | symbol): number | undefined =>
  isIndexed(target) && typeof key === "string" ? parseArrayIndex(key) : undefined

/** The own property under `key`, including an array's live indexes and `length`. */
export const own = (target: Obj, key: PropertyKey): Slot | undefined => {
  const name = canonical(key)
  if (isIndexed(target)) {
    const at = index(target, name)
    if (at !== undefined) {
      const items = elements(target)
      return at in items ? { value: items[at], ...data } : undefined
    }
    if (target instanceof Arr && name === "length") {
      return { value: target.items.length, writable: true, enumerable: false, configurable: false }
    }
  }
  return target.props.get(name)
}

const read = (slot: Slot, receiver: unknown): unknown =>
  "value" in slot ? slot.value : slot.get === undefined ? undefined : slot.get(receiver)

export const hasOwn = (target: Obj, key: PropertyKey): boolean => own(target, key) !== undefined

export const getOwn = (target: Obj, key: PropertyKey): unknown => {
  const slot = own(target, key)
  return slot === undefined ? undefined : read(slot, target)
}

/** [[Get]]: walks the prototype chain; accessors see `receiver`, which is the primitive for wrapper prototypes. */
export const get = (target: Obj, key: PropertyKey, receiver: unknown = target): unknown => {
  for (let current: Obj | null = target; current !== null; current = current.proto) {
    const slot = own(current, key)
    if (slot !== undefined) return read(slot, receiver)
  }
  return undefined
}

export const has = (target: Obj, key: PropertyKey): boolean => {
  for (let current: Obj | null = target; current !== null; current = current.proto) {
    if (own(current, key) !== undefined) return true
  }
  return false
}

export const hasPrototype = (value: unknown, proto: Obj): boolean => {
  for (let current = value instanceof Obj ? value.proto : null; current !== null; current = current.proto) {
    if (current === proto) return true
  }
  return false
}

const writeElement = (target: Indexed, name: string | symbol, value: unknown): boolean | undefined => {
  const at = index(target, name)
  if (at !== undefined) {
    if (target instanceof Bytes) target.bytes[at] = typeof value === "number" ? value : Number(value)
    else target.items[at] = value
    return true
  }
  if (!(target instanceof Arr) || name !== "length") return undefined
  const length = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(length) || length < 0) return false
  checkArrayLength(length)
  target.items.length = length
  return true
}

/** [[Set]]: an inherited setter or read-only property decides before an own data property is created. */
export const set = (target: Obj, key: PropertyKey, value: unknown): boolean => {
  const name = canonical(key)
  for (let current: Obj | null = target; current !== null; current = current.proto) {
    const slot = own(current, name)
    if (slot === undefined) continue
    if (!("value" in slot)) {
      if (slot.set === undefined) return false
      slot.set(target, value)
      return true
    }
    if (!slot.writable) return false
    if (current !== target) break
    if (isIndexed(target)) {
      const written = writeElement(target, name, value)
      if (written !== undefined) return written
    }
    slot.value = value
    return true
  }
  if (isIndexed(target)) {
    const written = writeElement(target, name, value)
    if (written !== undefined) return written
  }
  target.props.set(name, { value, ...data })
  return true
}

/** [[DefineOwnProperty]] for a data property, ignoring the chain. */
export const define = (target: Obj, key: PropertyKey, value: unknown, attrs: Attributes = data): void => {
  const name = canonical(key)
  if (isIndexed(target) && writeElement(target, name, value) !== undefined) return
  target.props.set(name, { value, ...attrs })
}

export const defineAccessor = (target: Obj, key: PropertyKey, get: Getter | undefined, set?: Setter): void => {
  target.props.set(canonical(key), { get, set, enumerable: false, configurable: true })
}

export const remove = (target: Obj, key: PropertyKey): boolean => {
  const name = canonical(key)
  if (isIndexed(target)) {
    const at = index(target, name)
    if (at !== undefined) return target instanceof Bytes ? !(at in target.bytes) : delete target.items[at]
    if (target instanceof Arr && name === "length") return false
  }
  const slot = target.props.get(name)
  if (slot === undefined) return true
  if (!slot.configurable) return false
  target.props.delete(name)
  return true
}

// JS order: array indexes, integer-like keys ascending, other strings, then symbols.
export const ownKeys = (target: Obj): Array<string | symbol> => {
  const strings = [...target.props.keys()].filter((key): key is string => typeof key === "string")
  const symbols = [...target.props.keys()].filter((key): key is symbol => typeof key === "symbol")
  return [
    ...(isIndexed(target) ? Object.keys(elements(target)) : []),
    ...(target instanceof Arr ? ["length"] : []),
    ...strings.filter((key) => parseArrayIndex(key) !== undefined).sort((a, b) => Number(a) - Number(b)),
    ...strings.filter((key) => parseArrayIndex(key) === undefined),
    ...symbols,
  ]
}

const enumerable = (target: Obj, key: string | symbol): boolean => own(target, key)?.enumerable === true

/** Own enumerable keys, including the iterator symbols; what spread and `Object.assign` copy. */
export const enumerableKeys = (target: Obj): Array<string | symbol> =>
  ownKeys(target).filter(
    (key) =>
      (typeof key === "string" || key === IteratorSymbol || key === AsyncIteratorSymbol) && enumerable(target, key),
  )

/** Own enumerable string keys: `Object.keys`. */
export const keys = (target: Obj): Array<string> =>
  ownKeys(target).filter((key): key is string => typeof key === "string" && enumerable(target, key))

/** Own enumerable string entries: `Object.entries` and serialization. */
export const entries = (target: Obj): Array<[string, unknown]> => keys(target).map((key) => [key, getOwn(target, key)])

export const record = (proto: Obj, fields: Record<string, unknown>): Obj => {
  const target = new Obj(proto)
  for (const [key, value] of Object.entries(fields)) define(target, key, value)
  return target
}

export const assign = (target: Obj, source: Obj, skip?: ReadonlySet<PropertyKey>): void => {
  for (const key of enumerableKeys(source)) {
    if (skip?.has(key)) continue
    set(target, key, getOwn(source, key))
  }
}
