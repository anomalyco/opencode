import packageJson from "../../package.json" with { type: "json" }
import type { Interpreter } from "../interpreter/interpreter.js"
import type { AstNode } from "../interpreter/model.js"
import { Arr, Fn, Native, Obj, type Slot, type Value } from "../interpreter/objects.js"
import { preludeSource } from "../prelude/prelude.js"
import type { Interruption } from "../interpreter/signals.js"
import { nodeId, type Source } from "../interpreter/source.js"
import { ToolReference, type ToolCall } from "../tool-runtime.js"
import { codecShape, decode, type Encoded, encode, type Record, SnapshotError } from "./codec.js"

export { SnapshotError }

/** The snapshot format this build writes and reads. */
export const FORMAT = 1

/**
 * A suspended run's whole state as JSON: a header that says which build and sources it belongs to and what budget it
 * has used, and the graph of records (see codec.ts) rooted at the machine, the interpreter, and the root task, then
 * every built-in or host global the run changed.
 */
export type Snapshot = {
  readonly format: typeof FORMAT
  readonly header: Header
  readonly roots: ReadonlyArray<Encoded>
  readonly records: ReadonlyArray<Record>
}

export type Header = {
  /** The build that wrote it: the package version, and a hash of the frame kinds, consumers, codecs, and built-ins. */
  readonly build: string
  /** A hash of the host's globals (extensions, a test harness), which the resuming runtime must have too. */
  readonly hosts: string
  readonly runId: string
  /** The program texts, re-parsed on restore and checked against their hashes. */
  readonly sources: ReadonlyArray<{ readonly id: string; readonly code: string; readonly hash: string }>
  readonly limits: {
    readonly timeoutMs: number | null
    readonly maxToolCalls: number | null
    readonly maxOutputBytes: number | null
  }
  /** What the run has used so far, across every resume: active milliseconds, and tool calls admitted. */
  readonly budget: { readonly activeMs: number; readonly toolCalls: number }
  readonly toolCalls: ReadonlyArray<ToolCall>
}

/** A runtime with the intrinsics and nothing else, which the build id is taken from. */
export type Bare = Interpreter<unknown>

let build: string | undefined

/** This build's id; a snapshot resumes only on the build that wrote it. */
export const buildId = (bare: Bare): string =>
  (build ??= `${packageJson.version}+${hash(`${FORMAT}\n${codecShape()}\n${hash(preludeSource().code)}\n${bare.intrinsics.all().join("\n")}`)}`)

const hostsId = (ctx: Interpreter<unknown>): string =>
  hash(
    ctx.intrinsics
      .all()
      .filter((name) => name.startsWith("@"))
      .join("\n"),
  )

/** Saves a run's state. `pristine` is a fresh runtime with the same host globals, to tell which built-ins changed. */
export const capture = (
  ctx: Interpreter<unknown>,
  options: {
    readonly bare: Bare
    readonly pristine: Interpreter<unknown>
    readonly runId: string
    readonly limits: Header["limits"]
    readonly activeMs: number
    readonly strict: boolean
  },
): { readonly snapshot: Snapshot; readonly lost: ReadonlyArray<string> } => {
  const machine = ctx.machine
  machine.compact()
  const lost: Array<string> = []
  const current = ctx.intrinsics
  const pristine = options.pristine.intrinsics
  const sources = [...ctx.sources.values()]
  const anchors = new Map<object, string>([
    [machine, "machine"],
    [machine.root, "task"],
    [ctx, "ctx"],
    [ctx.globalScope, "globals"],
    [ctx.prelude.scope, "prelude"],
  ])
  // A change to a built-in is saved even where no saved value refers to it (`Boolean.prototype.toString = ...`).
  const unchanged = new Map<Obj, boolean>()
  const isUnchanged = (value: Obj, name: string) => {
    let same = unchanged.get(value)
    if (same === undefined) {
      const original = pristine.valueOf(name)
      same = original !== undefined && sameObject(value, original, current, pristine)
      unchanged.set(value, same)
    }
    return same
  }
  const names = current.all()
  const changed = current.values.filter((value, at) => !isUnchanged(value, names[at]!))
  const encoded = encode([machine, ctx, machine.root, ...changed], {
    nameOf: (value) => current.nameOf(value),
    unchanged: isUnchanged,
    anchorOf: (value) => anchors.get(value),
    nodeId: (node) => {
      const id = nodeId(node)
      return id !== undefined && ctx.sources.has(id.source) ? [id.source, id.index] : undefined
    },
    astArray: (array) => {
      for (const source of sources) {
        const owner = astArrays(source).get(array)
        if (owner !== undefined) return [source.id, owner[0], owner[1]]
      }
      return undefined
    },
    lost,
    strict: options.strict,
  })
  const snapshot: Snapshot = {
    format: FORMAT,
    header: {
      build: buildId(options.bare),
      hosts: hostsId(ctx),
      runId: options.runId,
      // The prelude is named by the build id, never copied.
      sources: sources
        .filter((source) => source !== preludeSource())
        .map((source) => ({ id: source.id, code: source.code, hash: hash(source.code) })),
      limits: options.limits,
      budget: { activeMs: options.activeMs, toolCalls: ctx.tools.calls.length },
      toolCalls: ctx.tools.calls.map((call) => ({ name: call.name })),
    },
    roots: encoded.roots,
    records: encoded.records,
  }
  return { snapshot, lost }
}

/**
 * Restores a saved state into `fresh`, a new runtime made with the same host globals and no bindings, after checking
 * that the snapshot is well formed and belongs to this build, these host globals, and its own sources.
 */
export const restore = (
  saved: unknown,
  fresh: Interpreter<unknown>,
  options: {
    readonly bare: Bare
    readonly parse: (code: string) => Source
    readonly interruption: () => Interruption
  },
): Snapshot => {
  const snapshot = validate(saved)
  const header = snapshot.header
  const expected = buildId(options.bare)
  if (header.build !== expected) {
    throw new SnapshotError(
      `This state was saved by another Code Mode build (${header.build}); this runtime is ${expected}, so it can't resume it.`,
    )
  }
  if (header.hosts !== hostsId(fresh)) {
    throw new SnapshotError(
      "This state was saved by a runtime with other host globals (extensions); resume it with the same ones.",
    )
  }
  for (const source of header.sources) {
    if (hash(source.code) !== source.hash) throw new SnapshotError(`Source ${source.id} does not match its hash.`)
    const parsed = options.parse(source.code)
    if (parsed.id !== source.id) throw new SnapshotError(`Source ${source.id} is not a program source.`)
    fresh.sources.set(source.id, parsed)
  }
  const anchors = new Map<string, object>([
    ["machine", fresh.machine],
    ["task", fresh.machine.root],
    ["ctx", fresh],
    ["globals", fresh.globalScope],
    ["prelude", fresh.prelude.scope],
  ])
  decode(snapshot, {
    named: (name) => fresh.intrinsics.valueOf(name),
    anchor: (name) => anchors.get(name),
    node: (source, index) => fresh.sources.get(source)?.nodes[index],
    astArray: (source, index, key) => {
      const node = fresh.sources.get(source)?.nodes[index] as { readonly [key: string]: unknown } | undefined
      const owned = node?.[key]
      return key !== "loc" && Array.isArray(owned) ? owned : undefined
    },
    interruption: options.interruption,
  })
  fresh.tools.calls.push(...header.toolCalls.map((call) => ({ name: call.name })))
  return snapshot
}

/** A snapshot as bytes: UTF-8 JSON. */
export const toBytes = (snapshot: Snapshot): Uint8Array => new TextEncoder().encode(JSON.stringify(snapshot))

/** Reads bytes `toBytes` wrote; `restore` checks what they hold. */
export const fromBytes = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    throw new SnapshotError(`Invalid snapshot: the bytes are not UTF-8 JSON (${String(error)}).`)
  }
}

/** A snapshot's size in bytes. */
export const byteLength = (snapshot: Snapshot): number => toBytes(snapshot).byteLength

// --- Validation ---

const fail = (message: string): never => {
  throw new SnapshotError(`Invalid snapshot: ${message}`)
}

const object = (value: unknown, what: string): { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: unknown })
    : fail(`${what} is not an object.`)

const array = (value: unknown, what: string): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : fail(`${what} is not a list.`)

const string = (value: unknown, what: string): string =>
  typeof value === "string" ? value : fail(`${what} is not text.`)

const number = (value: unknown, what: string): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fail(`${what} is not a number.`)

const limit = (value: unknown, what: string): number | null => (value === null ? null : number(value, what))

/** A saved state's header, checked in full, before anything is restored. */
export const header = (saved: unknown): Header => validate(saved).header

// The header is checked in full; records are checked as they are decoded.
const validate = (saved: unknown): Snapshot => {
  const root = object(saved, "the snapshot")
  if (root.format !== FORMAT) fail(`format ${String(root.format)} is not ${FORMAT}.`)
  const header = object(root.header, "the header")
  const limits = object(header.limits, "the limits")
  const budget = object(header.budget, "the budget")
  const checked: Header = {
    build: string(header.build, "the build"),
    hosts: string(header.hosts, "the host globals"),
    runId: string(header.runId, "the run id"),
    sources: array(header.sources, "the sources").map((item) => {
      const source = object(item, "a source")
      return {
        id: string(source.id, "a source id"),
        code: string(source.code, "a source"),
        hash: string(source.hash, "a source hash"),
      }
    }),
    limits: {
      timeoutMs: limit(limits.timeoutMs, "timeoutMs"),
      maxToolCalls: limit(limits.maxToolCalls, "maxToolCalls"),
      maxOutputBytes: limit(limits.maxOutputBytes, "maxOutputBytes"),
    },
    budget: { activeMs: number(budget.activeMs, "the active time"), toolCalls: number(budget.toolCalls, "tool calls") },
    toolCalls: array(header.toolCalls, "the tool calls").map((item) => ({
      name: string(object(item, "a tool call").name, "a tool name"),
    })),
  }
  const roots = array(root.roots, "the roots")
  if (roots.length < 3) fail("there are fewer than three roots.")
  return {
    format: FORMAT,
    header: checked,
    roots: roots as ReadonlyArray<Encoded>,
    records: array(root.records, "the records") as ReadonlyArray<Record>,
  }
}

// --- Helpers ---

const arrays = new WeakMap<Source, Map<ReadonlyArray<unknown>, readonly [number, string]>>()

// The lists AST nodes own (a function's parameters, a block's body), by node and key, so state that holds one keeps
// pointing into the tree, where caches are keyed by them.
const astArrays = (source: Source): Map<ReadonlyArray<unknown>, readonly [number, string]> => {
  const known = arrays.get(source)
  if (known !== undefined) return known
  const owned = new Map<ReadonlyArray<unknown>, readonly [number, string]>()
  source.nodes.forEach((node: AstNode, index) => {
    for (const [key, child] of Object.entries(node))
      if (key !== "loc" && Array.isArray(child)) owned.set(child, [index, key])
  })
  arrays.set(source, owned)
  return owned
}

type Names = Interpreter<unknown>["intrinsics"]

// Whether a named object is as the runtime made it: same class, prototype, extensibility, and properties, with object
// values that are the same-named built-ins. Objects of other classes (an extension's Map, say) always count as changed.
const sameObject = (value: Obj, original: Obj, names: Names, pristine: Names): boolean => {
  const ctor = value.constructor
  if (ctor !== original.constructor || (ctor !== Obj && ctor !== Arr && ctor !== Native && ctor !== Fn)) return false
  if (value.extensible !== original.extensible) return false
  if (!sameValue(value.proto, original.proto, names, pristine)) return false
  if (value.props.size !== original.props.size) return false
  const left = value.props.entries()
  const right = original.props.entries()
  for (let a = left.next(), b = right.next(); !a.done && !b.done; a = left.next(), b = right.next()) {
    if (a.value[0] !== b.value[0] || !sameSlot(a.value[1], b.value[1], names, pristine)) return false
  }
  if (value instanceof Arr && original instanceof Arr) {
    const elements = value.elements
    if (
      elements.writable !== original.elements.writable ||
      elements.enumerable !== original.elements.enumerable ||
      elements.configurable !== original.elements.configurable ||
      value.items.length !== original.items.length
    ) {
      return false
    }
    for (let at = 0; at < value.items.length; at++) {
      if (at in value.items !== at in original.items) return false
      if (!sameValue(value.items[at], original.items[at], names, pristine)) return false
    }
  }
  return true
}

const sameSlot = (slot: Slot, original: Slot, names: Names, pristine: Names): boolean => {
  if (slot.enumerable !== original.enumerable || slot.configurable !== original.configurable) return false
  if (!("value" in slot)) return !("value" in original)
  return (
    "value" in original && slot.writable === original.writable && sameValue(slot.value, original.value, names, pristine)
  )
}

const sameValue = (value: Value | null, original: Value | null, names: Names, pristine: Names): boolean => {
  if (value instanceof Obj) {
    if (!(original instanceof Obj)) return false
    const name = names.nameOf(value)
    return name !== undefined && name === pristine.nameOf(original)
  }
  if (value instanceof ToolReference) {
    return (
      original instanceof ToolReference &&
      value.path.length === original.path.length &&
      value.path.every((segment, at) => segment === original.path[at])
    )
  }
  return Object.is(value, original)
}

// FNV-1a over UTF-16 code units, twice with different offsets: a fingerprint, not a security check.
const hash = (text: string): string => {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x9e3779b9
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x01000193) ^ (b >>> 13)
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0")
}
