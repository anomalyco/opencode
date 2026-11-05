import { DESCEND } from "../data.js"
import { Interpreter } from "../interpreter/interpreter.js"
import {
  type AstNode,
  AsyncIteratorSymbol,
  GeneratorReturn,
  IteratorSymbol,
  Lost,
  lostError,
  OptionalShortCircuit,
  PendingThrow,
  Throw,
} from "../interpreter/model.js"
import {
  Arguments,
  Arr,
  BoundFn,
  Bytes,
  DateObj,
  ErrorObj,
  Fn,
  GeneratorObj,
  HeadersObj,
  Helper,
  IteratorObj,
  MapObj,
  Native,
  Obj,
  Position,
  PromiseObj,
  RegExpObj,
  Resolver,
  SetObj,
  type Slot,
  URLObj,
  type Value,
  URLSearchParamsObj,
  WeakMapObj,
  WeakSetObj,
} from "../interpreter/objects.js"
import { ScopeStack } from "../interpreter/scope.js"
import { Await, Convert, Enter, Host, Interruption, Invoke, Push, Slice, Yield } from "../interpreter/signals.js"
import { deleted, OrderedTable } from "../interpreter/table.js"
import { Frame, kinds, PENDING } from "../machine/frame.js"
import { AsyncFromSyncIterator } from "../machine/generators.js"
import { Machine } from "../machine/machine.js"
import { HostCall, Resolving } from "../machine/scheduler.js"
import { MachineTask } from "../machine/task.js"
import { TextDecoderObj } from "../stdlib/bytes.js"
import { ToolError, toolError } from "../tool-error.js"
import { ToolReference, ToolRuntimeError } from "../tool-runtime.js"

// A graph codec for a run's state: every object reachable from the roots becomes one record, so identity, sharing,
// and cycles survive, and every value inside a record is tagged JSON. Built-ins, frame kinds, AST nodes,
// and the machine's own objects are named rather than copied; a value with no data form (a live host function, say)
// becomes a `Lost` placeholder. Nothing here evaluates anything: decoding only allocates and assigns.

/** A plain JSON value, as a snapshot holds it. */
export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json }

/**
 * A value inside a record: a JSON primitive, or a tag (an array whose first item says what it is):
 * - `["u"]` undefined, `["n", "NaN" | "Infinity" | "-Infinity" | "-0"]` a number JSON cannot spell, `["-"]` an absent
 *   field, `["h"]` an array hole;
 * - `["s", name]` an interpreter symbol, `["k", name]` a frame kind;
 * - `["i", name]` a built-in or host global, unchanged since the runtime was made;
 * - `["a", source, index]` an AST node, `["A", source, index, key]` an array the AST owns;
 * - `["r", id]` another record.
 */
export type Encoded = string | number | boolean | null | ReadonlyArray<Json>

/** One object of the graph. `t` says how to read the rest. */
export type Record = { readonly t: string; readonly [field: string]: Json }

/** A saved state can't be read, or doesn't fit this runtime. */
export class SnapshotError extends Error {
  override readonly name = "SnapshotError"
}

/** What the encoder asks of the runtime whose state it saves. */
export type EncodeEnv = {
  /** The name of a built-in or host global object. */
  readonly nameOf: (value: Obj) => string | undefined
  /** Whether a named object is still as the runtime made it, so its name alone restores it. */
  readonly unchanged: (value: Obj, name: string) => boolean
  /** The anchors: objects the restored runtime already has, filled in place (`Machine`, its root task, ...). */
  readonly anchorOf: (value: object) => string | undefined
  readonly nodeId: (node: AstNode) => readonly [source: string, index: number] | undefined
  readonly astArray: (array: ReadonlyArray<unknown>) => readonly [source: string, index: number, key: string] | undefined
  /** Values with no data form are reported here; strict encoding throws on the first instead. */
  readonly lost: Array<string>
  readonly strict: boolean
}

/** What the decoder asks of the fresh runtime it restores into. */
export type DecodeEnv = {
  readonly named: (name: string) => Obj | undefined
  readonly anchor: (name: string) => object | undefined
  readonly node: (source: string, index: number) => AstNode | undefined
  readonly astArray: (source: string, index: number, key: string) => Array<unknown> | undefined
  /** An `Interruption` (it holds an Effect cause, which this module does not make). */
  readonly interruption: () => Interruption
}

// --- Registries ---

const symbols = new Map<string, symbol>([
  ["iterator", IteratorSymbol],
  ["asyncIterator", AsyncIteratorSymbol],
  ["pending", PENDING],
  ["optionalShortCircuit", OptionalShortCircuit],
  ["slice", Slice],
  ["deleted", deleted],
  ["descend", DESCEND],
])
const symbolNames = new Map([...symbols].map(([name, symbol]) => [symbol, name]))

/** How one class saves: its own fields in order, and how a restored instance is made whole. */
type ClassSpec = {
  readonly name: string
  readonly ctor: Function
  /** Saved fields, in the order a constructor makes them. */
  readonly fields: ReadonlyArray<string>
  /** Own fields that are not saved: caches and runtime configuration, set to `reset`'s values. */
  readonly skip?: ReadonlyArray<string>
  /** Own fields with the same value on every instance. */
  readonly constants?: Readonly<{ [field: string]: unknown }>
  /** An `Obj`: its prototype, extensibility, and properties are saved too. */
  readonly obj?: boolean
  /** The restored runtime already has this object; it is filled in place. */
  readonly anchor?: string
  /** Sets fields that are not saved, once the saved ones are in. */
  readonly reset?: (value: never) => void
}

const objFields = ["props", "extensible", "proto"]
const callable = { tag: "Function" }

const specs: ReadonlyArray<ClassSpec> = [
  { name: "Obj", ctor: Obj, fields: [], obj: true, constants: { tag: "Object" } },
  { name: "Arr", ctor: Arr, fields: ["items", "elements"], obj: true, constants: { tag: "Array" } },
  { name: "ErrorObj", ctor: ErrorObj, fields: ["failure"], obj: true, constants: { tag: "Error" } },
  {
    name: "Fn",
    ctor: Fn,
    fields: ["length", "parameters", "body", "capturedScopes", "async", "generator", "arrow"],
    obj: true,
    constants: callable,
  },
  { name: "Arguments", ctor: Arguments, fields: [], obj: true, constants: { tag: "Arguments" } },
  // Only named natives are saved (by name); an unnamed one is a host function, saved as `LostNative`.
  { name: "Native", ctor: Native, fields: [], skip: ["length", "call", "construct", "callback"], obj: true },
  {
    name: "BoundFn",
    ctor: BoundFn,
    fields: ["length", "target", "boundThis", "boundArgs"],
    obj: true,
    constants: { ...callable, construct: undefined, callback: true },
  },
  {
    name: "Resolver",
    ctor: Resolver,
    fields: ["length", "resolving", "kind"],
    obj: true,
    constants: { ...callable, construct: undefined, callback: true },
  },
  {
    name: "PromiseObj",
    ctor: PromiseObj,
    fields: ["state", "result", "reactions", "handled", "id"],
    obj: true,
    constants: { tag: "Promise" },
  },
  {
    name: "GeneratorObj",
    ctor: GeneratorObj,
    fields: ["state", "frames", "queue", "asynchronous"],
    obj: true,
    constants: { tag: "Generator" },
  },
  { name: "IteratorObj", ctor: IteratorObj, fields: ["cursor"], obj: true, constants: { tag: "Iterator" } },
  { name: "DateObj", ctor: DateObj, fields: ["time"], obj: true, constants: { tag: "Date" } },
  {
    name: "RegExpObj",
    ctor: RegExpObj,
    fields: ["source", "flags", "lastIndex"],
    skip: ["compiled"],
    obj: true,
    constants: { tag: "RegExp" },
    reset: (value: { compiled: unknown }) => {
      value.compiled = undefined
    },
  },
  { name: "MapObj", ctor: MapObj, fields: ["map"], obj: true, constants: { tag: "Map" } },
  { name: "SetObj", ctor: SetObj, fields: ["set"], obj: true, constants: { tag: "Set" } },
  { name: "WeakMapObj", ctor: WeakMapObj, fields: ["map"], obj: true, constants: { tag: "WeakMap" } },
  { name: "WeakSetObj", ctor: WeakSetObj, fields: ["set"], obj: true, constants: { tag: "WeakSet" } },
  {
    name: "URLSearchParamsObj",
    ctor: URLSearchParamsObj,
    fields: ["params"],
    obj: true,
    constants: { tag: "URLSearchParams" },
  },
  { name: "HeadersObj", ctor: HeadersObj, fields: ["headers"], obj: true, constants: { tag: "Headers" } },
  { name: "URLObj", ctor: URLObj, fields: ["searchParams", "url"], obj: true, constants: { tag: "URL" } },
  { name: "Bytes", ctor: Bytes, fields: ["bytes"], obj: true, constants: { tag: "Uint8Array" } },
  { name: "TextDecoderObj", ctor: TextDecoderObj, fields: ["decoder"], obj: true, constants: { tag: "Object" } },
  {
    name: "AsyncFromSyncIterator",
    ctor: AsyncFromSyncIterator,
    fields: ["sync", "site"],
    obj: true,
    constants: { tag: "AsyncFromSyncIterator" },
  },
  { name: "Helper", ctor: Helper, fields: ["done", "running", "inner", "op", "source", "callback", "count"] },
  { name: "Position", ctor: Position, fields: ["index", "done", "source", "kind", "arrays"] },
  {
    name: "OrderedTable",
    ctor: OrderedTable,
    fields: ["keys", "values", "cursors", "tombstones", "pruneAt"],
    skip: ["index"],
    // The index is derived from the keys.
    reset: (table: { keys: Array<unknown>; index: Map<unknown, number> }) => {
      table.index = new Map()
      table.keys.forEach((key, at) => {
        if (key !== deleted) table.index.set(key, at)
      })
    },
  },
  { name: "ScopeStack", ctor: ScopeStack, fields: ["scopes", "fn"] },
  { name: "Frame", ctor: Frame, fields: ["kind", "node", "phase", "scope", "slots"] },
  {
    name: "HostCall",
    ctor: HostCall,
    fields: ["status", "handle", "id", "key", "request", "label", "blocking", "result", "resolving", "site"],
  },
  { name: "Resolving", ctor: Resolving, fields: ["done", "scheduler", "promise", "site"] },
  { name: "Throw", ctor: Throw, fields: ["value"] },
  { name: "GeneratorReturn", ctor: GeneratorReturn, fields: ["value"] },
  { name: "PendingThrow", ctor: PendingThrow, fields: ["type", "message", "kind", "suggestions", "node", "value"] },
  { name: "Enter", ctor: Enter, fields: ["frames", "input"] },
  { name: "Push", ctor: Push, fields: ["kind", "slots"] },
  { name: "Convert", ctor: Convert, fields: ["hints", "values", "ordinal", "coerce"] },
  { name: "Await", ctor: Await, fields: ["value", "node"] },
  { name: "Yield", ctor: Yield, fields: ["value"] },
  { name: "Host", ctor: Host, fields: ["request"] },
  { name: "Invoke", ctor: Invoke, fields: ["callable", "thisValue", "args", "site"] },
  { name: "ToolReference", ctor: ToolReference, fields: ["path"] },
  { name: "Lost", ctor: Lost, fields: ["description"] },
  {
    name: "Machine",
    ctor: Machine,
    anchor: "machine",
    fields: [
      "depth",
      "intrinsicThen",
      "outcome",
      "parked",
      "runId",
      "queue",
      "head",
      "pending",
      "nextID",
      "nextHostID",
      "unhandled",
      "queued",
      "running",
      "inbox",
      "input",
      "sliced",
    ],
    skip: ["ctx", "root", "fuel", "sliceStart"],
  },
  {
    name: "MachineTask",
    ctor: MachineTask,
    anchor: "task",
    fields: ["stack", "scopes", "signal", "slice"],
    skip: ["machine", "ctx"],
  },
  {
    name: "Interpreter",
    ctor: Interpreter,
    anchor: "ctx",
    fields: ["logs", "templates", "globalScope", "modules", "namespaces"],
    skip: ["tools", "builtins", "machine", "intrinsics", "extensionWork", "sources", "prelude"],
  },
]

const byCtor = new Map<Function, ClassSpec>(specs.map((spec) => [spec.ctor, spec]))
const byName = new Map<string, ClassSpec>(specs.map((spec) => [spec.name, spec]))

/** Host error classes that can travel as a failure, by name. */
const errorClasses = new Map<string, Function>([
  ["Error", Error],
  ["TypeError", TypeError],
  ["RangeError", RangeError],
  ["SyntaxError", SyntaxError],
  ["ReferenceError", ReferenceError],
  ["EvalError", EvalError],
  ["URIError", URIError],
  ["ToolRuntimeError", ToolRuntimeError],
  ["ToolError", ToolError],
])
const errorNames = new Map([...errorClasses].map(([name, ctor]) => [ctor, name]))

let kindNames: Map<object, string> | undefined

/**
 * The names of every frame kind, and of every class with a codec: a build that saves a different set
 * cannot read this one's snapshots.
 */
export const codecShape = (): string =>
  JSON.stringify([
    [...kinds.keys()].sort(),
    specs.map((spec) => [spec.name, spec.fields]),
    [...symbols.keys()],
  ])

// --- Encoding ---

/** Encodes everything reachable from `roots`: the roots' values and the records they refer to. */
export const encode = (
  roots: ReadonlyArray<unknown>,
  env: EncodeEnv,
): { readonly roots: Array<Encoded>; readonly records: Array<Record> } => {
  const encoder = new Encoder(env)
  const encoded = roots.map((root) => encoder.value(root))
  encoder.drain()
  return { roots: encoded, records: encoder.records as Array<Record> }
}

class Encoder {
  readonly records: Array<Record | undefined> = []
  private readonly ids = new Map<object, number>()
  private readonly work: Array<object> = []
  // A URL's `searchParams` is the same host object its URLSearchParams wraps; it is encoded once every URL is known.
  private readonly owners = new Map<URLSearchParams, URL>()
  private readonly params: Array<readonly [number, URLSearchParams]> = []

  constructor(private readonly env: EncodeEnv) {
    kindNames ??= new Map([...kinds].map(([name, kind]) => [kind, name]))
  }

  value(value: unknown): Encoded {
    switch (typeof value) {
      case "string":
      case "boolean":
        return value
      case "undefined":
        return ["u"]
      case "number":
        if (Number.isFinite(value) && !Object.is(value, -0)) return value
        return ["n", Object.is(value, -0) ? "-0" : String(value)]
      case "symbol": {
        const name = symbolNames.get(value)
        if (name === undefined) throw new SnapshotError(`Codec gap: the symbol ${String(value)} has no name.`)
        return ["s", name]
      }
      case "bigint":
        throw new SnapshotError("Codec gap: a bigint has no data form.")
    }
    if (value === null) return null
    const object = value as object
    const kind = kindNames!.get(object)
    if (kind !== undefined) return ["k", kind]
    if (object instanceof Obj) {
      const name = this.env.nameOf(object)
      if (name !== undefined && this.env.unchanged(object, name)) return ["i", name]
    } else if (Array.isArray(object)) {
      const owned = this.env.astArray(object)
      if (owned !== undefined) return ["A", owned[0], owned[1], owned[2]]
    } else {
      const node = this.env.nodeId(object as AstNode)
      if (node !== undefined) return ["a", node[0], node[1]]
    }
    return this.ref(object)
  }

  drain(): void {
    for (let object = this.work.shift(); object !== undefined; object = this.work.shift()) {
      const id = this.ids.get(object)!
      this.records[id] = this.record(object, id)
    }
    for (const [id, params] of this.params) {
      const owner = this.owners.get(params)
      this.records[id] =
        owner === undefined ? { t: "URLSearchParams", s: params.toString() } : { t: "URLSearchParams", o: this.ref(owner) }
    }
  }

  private ref(object: object): Encoded {
    const known = this.ids.get(object)
    if (known !== undefined) return ["r", known]
    const id = this.records.length
    this.ids.set(object, id)
    this.records.push(undefined)
    this.work.push(object)
    return ["r", id]
  }

  private record(object: object, id: number): Record | undefined {
    if (object instanceof Obj) {
      const name = this.env.nameOf(object)
      if (name !== undefined) {
        const spec = this.spec(object)
        return { t: "@", n: name, c: spec.name, ...this.fields(object, spec) }
      }
    }
    if (Array.isArray(object)) {
      // A sparse array (`length` can be ten million with nothing in it) saves only the indexes it has.
      if (object.length > 1024) {
        const present = Object.keys(object)
        if (present.length * 2 < object.length) {
          const entries: Array<Encoded> = []
          for (const key of present) entries.push(Number(key), this.value(object[Number(key)]))
          return { t: "Array", l: object.length, s: entries }
        }
      }
      const items: Array<Encoded> = []
      for (let at = 0; at < object.length; at++) items.push(at in object ? this.value(object[at]) : ["h"])
      return { t: "Array", v: items }
    }
    if (object instanceof Map) {
      const entries: Array<Encoded> = []
      for (const [key, item] of object) entries.push(this.value(key), this.value(item))
      const anchor = this.env.anchorOf(object)
      return anchor === undefined ? { t: "Map", e: entries } : { t: "Map", e: entries, a: anchor }
    }
    if (object instanceof Set) return { t: "Set", e: [...object].map((item) => this.value(item)) }
    const spec = byCtor.get(object.constructor)
    if (spec !== undefined && spec.name !== "Native") {
      if (spec.anchor !== undefined && this.env.anchorOf(object) !== spec.anchor) {
        throw new SnapshotError(`Codec gap: a second ${spec.name} is reachable from the state.`)
      }
      return { t: spec.name, ...this.fields(object, spec) }
    }
    if (object instanceof Native) {
      // A host function made while the program ran: an extension's result. Its name says what was lost.
      this.lose(`the function ${functionName(object)}`)
      return { t: "LostNative", ...this.fields(object, byName.get("Fn")!, ["length"]) }
    }
    const proto = Object.getPrototypeOf(object)
    if (proto === Object.prototype || proto === null) {
      const entries: Array<Encoded> = []
      for (const key of Object.keys(object)) entries.push(key, this.value((object as { [key: string]: unknown })[key]))
      return proto === null ? { t: "Object", e: entries, n: 1 } : { t: "Object", e: entries }
    }
    if (object instanceof Error) return this.error(object)
    if (object instanceof Interruption) return { t: "Interruption" }
    if (object instanceof URL) {
      this.owners.set(object.searchParams, object)
      return { t: "URL", h: object.href }
    }
    if (object instanceof URLSearchParams) {
      this.params.push([id, object])
      return undefined
    }
    if (object instanceof Headers) return { t: "Headers", e: [...object].map(([key, item]) => [key, item]) }
    if (object instanceof Uint8Array) {
      return { t: "Uint8Array", b: this.ref(object.buffer), o: object.byteOffset, l: object.length }
    }
    if (object instanceof ArrayBuffer) return { t: "ArrayBuffer", d: base64(new Uint8Array(object)) }
    if (object instanceof TextDecoder) return { t: "TextDecoder", f: object.fatal, i: object.ignoreBOM }
    const what = typeof object === "function" ? "a host function" : `a host ${object.constructor?.name ?? "object"}`
    this.lose(what)
    return { t: "Lost", d: what }
  }

  private lose(what: string): void {
    if (this.env.strict) throw new SnapshotError(`Codec gap: ${what} has no data form.`)
    this.env.lost.push(what)
  }

  private spec(object: object): ClassSpec {
    const spec = byCtor.get(object.constructor)
    if (spec === undefined) throw new SnapshotError(`Codec gap: ${object.constructor.name} has no codec.`)
    return spec
  }

  // A class instance's saved fields, positional, with its `Obj` header when it is one. Fields the spec does not know
  // are a codec gap: they would be silently dropped.
  private fields(object: object, spec: ClassSpec, only?: ReadonlyArray<string>): { [field: string]: Json } {
    const record = object as { [field: string]: unknown }
    const fields = only ?? spec.fields
    if (only === undefined) {
      for (const key of Object.keys(object)) {
        if (fields.includes(key) || spec.skip?.includes(key) || (spec.constants !== undefined && key in spec.constants)) continue
        if (spec.obj && (objFields.includes(key) || key === "tag")) continue
        throw new SnapshotError(`Codec gap: ${spec.name}.${key} is not saved.`)
      }
    }
    const values = fields.map((field) => (Object.hasOwn(object, field) ? this.value(record[field]) : ["-"]))
    if (!(object instanceof Obj)) return { f: values }
    const props: Array<Encoded> = []
    for (const [key, slot] of object.props) {
      props.push(typeof key === "symbol" ? this.value(key) : key)
      if ("value" in slot) {
        props.push(this.value(slot.value), (slot.writable ? 1 : 0) | (slot.enumerable ? 2 : 0) | (slot.configurable ? 4 : 0))
      } else props.push(null, 8 | (slot.enumerable ? 2 : 0) | (slot.configurable ? 4 : 0))
    }
    return { f: values, p: object.proto === null ? null : this.value(object.proto), x: object.extensible, o: props }
  }

  private error(error: Error): Record {
    const name = errorNames.get(error.constructor)
    if (name === undefined) {
      this.lose(`a host ${error.constructor.name}`)
      return { t: "Lost", d: `a host ${error.constructor.name}` }
    }
    const fields: Array<Encoded> = []
    for (const key of Object.keys(error)) {
      if (key === "message" || key === "stack") continue
      fields.push(key, this.value((error as unknown as { [key: string]: unknown })[key]))
    }
    return { t: "Error", c: name, m: error.message, e: fields }
  }
}

// --- Decoding ---

/** Rebuilds the graph `encode` saved, filling anchors in place: the decoded roots. */
export const decode = (
  saved: { readonly roots: ReadonlyArray<unknown>; readonly records: ReadonlyArray<unknown> },
  env: DecodeEnv,
): Array<unknown> => {
  const decoder = new Decoder(saved.records, env)
  for (let id = 0; id < saved.records.length; id++) decoder.shell(id)
  for (let id = 0; id < saved.records.length; id++) decoder.fill(id)
  decoder.finish()
  return saved.roots.map((root) => decoder.value(root))
}

const invalid = (message: string): never => {
  throw new SnapshotError(`Invalid snapshot: ${message}`)
}

const isRecord = (value: unknown): value is { readonly t: string; readonly [field: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { t?: unknown }).t === "string"

const list = (value: unknown, what: string): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : invalid(`${what} is not a list.`)

const text = (value: unknown, what: string): string => (typeof value === "string" ? value : invalid(`${what} is not text.`))

const count = (value: unknown, what: string): number =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : invalid(`${what} is not a count.`)

const forbidden = new Set(["__proto__", "constructor", "prototype"])

class Decoder {
  private readonly shells: Array<object | undefined>
  private readonly filled: Array<boolean>
  // Derived state is rebuilt once every record is filled in, since it reads other records.
  private readonly resets: Array<() => void> = []

  constructor(
    private readonly records: ReadonlyArray<unknown>,
    private readonly env: DecodeEnv,
  ) {
    this.shells = new Array(records.length)
    this.filled = new Array(records.length).fill(false)
  }

  private at(id: number): { readonly t: string; readonly [field: string]: unknown } {
    const record = this.records[id]
    return isRecord(record) ? record : invalid(`record ${id} is malformed.`)
  }

  // Allocates the object a record restores, before anything is filled in, so references and cycles resolve.
  shell(id: number): object {
    const known = this.shells[id]
    if (known !== undefined) return known
    const record = this.at(id)
    const made = this.make(record, id)
    this.shells[id] = made
    return made
  }

  private make(record: { readonly t: string; readonly [field: string]: unknown }, id: number): object {
    switch (record.t) {
      case "Array":
        return []
      case "Object":
        return record.n === 1 ? Object.create(null) : {}
      case "Map":
        return record.a === undefined ? new Map() : this.anchor(text(record.a, "an anchor"), Map)
      case "Set":
        return new Set()
      case "@": {
        const name = text(record.n, "a built-in name")
        const named = this.env.named(name)
        if (named === undefined) return invalid(`this runtime has no built-in or host global named ${name}.`)
        const spec = this.classSpec(record.c)
        if (named.constructor !== spec.ctor) return invalid(`${name} is not a ${spec.name} in this runtime.`)
        return named
      }
      case "LostNative":
        return Object.create(Native.prototype)
      case "Interruption":
        return this.env.interruption()
      case "Error": {
        const name = text(record.c, "an error class")
        const ctor = errorClasses.get(name) ?? invalid(`unknown error class ${name}.`)
        const message = text(record.m, "an error message")
        if (ctor === ToolError) return toolError(message)
        const made = Object.create(ctor.prototype) as Error
        Object.defineProperty(made, "message", { value: message, writable: true, configurable: true, enumerable: false })
        return made
      }
      case "URL":
        return new URL(text(record.h, "a URL"))
      case "URLSearchParams": {
        if (record.o === undefined) return new URLSearchParams(text(record.s, "search params"))
        const owner = this.value(record.o)
        return owner instanceof URL ? owner.searchParams : invalid(`record ${id} names no URL.`)
      }
      case "Headers": {
        const entries = list(record.e, "headers").map((entry) => {
          const pair = list(entry, "a header")
          return [text(pair[0], "a header name"), text(pair[1], "a header value")] as [string, string]
        })
        return new Headers(entries)
      }
      case "ArrayBuffer":
        return fromBase64(text(record.d, "bytes")).buffer
      case "Uint8Array": {
        const buffer = this.value(record.b)
        if (!(buffer instanceof ArrayBuffer)) return invalid(`record ${id} names no buffer.`)
        const offset = count(record.o, "a byte offset")
        const length = count(record.l, "a byte length")
        if (offset + length > buffer.byteLength) return invalid(`record ${id} reaches past its buffer.`)
        return new Uint8Array(buffer, offset, length)
      }
      case "TextDecoder":
        return new TextDecoder("utf-8", { fatal: record.f === true, ignoreBOM: record.i === true })
    }
    const spec = this.classSpec(record.t)
    if (spec.name === "Native") return invalid("a native is saved only by name.")
    if (spec.anchor !== undefined) return this.anchor(spec.anchor, spec.ctor)
    return Object.create(spec.ctor.prototype)
  }

  private anchor(name: string, ctor: Function): object {
    const anchor = this.env.anchor(name)
    if (anchor === undefined || anchor.constructor !== ctor) return invalid(`unknown anchor ${name}.`)
    return anchor
  }

  private classSpec(name: unknown): ClassSpec {
    return byName.get(text(name, "a class")) ?? invalid(`unknown record kind ${String(name)}.`)
  }

  fill(id: number): void {
    if (this.filled[id]) return
    this.filled[id] = true
    const record = this.at(id)
    const target = this.shell(id) as { [field: string]: unknown }
    switch (record.t) {
      case "Array": {
        const array = target as unknown as Array<unknown>
        if (record.v === undefined) {
          const length = count(record.l, "an array length")
          if (length > 4_294_967_295) invalid("an array is too long.")
          array.length = length
          const entries = list(record.s, "a sparse array")
          for (let at = 0; at < entries.length; at += 2) {
            const index = count(entries[at], "an array index")
            if (index >= length) invalid("an array index is past its length.")
            array[index] = this.value(entries[at + 1])
          }
          return
        }
        const items = list(record.v, "an array")
        items.forEach((item, at) => {
          if (Array.isArray(item) && item[0] === "h") return
          array[at] = this.value(item)
        })
        array.length = items.length
        return
      }
      case "Object": {
        const entries = list(record.e, "an object")
        for (let at = 0; at < entries.length; at += 2) {
          const key = text(entries[at], "a key")
          Object.defineProperty(target, key, {
            value: this.value(entries[at + 1]),
            writable: true,
            enumerable: true,
            configurable: true,
          })
        }
        return
      }
      case "Map": {
        const map = target as unknown as Map<unknown, unknown>
        if (record.a !== undefined) map.clear()
        const entries = list(record.e, "a map")
        for (let at = 0; at < entries.length; at += 2) map.set(this.value(entries[at]), this.value(entries[at + 1]))
        return
      }
      case "Set": {
        const set = target as unknown as Set<unknown>
        for (const item of list(record.e, "a set")) set.add(this.value(item))
        return
      }
      case "Error": {
        const entries = list(record.e, "an error")
        for (let at = 0; at < entries.length; at += 2) {
          const key = text(entries[at], "a key")
          if (forbidden.has(key)) invalid(`an error field is named ${key}.`)
          Object.defineProperty(target, key, {
            value: this.value(entries[at + 1]),
            writable: true,
            enumerable: true,
            configurable: true,
          })
        }
        return
      }
      case "@":
        return this.fillClass(target, record, this.classSpec(record.c), true)
      case "LostNative": {
        this.fillClass(target, record, byName.get("Fn")!, false, ["length"])
        const native = target as unknown as { tag: string; call: unknown; construct: unknown; callback: boolean }
        const name = functionName(target as unknown as Obj)
        native.tag = "Function"
        native.call = (_: unknown, __: unknown, site: AstNode | undefined) => {
          throw lostError(`The function ${name}`, site)
        }
        native.construct = undefined
        native.callback = true
        return
      }
      case "Interruption":
      case "URL":
      case "URLSearchParams":
      case "Headers":
      case "ArrayBuffer":
      case "Uint8Array":
      case "TextDecoder":
        return
    }
    const spec = this.classSpec(record.t)
    this.fillClass(target, record, spec, false)
  }

  private fillClass(
    target: { [field: string]: unknown },
    record: { readonly [field: string]: unknown },
    spec: ClassSpec,
    named: boolean,
    only?: ReadonlyArray<string>,
  ): void {
    const fields = only ?? spec.fields
    const values = list(record.f, `the fields of a ${spec.name}`)
    if (values.length !== fields.length) invalid(`a ${spec.name} has ${values.length} fields, not ${fields.length}.`)
    if (spec.obj || named) this.fillObj(target as unknown as Obj, record)
    if (spec.constants !== undefined) Object.assign(target, spec.constants)
    fields.forEach((field, at) => {
      const value = values[at]
      if (Array.isArray(value) && value[0] === "-") {
        delete target[field]
        return
      }
      target[field] = this.value(value)
    })
    const reset = spec.reset
    if (reset !== undefined) this.resets.push(() => reset(target as never))
  }

  finish(): void {
    for (const reset of this.resets) reset()
  }

  // An object's prototype, extensibility, and properties. A named object's accessors stay the ones it was made with.
  private fillObj(target: Obj, record: { readonly [field: string]: unknown }): void {
    const proto = record.p === null ? null : this.value(record.p)
    if (proto !== null && !(proto instanceof Obj)) invalid("a prototype is not an object.")
    if (typeof record.x !== "boolean") invalid("an object's extensibility is not a boolean.")
    const entries = list(record.o, "an object's properties")
    const props = new Map<string | symbol, Slot>()
    for (let at = 0; at < entries.length; at += 3) {
      const raw = entries[at]
      const key = typeof raw === "string" ? raw : this.value(raw)
      if (typeof key !== "string" && typeof key !== "symbol") invalid("a property key is not a string or symbol.")
      const flags = count(entries[at + 2], "property flags")
      const enumerable = (flags & 2) !== 0
      const configurable = (flags & 4) !== 0
      if ((flags & 8) !== 0) {
        const original = target.props?.get(key as string | symbol)
        if (original === undefined || "value" in original) invalid(`the accessor ${String(key)} has no original.`)
        const accessor = original as Extract<Slot, { get: unknown }>
        props.set(key as string | symbol, { get: accessor.get, set: accessor.set, enumerable, configurable })
        continue
      }
      props.set(key as string | symbol, {
        value: this.value(entries[at + 1]) as Value,
        writable: (flags & 1) !== 0,
        enumerable,
        configurable,
      })
    }
    const writable = target as unknown as { props: Map<string | symbol, Slot>; proto: Obj | null; extensible: boolean }
    writable.props = props
    writable.extensible = record.x as boolean
    writable.proto = proto as Obj | null
  }

  value(value: unknown): unknown {
    switch (typeof value) {
      case "string":
      case "boolean":
        return value
      case "number":
        return Number.isFinite(value) ? value : invalid("a number is not finite.")
    }
    if (value === null) return null
    if (!Array.isArray(value)) return invalid("a value is neither JSON data nor a tag.")
    switch (value[0]) {
      case "u":
        return undefined
      case "n":
        switch (value[1]) {
          case "NaN":
            return Number.NaN
          case "Infinity":
            return Number.POSITIVE_INFINITY
          case "-Infinity":
            return Number.NEGATIVE_INFINITY
          case "-0":
            return -0
        }
        return invalid(`unknown number ${String(value[1])}.`)
      case "s":
        return symbols.get(text(value[1], "a symbol")) ?? invalid(`unknown symbol ${String(value[1])}.`)
      case "k":
        return kinds.get(text(value[1], "a kind")) ?? invalid(`unknown frame kind ${String(value[1])}.`)
      case "i": {
        const name = text(value[1], "a built-in name")
        return this.env.named(name) ?? invalid(`this runtime has no built-in or host global named ${name}.`)
      }
      case "a":
        return (
          this.env.node(text(value[1], "a source"), count(value[2], "a node index")) ??
          invalid(`no node ${String(value[2])} in source ${String(value[1])}.`)
        )
      case "A":
        return (
          this.env.astArray(text(value[1], "a source"), count(value[2], "a node index"), text(value[3], "a key")) ??
          invalid(`no list ${String(value[3])} on node ${String(value[2])}.`)
        )
      case "r": {
        const id = count(value[1], "a record id")
        if (id >= this.records.length) invalid(`record ${id} does not exist.`)
        return this.shell(id)
      }
    }
    return invalid(`unknown tag ${String(value[0])}.`)
  }
}

const functionName = (fn: Obj): string => {
  const slot = fn.props.get("name")
  return slot !== undefined && "value" in slot && typeof slot.value === "string" && slot.value !== ""
    ? slot.value
    : "(anonymous)"
}

const base64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

const fromBase64 = (encoded: string): Uint8Array => {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
  return bytes
}
