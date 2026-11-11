import { ToolReference } from "../tool-runtime.js"
import type { Builtins } from "./intrinsics.js"
import { checkArrayLength } from "./limits.js"
import {
  type AstNode,
  AsyncIteratorSymbol,
  IteratorSymbol,
  type PendingThrow,
  rangeError,
  Throw,
  typeError,
} from "./model.js"
import { type Convert, type GeneratorRequest, Invoke, type Push, type Resume } from "./signals.js"
import type { Code } from "../code.js"
import { type Cell, CodeFlags } from "../opcodes.js"
import type { Reaction, Resolving } from "../scheduler.js"
import type { Frame } from "../vm.js"
import { OrderedTable, type TableCursor } from "./table.js"

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

// The objects made while a runtime's intrinsics are being made, in creation order; see `makingIntrinsics`.
let making: Array<Obj> | undefined

/**
 * Runs `make`, which makes a runtime's intrinsics, and returns every object made meanwhile, in creation order, after
 * `first` (the built-in prototypes, made before). An object's index in the list is its static intrinsic id.
 */
export const makingIntrinsics = <A>(first: ReadonlyArray<Obj>, make: () => A): readonly [A, Array<Obj>] => {
  const made = [...first]
  making = made
  try {
    return [make(), made]
  } finally {
    making = undefined
  }
}

/** Marks an intrinsic as changed by the program, so saving a run records it; any other object is left alone. */
export const changed = (target: Obj): void => {
  if (target.intrinsic > 0) target.intrinsic = -target.intrinsic
}

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
  /** [[Extensible]]: cleared by `Object.preventExtensions`, `seal`, and `freeze`. */
  extensible = true
  /**
   * 0 for an object the program made. For an intrinsic, its id plus one while it is as the runtime made it, negated
   * once it changes (see `changed` and `IntrinsicNames`).
   */
  intrinsic = 0
  constructor(public proto: Obj | null) {
    if (making !== undefined) making.push(this)
  }

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
  iterator(builtins: Builtins): Cursor | undefined {
    return undefined
  }
}

export class Arr extends Obj {
  override readonly tag = "Array"
  /** The attributes every live element shares; `seal` and `freeze` narrow them since elements have no slots. */
  elements: Attributes = data
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
  override iterator(builtins: Builtins) {
    return new Position(this, "values", builtins.Array)
  }
}

/** An object with the [[ErrorData]] slot: what `Error.prototype.toString` and the host boundary recognize as an error. */
export class ErrorObj extends Obj {
  override readonly tag = "Error"
  /**
   * The interpreter failure this error materialized from, so rethrowing it keeps the diagnostic kind and location. It
   * is plain data (type, message, kind, suggestions, and the node it is located at), shared with the failure so a
   * location attached later is seen here too.
   */
  failure?: PendingThrow
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
  constructor(
    proto: Obj,
    name: string,
    readonly length: number,
  ) {
    super(proto)
    define(this, "length", length, readonly)
    define(this, "name", name, readonly)
  }
  override get describe() {
    return "a function"
  }
}

/** A program or prelude function: its bytecode, and the cells of the bindings it captured. */
export class Fn extends Callable {
  constructor(
    proto: Obj,
    readonly code: Code,
    readonly cells: ReadonlyArray<Cell>,
    name = code.name,
  ) {
    super(proto, name, code.length)
  }
  get generator(): boolean {
    return (this.code.flags & CodeFlags.GENERATOR) !== 0
  }
}

/** The strict `arguments` object: an ordinary object with indexed own properties and a hidden `length`. */
export class Arguments extends Obj {
  override readonly tag = "Arguments"
  constructor(proto: Obj, args: Array<Value>) {
    super(proto)
    args.forEach((arg, index) => define(this, String(index), arg))
    define(this, "length", args.length, hidden)
  }
  override iterator(builtins: Builtins) {
    return new Position(
      keys(this).map((key) => get(this, key)),
      "values",
      builtins.Array,
    )
  }
}

/**
 * A native function body: a value, or what the VM carries out as the call: work it hands over by name (`Push`), a
 * suspended generator to continue (`Resume`), a call it hands on (`Invoke`), or conversions to run before it runs again
 * (`Convert`). A native never runs program code itself.
 */
export type NativeResult = Value | Push | Resume | Invoke | Convert
/** `site` is the call running the built-in, where a failure it reports later (a rejection) is located. */
export type NativeCall = (thisValue: Value, args: Array<Value>, site: AstNode | undefined) => NativeResult
export type NativeConstruct = (args: Array<Value>, newTarget: Callable, site: AstNode | undefined) => NativeResult

export type NativeOptions = {
  /**
   * Why this native may be made while the program runs, for the few kinds that still capture state in a host closure.
   * Every other native is made with the intrinsics; see `nativeRule`.
   */
  readonly runtime?: RuntimeNative
  readonly name: string
  readonly length?: number
  readonly call: NativeCall
  /** `new name(...)`; without it the function is not a constructor. */
  readonly construct?: NativeConstruct
  /** Whether callback sites (array methods, replacers, promise reactions) admit this function. Defaults to true. */
  readonly callback?: boolean
}

/** The natives still made at run time, each holding state in a host closure that cannot be saved yet. */
export type RuntimeNative = "extension"

/**
 * Natives are made only with the intrinsics, so each one has an intrinsic name and run state never holds a host
 * closure. When `check` is on (tests turn it on), making a native for a runtime whose intrinsics are `sealed` (keyed by
 * its `Function.prototype`) throws, unless it declares one of the `RuntimeNative` exceptions.
 */
export const nativeRule: { check: boolean; sealed: WeakSet<Obj>; observe?: (native: Native) => void } = {
  check: false,
  sealed: new WeakSet(),
}

/**
 * A built-in function: a `Native` made with the intrinsics, or a data kind such as `BoundFn` or `Resolver` whose state
 * is plain fields and whose behaviour lives on its class.
 */
export abstract class Builtin extends Callable {
  /** `new name(...)`; without it the function is not a constructor. */
  abstract readonly construct: NativeConstruct | undefined
  /** Whether callback sites (array methods, replacers, promise reactions) admit this function. */
  abstract readonly callback: boolean
  abstract invoke(thisValue: Value, args: Array<Value>, site: AstNode | undefined): NativeResult
}

export class Native extends Builtin {
  readonly call: NativeCall
  readonly construct: NativeConstruct | undefined
  readonly callback: boolean

  constructor(proto: Obj, options: NativeOptions) {
    if (nativeRule.check && options.runtime === undefined && nativeRule.sealed.has(proto)) {
      throw new Error(`Native "${options.name}" was made after the intrinsics; make it a data kind instead.`)
    }
    super(proto, options.name, options.length ?? 0)
    nativeRule.observe?.(this)
    this.call = options.call
    this.construct = options.construct
    this.callback = options.callback ?? true
  }

  invoke(thisValue: Value, args: Array<Value>, site: AstNode | undefined): NativeResult {
    return this.call(thisValue, args, site)
  }
}

/** `Function.prototype.bind`'s result: calls `target` with the bound receiver and leading arguments. */
export class BoundFn extends Builtin {
  readonly construct = undefined
  readonly callback = true
  constructor(
    proto: Obj,
    readonly target: Callable,
    readonly boundThis: Value,
    readonly boundArgs: ReadonlyArray<Value>,
  ) {
    super(proto, `bound ${coerceToString(get(target, "name"))}`, Math.max(0, target.length - boundArgs.length))
  }

  invoke(_: Value, args: Array<Value>, site: AstNode | undefined): NativeResult {
    return new Invoke(this.target, this.boundThis, [...this.boundArgs, ...args], site)
  }
}

/** A `resolve` or `reject` function handed to an executor or thenable: settles its shared `Resolving` once. */
export class Resolver extends Builtin {
  readonly construct = undefined
  readonly callback = true
  constructor(
    proto: Obj,
    name: string,
    readonly resolving: Resolving,
    readonly kind: "resolve" | "reject",
  ) {
    super(proto, name, 1)
  }

  invoke(_: Value, args: Array<Value>): NativeResult {
    if (this.kind === "resolve") this.resolving.resolve(args[0])
    else this.resolving.reject(new Throw(args[0]))
    return undefined
  }
}

export class PromiseObj extends Opaque {
  override readonly tag = "Promise"
  state: "pending" | "fulfilled" | "rejected" = "pending"
  /** The value, or the failure as thrown; a handler receives it materialized. */
  result: unknown = undefined
  reactions: Array<Reaction> = []
  /** [[PromiseIsHandled]]: a reaction was attached, so a rejection is not reported as unhandled. */
  handled = false
  constructor(
    proto: Obj,
    /** Creation order, for reporting unhandled rejections in the order their promises were made. */
    readonly id: number,
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

export type GeneratorState =
  | "suspendedStart"
  | "suspendedYield"
  | "executing"
  | "awaiting-return"
  | "draining"
  | "completed"

export class GeneratorObj extends Opaque {
  override readonly tag = "Generator"
  state: GeneratorState = "suspendedStart"
  /** The suspended body's frame, kept while it waits for the next request, which puts it back on the job stack. */
  frame: Frame | undefined = undefined
  /** An async generator's requests, oldest first, each with what settles its promise. */
  readonly queue: Array<{ readonly request: GeneratorRequest; readonly resolving: Resolving }> = []
  constructor(
    proto: Obj,
    readonly asynchronous: boolean,
  ) {
    super(proto)
  }
  override get describe() {
    return "a generator"
  }
}

/** One pull from an iterator, as `for...of` sees it. */
export type Step = { readonly done: boolean; readonly value: Value }

/**
 * An iterator the interpreter drives, as data: a built-in cursor over a collection (`Position`), or a program
 * iterator driven by its own `next` method (`CustomIterator`).
 */
export type Cursor = Position | CustomIterator

/** A program iterator record: the iterator, its `next` method, and whether its results are awaited. */
export type CustomIterator = {
  readonly iterator: Obj
  readonly next: Value
  readonly asynchronous: boolean
}

const finished: Step = { done: true, value: undefined }

/** What a built-in iterator yields for each entry: `keys()`, `values()`, or `entries()`. */
export type IterationKind = "keys" | "values" | "entries"

/** What a built-in iterator walks: a collection, a string, or a fixed list of values. */
export type PositionSource =
  | Arr
  | Bytes
  | MapObj
  | SetObj
  | HeadersObj
  | URLSearchParamsObj
  | string
  | ReadonlyArray<Value>

/**
 * A built-in iterator's place in its source, as data: what it walks, what it yields, and the next index. Iteration is
 * live, as in JS: an array iterator reads the length on every step, and a Map or Set iterator is kept in place by its
 * table. Once done it stays done. There is nothing to close.
 */
export class Position implements TableCursor {
  index = 0
  done = false
  constructor(
    readonly source: PositionSource,
    readonly kind: IterationKind,
    /** The prototype of the `[key, value]` arrays `entries()` yields. */
    readonly arrays: Obj,
  ) {
    if (source instanceof MapObj) source.map.track(this)
    if (source instanceof SetObj) source.set.track(this)
  }

  step(): Step {
    if (this.done) return finished
    const source = this.source
    if (typeof source === "string") {
      if (this.index >= source.length) return this.finish()
      const point = source.codePointAt(this.index)!
      const value = source.slice(this.index, this.index + (point > 0xffff ? 2 : 1))
      this.index += value.length
      return { done: false, value }
    }
    if (source instanceof MapObj || source instanceof SetObj) {
      const table = source instanceof MapObj ? source.map : source.set
      const at = table.advance(this)
      if (at < 0) return finished
      const key = table.keys[at] as Value
      return this.yield(key, source instanceof MapObj ? table.values[at] : key)
    }
    if (source instanceof HeadersObj || source instanceof URLSearchParamsObj) {
      // The host recomputes the sorted list on every step, as the spec's pair iterators do.
      const list = Array.from(source instanceof HeadersObj ? source.headers.entries() : source.params.entries())
      const entry = list[this.index]
      if (entry === undefined) return this.finish()
      this.index++
      return this.yield(entry[0], entry[1])
    }
    const items = source instanceof Arr ? source.items : source instanceof Bytes ? source.bytes : source
    if (this.index >= items.length) return this.finish()
    const at = this.index++
    return this.yield(at, items[at])
  }

  private yield(key: Value, value: Value): Step {
    if (this.kind === "keys") return { done: false, value: key }
    if (this.kind === "values") return { done: false, value }
    return { done: false, value: new Arr(this.arrays, [key, value]) }
  }

  private finish(): Step {
    this.done = true
    return finished
  }
}

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

/** A built-in iterator over a collection, e.g. `array.values()`. */
export const positionIterator = (builtins: Builtins, source: PositionSource, kind: IterationKind): IteratorObj =>
  new IteratorObj(builtins.Iterator, new Position(source, kind, builtins.Array))

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

/** A RegExp as data: its source, flags, and `lastIndex`; the host regex is only a compiled cache of the first two. */
export class RegExpObj extends Wrapper {
  override readonly tag = "RegExp"
  readonly source: string
  readonly flags: string
  /** Shared by `exec`/`test` and the String methods, as the host regex's own `lastIndex` would be. */
  lastIndex = 0
  private compiled: RegExp | undefined
  constructor(proto: Obj, pattern: string, flags: string) {
    super(proto)
    // Compiling validates the pattern and flags, and normalizes both as the host spells them.
    this.compiled = new RegExp(pattern, flags)
    this.source = this.compiled.source
    this.flags = this.compiled.flags
  }
  /** The compiled regex, for reading what it is; anything that matches goes through `use`. */
  get regex(): RegExp {
    this.compiled ??= new RegExp(this.source, this.flags)
    return this.compiled
  }
  /** Runs host regex work starting from this object's `lastIndex`, and keeps the `lastIndex` the work leaves. */
  use<T>(work: (regex: RegExp) => T): T {
    const regex = this.regex
    regex.lastIndex = this.lastIndex
    try {
      return work(regex)
    } finally {
      this.lastIndex = regex.lastIndex
    }
  }
  override toString() {
    return `/${this.source}/${this.flags}`
  }
  override toHost() {
    return new RegExp(this.source, this.flags)
  }
}

export class MapObj extends Wrapper {
  override readonly tag = "Map"
  readonly map = new OrderedTable()
  override inspect(item: (value: Value) => string) {
    return `Map(${this.map.size}) [${[...this.map].map(([key, value]) => `[${item(key)},${item(value)}]`).join(",")}]`
  }
  override toHost(item: (value: Value) => unknown) {
    return new Map([...this.map].map(([key, value]) => [item(key), item(value)]))
  }
  override iterator(builtins: Builtins) {
    return new Position(this, "entries", builtins.Array)
  }
}

export class SetObj extends Wrapper {
  override readonly tag = "Set"
  readonly set = new OrderedTable()
  override inspect(item: (value: Value) => string) {
    return `Set(${this.set.size}) [${[...this.set.liveKeys()].map(item).join(",")}]`
  }
  override toHost(item: (value: Value) => unknown) {
    return new Set([...this.set.liveKeys()].map(item))
  }
  override iterator(builtins: Builtins) {
    return new Position(this, "values", builtins.Array)
  }
}

/**
 * Keys are held strongly for the run, which is short-lived; garbage collection is not observable in Code Mode, and a
 * plain table keeps the state as data.
 */
export class WeakMapObj extends Wrapper {
  override readonly tag = "WeakMap"
  readonly map = new Map<Obj, Value>()
  override inspect() {
    return "WeakMap { <items unknown> }"
  }
}

export class WeakSetObj extends Wrapper {
  override readonly tag = "WeakSet"
  readonly set = new Set<Obj>()
  override inspect() {
    return "WeakSet { <items unknown> }"
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
    return new Position(this, "entries", builtins.Array)
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
    return new Position(this, "entries", builtins.Array)
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
  override iterator(builtins: Builtins) {
    return new Position(this, "values", builtins.Array)
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

/** ToIntegerOrInfinity: NaN is 0, fractions truncate. */
export const coerceToInteger = (value: Value): number => {
  const number = coerceToNumber(value)
  return Number.isNaN(number) ? 0 : Math.trunc(number)
}

/** Values that cannot cross the data boundary: opaque machinery and host-backed wrappers. */
export const isRuntimeReference = (value: Value): boolean =>
  value instanceof Opaque || value instanceof Wrapper || value instanceof ToolReference

const MAX_ARRAY_INDEX = 4_294_967_295

export const parseArrayIndex = (key: string | number): number | undefined => {
  if (typeof key === "number") return Number.isInteger(key) && key >= 0 && key < MAX_ARRAY_INDEX ? key : undefined
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

const index = (target: Obj, key: string | number | symbol): number | undefined =>
  isIndexed(target) && typeof key !== "symbol" ? parseArrayIndex(key) : undefined

/** The own property under `key`, including an array's live indexes and `length`. */
export const own = (target: Obj, key: PropertyKey): Slot | undefined => {
  // Most lookups are a name on a plain object or a prototype.
  if (typeof key === "string" && !isIndexed(target)) return target.props.get(key)
  const name = typeof key === "number" && isIndexed(target) ? key : canonical(key)
  if (isIndexed(target)) {
    const at = index(target, name)
    if (at !== undefined) {
      const items = elements(target)
      if (!(at in items)) return undefined
      return { value: items[at], ...(target instanceof Arr ? target.elements : data) }
    }
    if (target instanceof Arr && name === "length") {
      return { value: target.items.length, writable: target.elements.writable, enumerable: false, configurable: false }
    }
  }
  return target.props.get(typeof name === "number" ? String(name) : name)
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
  // An array's present element, without making its property slot.
  if (typeof key === "number" && target instanceof Arr && key in target.items && parseArrayIndex(key) !== undefined)
    return target.items[key]
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

const writeElement = (target: Indexed, name: string | number | symbol, value: Value): boolean | undefined => {
  const at = index(target, name)
  if (at !== undefined) {
    if (target instanceof Bytes) {
      target.bytes[at] = typeof value === "number" ? value : Number(value)
      return true
    }
    if (!(at in target.items)) rejectAddition(target, at)
    changed(target)
    target.items[at] = value
    return true
  }
  if (!(target instanceof Arr) || name !== "length") return undefined
  const length = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(length) || length < 0) throw rangeError("Invalid array length")
  // Shrinking deletes elements, which a sealed array forbids.
  if (length < target.items.length && !target.elements.configurable) return false
  checkArrayLength(length)
  changed(target)
  target.items.length = length
  return true
}

/** [[Set]]: an inherited setter or read-only property decides before an own data property is created. */
export const set = (target: Obj, key: PropertyKey, value: Value): boolean => {
  // Overwriting an array's present, writable element: no setter or read-only slot can decide first.
  if (typeof key === "number" && target instanceof Arr && target.elements.writable && key in target.items) {
    if (parseArrayIndex(key) !== undefined) {
      changed(target)
      target.items[key] = value
      return true
    }
  }
  const name = canonical(key)
  for (let current: Obj | null = target; current !== null; current = current.proto) {
    const slot = own(current, key)
    if (slot === undefined) continue
    if (!("value" in slot)) {
      if (slot.set === undefined) return false
      slot.set(target, value)
      return true
    }
    if (!slot.writable) return false
    if (current !== target) break
    if (isIndexed(target)) {
      const written = writeElement(target, typeof key === "number" ? key : name, value)
      if (written !== undefined) return written
    }
    changed(target)
    slot.value = value
    return true
  }
  if (isIndexed(target)) {
    const written = writeElement(target, typeof key === "number" ? key : name, value)
    if (written !== undefined) return written
  }
  rejectAddition(target, name)
  changed(target)
  target.props.set(name, { value, ...data })
  return true
}

/** Creating a property on a non-extensible object is the one [[Set]] failure with its own message. */
export const rejectAddition = (target: Obj, key: string | symbol | number): void => {
  if (target.extensible) return
  throw typeError(`Cannot add property ${String(key)}, object is not extensible.`)
}

/** [[DefineOwnProperty]] for a data property, ignoring the chain. */
export const define = (target: Obj, key: PropertyKey, value: Value, attrs: Attributes = data): void => {
  const name = canonical(key)
  if (isIndexed(target) && writeElement(target, name, value) !== undefined) return
  changed(target)
  target.props.set(name, { value, ...attrs })
}

export const defineAccessor = (target: Obj, key: PropertyKey, get: Getter | undefined, set?: Setter): void => {
  changed(target)
  target.props.set(canonical(key), { get, set, enumerable: false, configurable: true })
}

export const remove = (target: Obj, key: PropertyKey): boolean => {
  const name = canonical(key)
  if (isIndexed(target)) {
    const at = index(target, name)
    if (at !== undefined) {
      if (target instanceof Bytes) return !(at in target.bytes)
      if (at in target.items && !target.elements.configurable) return false
      changed(target)
      return delete target.items[at]
    }
    if (target instanceof Arr && name === "length") return false
  }
  const slot = target.props.get(name)
  if (slot === undefined) return true
  if (!slot.configurable) return false
  changed(target)
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

/** An iterator result `{ value, done }`, built directly since every iteration step makes one. */
export const iteratorResult = (proto: Obj, value: Value, done: boolean): Obj => {
  const target = new Obj(proto)
  target.props.set("value", { value, writable: true, enumerable: true, configurable: true })
  target.props.set("done", { value: done, writable: true, enumerable: true, configurable: true })
  return target
}

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
