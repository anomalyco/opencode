import type { BlockStatement, Expression, Pattern } from "acorn"
import { Effect, type Fiber } from "effect"
import { ToolReference } from "../tool-runtime.js"
import type { Builtins } from "./intrinsics.js"
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

export type Getter = (receiver: Value) => Value
export type Setter = (receiver: Value, value: Value) => void

/** One own property: a data slot or a native accessor pair. */
export type Slot =
  | { value: Value; writable: boolean; enumerable: boolean; configurable: boolean }
  | { get: Getter | undefined; set: Setter | undefined; enumerable: boolean; configurable: boolean }

/** Ordinary assignment: writable, enumerable, configurable. */
export const data: Attributes = { writable: true, enumerable: true, configurable: true }
/** Built-in methods and `constructor`: writable and configurable but hidden from enumeration. */
export const hidden: Attributes = { writable: true, enumerable: false, configurable: true }
/** Function `name` and `length`: read-only but deletable. */
export const readonly: Attributes = { writable: false, enumerable: false, configurable: true }
/** Constants such as `Math.PI` and a constructor's `prototype`. */
export const frozen: Attributes = { writable: false, enumerable: false, configurable: false }

/**
 * An object owned by the program: own properties plus a prototype link. Subclasses answer, in one place, how a
 * built-in kind of object prints, coerces, iterates, and crosses to the host.
 */
export class Obj {
  readonly props = new Map<string | symbol, Slot>()
  constructor(public proto: Obj | null) {}

  /** The class name `Object.prototype.toString` reports: `[object Map]`. */
  readonly tag: string = "Object"

  /** How diagnostics refer to a value of this kind. */
  get describe(): string {
    if (this.tag === "Object") return "a data object"
    return `${/^[AEIO]/.test(this.tag) ? "an" : "a"} ${this.tag}`
  }

  /** ToString without consulting program-defined methods. */
  toString(): string {
    return `[object ${this.tag}]`
  }

  /** ToPrimitive without consulting program-defined methods: only a Date answers a number hint differently. */
  toPrimitive(hint: "default" | "number" | "string"): string | number {
    return this.toString()
  }

  /** ToNumber without consulting program-defined methods. */
  toNumber(): number {
    return Number(this.toPrimitive("number"))
  }

  /** How `console.log` shows the value; `item` formats a child with cycle and depth tracking. */
  inspect(item: (value: Value) => string): string {
    return `{${entries(this)
      .map(([key, value]) => `${JSON.stringify(key)}:${item(value)}`)
      .join(",")}}`
  }

  /** A copy the host can hold; `item` converts a child. A `__proto__` key never reaches host code. */
  toHost(item: (value: Value) => unknown): unknown {
    return Object.fromEntries(
      entries(this)
        .filter(([key]) => key !== "__proto__")
        .map(([key, value]) => [key, item(value)]),
    )
  }

  /** The built-in iteration `for...of` and spread use, when this kind of object has one. */
  iterator(builtins: Builtins): Iterator<Value, undefined> | undefined {
    return undefined
  }
}

export class Arr extends Obj {
  override readonly tag = "Array"
  constructor(
    proto: Obj,
    readonly items: Array<Value> = [],
  ) {
    super(proto)
  }
  override get describe() {
    return "an array"
  }
  override toString() {
    return this.items.map((item) => (item === null || item === undefined ? "" : coerceToString(item))).join(",")
  }
  override inspect(item: (value: Value) => string) {
    return `[${this.items.map(item).join(",")}]`
  }
  override toHost(item: (value: Value) => unknown) {
    return this.items.map(item)
  }
  override iterator() {
    return this.items.values()
  }
}

/** An object with the [[ErrorData]] slot: what `Error.prototype.toString` and the host boundary recognize as an error. */
export class ErrorObj extends Obj {
  override readonly tag = "Error"
  /** The interpreter failure this error materialized from, so rethrowing it keeps the diagnostic kind and location. */
  host?: PendingThrow
  /** Error.prototype.toString: "name: message", or just one when the other is empty. */
  override toString() {
    const name = get(this, "name")
    const message = get(this, "message")
    const shownName = typeof name === "string" ? name : "Error"
    const shownMessage = typeof message === "string" ? message : ""
    if (shownMessage === "") return shownName
    if (shownName === "") return shownMessage
    return `${shownName}: ${shownMessage}`
  }
  override inspect() {
    return this.toString()
  }
}

/** Interpreter machinery a program can hold but never inspect, serialize, or hand to the host. */
export abstract class Opaque extends Obj {
  override inspect() {
    return "[opaque reference]"
  }
}

export abstract class Callable extends Opaque {
  override readonly tag = "Function"
  constructor(proto: Obj, name: string, length: number) {
    super(proto)
    define(this, "length", length, readonly)
    define(this, "name", name, readonly)
  }
  override get describe() {
    return "a function"
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

export type NativeCall<R> = (thisValue: Value, args: Array<Value>) => Effect.Effect<Value, unknown, R>
export type NativeConstruct<R> = (args: Array<Value>, newTarget: Callable) => Effect.Effect<Value, unknown, R>

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

export class PromiseObj extends Opaque {
  override readonly tag = "Promise"
  constructor(
    proto: Obj,
    readonly fiber: Fiber.Fiber<Value, unknown>,
  ) {
    super(proto)
  }
  override get describe() {
    return "an un-awaited Promise"
  }
  override inspect() {
    return "[Promise (await it to get its value)]"
  }
}

export class GeneratorObj extends Opaque {
  override readonly tag = "Generator"
  constructor(
    proto: Obj,
    readonly asynchronous: boolean,
    readonly request: (kind: GeneratorRequestKind, value: Value) => Effect.Effect<Value, unknown, unknown>,
  ) {
    super(proto)
  }
  override get describe() {
    return "a generator"
  }
}

/** One pull from an iterator, as `for...of` sees it. */
export type Step = { readonly done: boolean; readonly value: Value }

/** How the interpreter drives any iterator: pull the next step, or close it early. */
export type Cursor<R = unknown> = {
  readonly next: Effect.Effect<Step, unknown, R>
  readonly close: Effect.Effect<void, unknown, R>
}

/** A cursor over a host iterator; there is nothing to close. */
export const hostCursor = (iterator: Iterator<Value, undefined>): Cursor<never> => ({
  next: Effect.sync(() => {
    const step = iterator.next()
    return { done: Boolean(step.done), value: step.value }
  }),
  close: Effect.void,
})

/** A built-in iterator: a live cursor over a host collection or an iterator helper, yielding program values. */
export class IteratorObj extends Opaque {
  override readonly tag = "Iterator"
  constructor(
    proto: Obj,
    readonly cursor: Cursor,
  ) {
    super(proto)
  }
  override get describe() {
    return "an iterator"
  }
}

/** A built-in iterator over a host iterator, e.g. `array.values()`. */
export const hostIterator = (builtins: Builtins, iterator: Iterator<Value, undefined>): IteratorObj =>
  new IteratorObj(builtins.Iterator, hostCursor(iterator))

/** A built-in object around a host value: data-like, so it prints as itself and crosses to extensions as a copy. */
export abstract class Wrapper extends Obj {
  override inspect(item: (value: Value) => string) {
    return this.toString()
  }
}

export class DateObj extends Wrapper {
  override readonly tag = "Date"
  constructor(
    proto: Obj,
    public time: number,
  ) {
    super(proto)
  }
  override toString() {
    return Number.isFinite(this.time) ? new Date(this.time).toISOString() : "Invalid Date"
  }
  override toPrimitive(hint: "default" | "number" | "string") {
    return hint === "number" ? this.time : this.toString()
  }
  override toHost() {
    return new Date(this.time)
  }
}

export class RegExpObj extends Wrapper {
  override readonly tag = "RegExp"
  readonly regex: RegExp
  constructor(proto: Obj, pattern: string, flags: string) {
    super(proto)
    this.regex = new RegExp(pattern, flags)
  }
  override toString() {
    return `/${this.regex.source}/${this.regex.flags}`
  }
  override toHost() {
    return new RegExp(this.regex.source, this.regex.flags)
  }
}

export class MapObj extends Wrapper {
  override readonly tag = "Map"
  readonly map = new Map<Value, Value>()
  override inspect(item: (value: Value) => string) {
    return `Map(${this.map.size}) [${[...this.map].map(([key, value]) => `[${item(key)},${item(value)}]`).join(",")}]`
  }
  override toHost(item: (value: Value) => unknown) {
    return new Map([...this.map].map(([key, value]) => [item(key), item(value)]))
  }
  override iterator(builtins: Builtins) {
    return this.map.entries().map((entry) => new Arr(builtins.Array, entry))
  }
}

export class SetObj extends Wrapper {
  override readonly tag = "Set"
  readonly set = new Set<Value>()
  override inspect(item: (value: Value) => string) {
    return `Set(${this.set.size}) [${[...this.set].map(item).join(",")}]`
  }
  override toHost(item: (value: Value) => unknown) {
    return new Set([...this.set].map(item))
  }
  override iterator() {
    return this.set.values()
  }
}

export class URLSearchParamsObj extends Wrapper {
  override readonly tag = "URLSearchParams"
  constructor(
    proto: Obj,
    readonly params: URLSearchParams,
  ) {
    super(proto)
  }
  override toString() {
    return this.params.toString()
  }
  override toHost() {
    return new URLSearchParams(this.params)
  }
  override iterator(builtins: Builtins) {
    return this.params.entries().map((entry) => new Arr(builtins.Array, entry))
  }
}

export class HeadersObj extends Wrapper {
  override readonly tag = "Headers"
  constructor(
    proto: Obj,
    readonly headers: Headers,
  ) {
    super(proto)
  }
  override inspect() {
    return `Headers ${JSON.stringify(Object.fromEntries(this.headers))}`
  }
  override toHost() {
    return new Headers(this.headers)
  }
  override iterator(builtins: Builtins) {
    // Bun's Headers typings lack the iterator helpers, so the host iterator is lifted first.
    return Iterator.from(this.headers.entries()).map((entry) => new Arr(builtins.Array, entry))
  }
}

export class URLObj extends Wrapper {
  override readonly tag = "URL"
  readonly searchParams: URLSearchParamsObj
  constructor(
    proto: Obj,
    searchParamsProto: Obj,
    readonly url: URL,
  ) {
    super(proto)
    this.searchParams = new URLSearchParamsObj(searchParamsProto, url.searchParams)
  }
  override toString() {
    return this.url.href
  }
  override toHost() {
    return new URL(this.url.href)
  }
}

/** A `Uint8Array`: the host array does the byte clamping and ignores out-of-range writes, as JS does. */
export class Bytes extends Wrapper {
  override readonly tag = "Uint8Array"
  constructor(
    proto: Obj,
    readonly bytes: Uint8Array,
  ) {
    super(proto)
  }
  override toString() {
    return this.bytes.join(",")
  }
  override inspect() {
    return `Uint8Array(${this.bytes.length}) [${this.bytes.join(",")}]`
  }
  override toHost() {
    return new Uint8Array(this.bytes)
  }
  override iterator() {
    return this.bytes.values()
  }
}

/** Every value a program can hold. Host values never appear here; they are copied in at the boundaries. */
export type Value = string | number | boolean | null | undefined | symbol | Obj | ToolReference

/** ToString without consulting program-defined methods. */
export const coerceToString = (value: Value): string => (value instanceof Obj ? value.toString() : String(value))

/** ToNumber without consulting program-defined methods; tool references are not numbers. */
export const coerceToNumber = (value: Value): number => {
  if (value instanceof Obj) return value.toNumber()
  return value instanceof ToolReference ? Number.NaN : Number(value)
}

/** Values that cannot cross the data boundary: opaque machinery and host-backed wrappers. */
export const isRuntimeReference = (value: Value): boolean =>
  value instanceof Opaque || value instanceof Wrapper || value instanceof ToolReference

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

const elements = (target: Indexed): Array<Value> | Uint8Array => (target instanceof Arr ? target.items : target.bytes)

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

const read = (slot: Slot, receiver: Value): Value =>
  "value" in slot ? slot.value : slot.get === undefined ? undefined : slot.get(receiver)

export const hasOwn = (target: Obj, key: PropertyKey): boolean => own(target, key) !== undefined

export const getOwn = (target: Obj, key: PropertyKey): Value => {
  const slot = own(target, key)
  return slot === undefined ? undefined : read(slot, target)
}

/** [[Get]]: walks the prototype chain; accessors see `receiver`, which is the primitive for wrapper prototypes. */
export const get = (target: Obj, key: PropertyKey, receiver: Value = target): Value => {
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

export const hasPrototype = (value: Value, proto: Obj): boolean => {
  for (let current = value instanceof Obj ? value.proto : null; current !== null; current = current.proto) {
    if (current === proto) return true
  }
  return false
}

const writeElement = (target: Indexed, name: string | symbol, value: Value): boolean | undefined => {
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
export const set = (target: Obj, key: PropertyKey, value: Value): boolean => {
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
export const define = (target: Obj, key: PropertyKey, value: Value, attrs: Attributes = data): void => {
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
export const entries = (target: Obj): Array<[string, Value]> => keys(target).map((key) => [key, getOwn(target, key)])

export const record = (proto: Obj, fields: Record<string, Value>): Obj => {
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
