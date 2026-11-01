import type { ArrowFunctionExpression, FunctionDeclaration, FunctionExpression, Node, Program } from "acorn"
import type { Repl } from "../repl.js"
import { ToolReference } from "../tool-runtime.js"
import { TextDecoderObj } from "../stdlib/bytes.js"
import { parseProgram } from "./execute.js"
import type { Builtins } from "./intrinsics.js"
import type { Declaration, Interpreter } from "./interpreter.js"
import { AsyncIteratorSymbol, type Binding, IteratorSymbol } from "./model.js"
import {
  Arguments,
  Arr,
  type Attributes,
  Bytes,
  Callable,
  DateObj,
  ErrorObj,
  Fn,
  HeadersObj,
  keys,
  Lost,
  MapObj,
  Native,
  Obj,
  PromiseObj,
  RegExpObj,
  SetObj,
  type Slot,
  URLObj,
  URLSearchParamsObj,
  type Value,
} from "./objects.js"

// A REPL snapshot: one JSON record per object, scope, and cell source, keyed by an id that stays the same for the
// object's lifetime, so a later save rewrites only the records whose text changed. Built-ins are saved by name and
// tools by path, so both resolve against the runtime that restores them; anything else that cannot be saved becomes
// a lost record, which restores as a value that throws.

/** A saved value: inline primitives, or a tagged reference. */
type Saved =
  | string
  | number
  | boolean
  | null
  | { readonly r: number }
  | { readonly u: 1 }
  | { readonly n: "NaN" | "Infinity" | "-Infinity" | "-0" }
  | { readonly s: "iterator" | "asyncIterator" }
  | { readonly i: string }
  | { readonly t: ReadonlyArray<string> }
  | { readonly g: 1 }
  | { readonly h: 1 }

type Property = readonly [key: string | { readonly s: "iterator" | "asyncIterator" }, value: Saved, flags?: number]
type ScopeEntry = readonly [name: string, value: Saved, flags: number, declaration?: Declaration, cell?: number]

/** Every record kind's fields; `k` names the kind. */
type Data = {
  readonly k: string
  readonly p?: Saved
  readonly x?: 0
  readonly o?: ReadonlyArray<Property>
  readonly a?: ReadonlyArray<Saved>
  readonly el?: number
  readonly e?: ReadonlyArray<readonly [Saved, Saved]>
  readonly v?: Saved
  readonly s?: string
  readonly f?: string
  readonly n?: number
  readonly at?: readonly [number, number]
  readonly sc?: ReadonlyArray<Saved>
  readonly b?: ReadonlyArray<ScopeEntry>
  readonly m?: string
}

/** What the REPL keeps about each top-level binding besides its value. */
export type BindingMeta = { readonly declaration: Declaration; readonly cell: number }

/** The state a cell runs against: identities and record text from the last commit, and the sources of its functions. */
export type State = {
  readonly scope: Map<string, Binding>
  readonly meta: Map<string, BindingMeta>
  /** Record ids of objects, scopes, and sources loaded or saved before. */
  readonly ids: Map<object, number>
  /** Record text by id as last committed, to skip unchanged records. */
  readonly stored: Map<number, string>
  readonly sources: Sources
  nextId: number
}

/** One cell's source text and its functions by body position. */
class Source {
  readonly functions = new Map<string, FunctionNode>()
  constructor(readonly text: string) {}
}

/** Cell sources, so a function saves as its source plus the position of its body. */
export class Sources {
  private readonly bodies = new WeakMap<Node, Source>()
  private readonly byId = new Map<number, Source>()

  add(text: string, program: Program, id?: number): Source {
    const source = new Source(text)
    if (id !== undefined) this.byId.set(id, source)
    walkFunctions(program, (node) => {
      this.bodies.set(node.body, source)
      source.functions.set(`${node.body.start}:${node.body.end}`, node)
    })
    return source
  }

  /** The source a function body was parsed from. */
  of(body: Node): Source | undefined {
    return this.bodies.get(body)
  }

  get(id: number, text: () => string | undefined): Source | undefined {
    const known = this.byId.get(id)
    if (known !== undefined) return known
    const code = text()
    if (code === undefined) return undefined
    const parsed = parseProgram(code)
    return parsed.ok ? this.add(code, parsed.program, id) : undefined
  }
}

type FunctionNode = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression

const walkFunctions = (root: Node, visit: (node: FunctionNode) => void): void => {
  const pending: Array<unknown> = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === null || typeof node !== "object") continue
    if (Array.isArray(node)) {
      pending.push(...node)
      continue
    }
    const type = (node as { type?: unknown }).type
    if (type === "FunctionDeclaration" || type === "FunctionExpression" || type === "ArrowFunctionExpression") {
      visit(node as FunctionNode)
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== "loc" && child !== null && typeof child === "object") pending.push(child)
    }
  }
}

// --- Built-ins by name ---

/** The built-in objects of one runtime by stable path, and their own properties when the cell started. */
export type Intrinsics = {
  readonly names: Map<Obj, string>
  readonly objects: Map<string, Obj>
  readonly initial: Map<
    Obj,
    {
      readonly extensible: boolean
      readonly slots: ReadonlyArray<Slot>
      readonly values: ReadonlyArray<Value>
    }
  >
}

/** Names every built-in reachable from the stable globals (built-ins and extensions), before the program runs. */
export const intrinsics = <R>(ctx: Interpreter<R>, stable: ReadonlySet<string>): Intrinsics => {
  const names = new Map<Obj, string>()
  const objects = new Map<string, Obj>()
  const initial: Intrinsics["initial"] = new Map()
  const pending: Array<readonly [Obj, string]> = []
  const visit = (target: Obj, path: string) => {
    if (names.has(target)) return
    names.set(target, path)
    objects.set(path, target)
    pending.push([target, path])
  }
  for (const [name, binding] of ctx.globalScope) {
    if (stable.has(name) && binding.value instanceof Obj) visit(binding.value, name)
  }
  let index = 0
  const drain = () => {
    for (; index < pending.length; index++) {
      const [target, path] = pending[index]!
      const slots = [...target.props.values()]
      initial.set(target, { extensible: target.extensible, slots, values: slots.map(slotValue) })
      for (const [key, slot] of target.props) {
        if ("value" in slot && slot.value instanceof Obj) visit(slot.value, `${path}.${propertyName(key)}`)
      }
    }
  }
  // Paths from the globals read best (`Array.prototype.map`); prototypes no global reaches get `%Name%`.
  drain()
  for (const [name, proto] of Object.entries(ctx.builtins as Builtins)) visit(proto, `%${name}%`)
  drain()
  return { names, objects, initial }
}

/** Built-ins the cell changed, whose changes are not saved because built-ins come fresh with every runtime. */
export const changedIntrinsics = (intrinsics: Intrinsics): Array<string> =>
  [...intrinsics.initial].flatMap(([target, before]) => {
    const slots = [...target.props.values()]
    const same =
      before.slots.length === slots.length &&
      before.extensible === target.extensible &&
      slots.every((slot, index) => slot === before.slots[index] && Object.is(slotValue(slot), before.values[index]))
    return same ? [] : [intrinsics.names.get(target)!]
  })

const symbolName = (key: symbol) => ({
  s: key === AsyncIteratorSymbol ? ("asyncIterator" as const) : ("iterator" as const),
})

const slotValue = (slot: Slot): Value => ("value" in slot ? slot.value : undefined)

const propertyName = (key: string | symbol): string =>
  key === IteratorSymbol ? "@@iterator" : key === AsyncIteratorSymbol ? "@@asyncIterator" : String(key)

// --- Saving ---

export class StateTooLarge {
  constructor(
    readonly name: string,
    readonly bytes: number,
  ) {}
}

export type Encoded = {
  readonly root: number
  readonly records: ReadonlyArray<Repl.Record>
  readonly bytes: number
  readonly bindings: ReadonlyArray<Repl.Binding>
  /** Values found unsaveable in this save, described for the cell's warnings. */
  readonly lost: ReadonlyArray<string>
}

/**
 * Encodes everything reachable from the top-level scope. Records whose text matches the last commit are counted but
 * not returned. Stops with `StateTooLarge` once the encoded text passes `maxBytes`, so saving stays bounded.
 */
export const encode = <R>(
  ctx: Interpreter<R>,
  table: Intrinsics,
  state: State,
  cell: number,
  maxBytes: number,
): Encoded | StateTooLarge => {
  const records: Array<Repl.Record> = []
  const lost: Array<string> = []
  const done = new Set<number>()
  let total = 0
  let exceeded: StateTooLarge | undefined
  let current = { name: "", cell, bytes: 0 }
  const pending: Array<readonly [target: object, path: string]> = []

  const idOf = (target: object): number => {
    const known = state.ids.get(target)
    if (known !== undefined) return known
    const id = state.nextId++
    state.ids.set(target, id)
    return id
  }

  // `counted` bytes of the text were already added while the record was built.
  const lostIds = new Map<number, string>()
  const emit = (id: number, data: Data, refs: Array<number>, counted = 0) => {
    done.add(id)
    if (data.k === "l" && data.m !== undefined) lostIds.set(id, data.m)
    const text = JSON.stringify(data)
    count(Buffer.byteLength(text) - counted)
    if (state.stored.get(id) === text) return
    state.stored.set(id, text)
    records.push({ id, data: text, refs })
  }

  const count = (bytes: number) => {
    total += bytes
    current.bytes += bytes
    if (total > maxBytes) exceeded ??= new StateTooLarge(current.name, total)
  }

  const reference = (target: object, path: string): { readonly r: number } => {
    const id = idOf(target)
    if (!done.has(id)) {
      done.add(id)
      pending.push([target, path])
    }
    return { r: id }
  }

  const value = (item: Value, path: string): Saved => {
    if (item === undefined) return { u: 1 }
    if (item === null || typeof item === "string" || typeof item === "boolean") return item
    if (typeof item === "number") {
      if (Number.isNaN(item)) return { n: "NaN" }
      if (item === Infinity) return { n: "Infinity" }
      if (item === -Infinity) return { n: "-Infinity" }
      return Object.is(item, -0) ? { n: "-0" } : item
    }
    if (typeof item === "symbol") return symbolName(item)
    if (item instanceof ToolReference) return { t: item.path }
    const name = table.names.get(item)
    if (name !== undefined) return { i: name }
    return reference(item, path)
  }

  const encodeObject = (target: Obj, path: string): { data: Data; refs: Array<number> } | string => {
    const refs: Array<number> = []
    const item = (child: Value, childPath: string): Saved => {
      const saved = value(child, childPath)
      if (typeof saved === "object" && saved !== null && "r" in saved) refs.push(saved.r)
      return saved
    }
    const base = () => ({
      p: target.proto === null ? null : item(target.proto, `${path} (prototype)`),
      ...(target.extensible ? {} : { x: 0 as const }),
      o: [...target.props].map(([key, slot]): Property => {
        const name = typeof key === "symbol" ? symbolName(key) : key
        const childPath =
          typeof key === "string" && /^[A-Za-z_$][\w$]*$/.test(key)
            ? `${path}.${key}`
            : `${path}[${JSON.stringify(propertyName(key))}]`
        if (!("value" in slot))
          return [name, item(lostValue(ctx, "an accessor property", childPath, current.cell), childPath)]
        const flags = attributeFlags(slot)
        return flags === 7 ? [name, item(slot.value, childPath)] : [name, item(slot.value, childPath), flags]
      }),
    })
    const codec = codecs.get(target.constructor)
    if (codec === undefined) return unsaveable(target)
    // Every element takes at least a byte, so a huge array stops here instead of being copied first.
    if (target instanceof Arr && total + target.items.length > maxBytes) {
      exceeded ??= new StateTooLarge(current.name, total + target.items.length)
      return { data: { k: codec.kind }, refs }
    }
    const fields = codec.encode(target, item, path, state.sources, (child, childPath) => {
      const saved = child === ctx.globalScope ? ({ g: 1 } as const) : reference(child, childPath)
      if ("r" in saved) refs.push(saved.r)
      return saved
    })
    if (typeof fields === "string") return fields
    return { data: { ...base(), ...fields, k: codec.kind }, refs }
  }

  const encodeScope = (target: Map<string, Binding>, path: string): { data: Data; refs: Array<number> } => {
    const refs: Array<number> = []
    const entries = [...target].map(([name, binding]): ScopeEntry => {
      const saved = value(binding.value, `${path} (closure variable ${name})`)
      if (typeof saved === "object" && saved !== null && "r" in saved) refs.push(saved.r)
      return [name, saved, bindingFlags(binding)]
    })
    return { data: { k: "s", b: entries }, refs }
  }

  const drain = () => {
    for (let next = pending.pop(); next !== undefined && exceeded === undefined; next = pending.pop()) {
      const [target, path] = next
      const id = state.ids.get(target)!
      if (target instanceof Map) {
        const encoded = encodeScope(target, path)
        emit(id, encoded.data, encoded.refs)
        continue
      }
      if (target instanceof Lost) {
        emit(id, { k: "l", m: target.message }, [])
        continue
      }
      if (target instanceof Source) {
        emit(id, { k: "src", s: target.text }, [])
        continue
      }
      const encoded = encodeObject(target as Obj, path)
      if (typeof encoded === "string") {
        const message = lostMessage(encoded, path, current.cell)
        lost.push(message)
        emit(id, { k: "l", m: message }, [])
        continue
      }
      emit(id, encoded.data, encoded.refs)
    }
  }

  const bindings: Array<Repl.Binding> = []
  const rootId = idOf(state.scope)
  // Closures that captured the top-level scope refer to it; it is encoded last, with each binding's metadata.
  done.add(rootId)
  const entries: Array<ScopeEntry> = []
  const refs: Array<number> = []
  let inline = 0
  for (const [name, binding] of state.scope) {
    const meta = state.meta.get(name) ?? { declaration: "let" as const, cell }
    current = { name, cell: meta.cell, bytes: 0 }
    const saved = value(binding.value, name)
    if (typeof saved === "object" && saved !== null && "r" in saved) refs.push(saved.r)
    // A primitive is stored inline in the top-level scope record, but it still belongs to its binding.
    const size = typeof saved === "string" ? Buffer.byteLength(JSON.stringify(saved)) : 0
    inline += size
    count(size)
    drain()
    if (exceeded !== undefined) return exceeded
    entries.push([name, saved, bindingFlags(binding), meta.declaration, meta.cell])
    // Describe the value as the next cell will see it: a value saved as lost is listed as lost.
    const lostAs = typeof saved === "object" && saved !== null && "r" in saved ? lostIds.get(saved.r) : undefined
    bindings.push({
      name,
      declaration: meta.declaration,
      cell: meta.cell,
      kind: lostAs === undefined ? kindOf(binding.value) : "lost",
      preview: lostAs === undefined ? preview(table, binding) : "<lost>",
      bytes: current.bytes,
      ...(lostAs === undefined ? {} : { lost: lostAs }),
    })
  }
  current = { name: "", cell, bytes: 0 }
  emit(rootId, { k: "s", b: entries }, refs, inline)
  if (exceeded !== undefined) return exceeded
  return { root: rootId, records, bytes: total, bindings, lost }
}

const bindingFlags = (binding: Binding): number => (binding.mutable ? 1 : 0) | (binding.initialized === false ? 0 : 2)

const attributeFlags = (slot: Attributes): number =>
  (slot.writable ? 1 : 0) | (slot.enumerable ? 2 : 0) | (slot.configurable ? 4 : 0)

const attributes = (flags: number): Attributes => ({
  writable: (flags & 1) !== 0,
  enumerable: (flags & 2) !== 0,
  configurable: (flags & 4) !== 0,
})

const lostMessage = (what: string, path: string, cell: number): string =>
  `\`${path.length > 120 ? `${path.slice(0, 117)}...` : path}\` from cell ${cell} held ${what}, which cannot be kept between REPL cells, so it was not saved. Recompute it.`

const lostValue = <R>(ctx: Interpreter<R>, what: string, path: string, cell: number): Lost =>
  new Lost(ctx.builtins.Function, lostMessage(what, path, cell))

// --- Kinds ---

type Item = (value: Value, path: string) => Saved
type Ref = (target: Map<string, Binding> | Source, path: string) => Saved
type Restore = (saved: Saved | undefined) => Value
type RestoreScope = (saved: Saved) => Map<string, Binding>

/** How one object kind saves the state beyond its prototype and properties, and how it comes back. */
type Codec<T extends Obj> = {
  readonly kind: string
  /** The kind's fields, or why this object cannot be saved. */
  readonly encode: (target: T, item: Item, path: string, sources: Sources, ref: Ref) => Partial<Data> | string
  /** An empty object of the kind, before any value it refers to exists; undefined when it cannot be restored. */
  readonly create: (data: Data, builtins: Builtins, sources: (id: number) => Source | undefined) => T | undefined
  readonly fill?: (target: T, data: Data, restore: Restore, scope: RestoreScope) => void
}

const codec = <T extends Obj>(cls: abstract new (...args: never) => T, definition: Codec<T>) =>
  [cls as Function, definition as unknown as Codec<Obj>] as const

const codecs = new Map<Function, Codec<Obj>>([
  codec(Obj, { kind: "o", encode: () => ({}), create: (_, builtins) => new Obj(builtins.Object) }),
  codec(ErrorObj, { kind: "err", encode: () => ({}), create: (_, builtins) => new ErrorObj(builtins.Error) }),
  codec(Arguments, { kind: "args", encode: () => ({}), create: (_, builtins) => new Arguments(builtins.Object, []) }),
  codec(Arr, {
    kind: "a",
    encode: (target, item, path) => ({
      a: Array.from({ length: target.items.length }, (_, index) =>
        index in target.items ? item(target.items[index], `${path}[${index}]`) : { h: 1 as const },
      ),
      el: attributeFlags(target.elements),
    }),
    create: (_, builtins) => new Arr(builtins.Array),
    fill: (target, data, restore) => {
      target.elements = attributes(data.el ?? 7)
      target.items.length = data.a?.length ?? 0
      data.a?.forEach((saved, index) => {
        if (typeof saved === "object" && saved !== null && "h" in saved) return
        target.items[index] = restore(saved)
      })
    },
  }),
  codec(Fn, {
    kind: "f",
    encode: (target, _, path, sources, ref) => {
      const source = sources.of(target.body)
      if (source === undefined) return "a function whose source is unknown"
      return {
        v: ref(source, path),
        at: [target.body.start, target.body.end],
        sc: target.capturedScopes.map((captured) => ref(captured, `${path} (closure)`)),
      }
    },
    create: (data, builtins, sources) => {
      const source = typeof data.v === "object" && data.v !== null && "r" in data.v ? sources(data.v.r) : undefined
      const node = data.at === undefined ? undefined : source?.functions.get(`${data.at[0]}:${data.at[1]}`)
      if (node === undefined) return undefined
      return new Fn(
        builtins.Function,
        "",
        node.params,
        node.body,
        [],
        node.async,
        node.generator,
        node.type === "ArrowFunctionExpression",
      )
    },
    fill: (target, data, _, scope) => {
      for (const saved of data.sc ?? []) target.capturedScopes.push(scope(saved))
    },
  }),
  codec(DateObj, {
    kind: "d",
    encode: (target) => ({ n: Number.isFinite(target.time) ? target.time : undefined }),
    create: (data, builtins) => new DateObj(builtins.Date, data.n ?? Number.NaN),
  }),
  codec(RegExpObj, {
    kind: "re",
    encode: (target) => ({ s: target.regex.source, f: target.regex.flags, n: target.regex.lastIndex }),
    create: (data, builtins) => {
      const regexp = new RegExpObj(builtins.RegExp, data.s ?? "", data.f ?? "")
      regexp.regex.lastIndex = data.n ?? 0
      return regexp
    },
  }),
  codec(MapObj, {
    kind: "m",
    encode: (target, item, path) => ({
      e: [...target.map].map(
        ([key, entry]) => [item(key, `${path} (Map key)`), item(entry, `${path} (Map value)`)] as const,
      ),
    }),
    create: (_, builtins) => new MapObj(builtins.Map),
    fill: (target, data, restore) => {
      for (const [key, entry] of data.e ?? []) target.map.set(restore(key), restore(entry))
    },
  }),
  codec(SetObj, {
    kind: "st",
    encode: (target, item, path) => ({ a: [...target.set].map((entry) => item(entry, `${path} (Set entry)`)) }),
    create: (_, builtins) => new SetObj(builtins.Set),
    fill: (target, data, restore) => {
      for (const entry of data.a ?? []) target.set.add(restore(entry))
    },
  }),
  codec(URLObj, {
    kind: "url",
    encode: (target) => ({ s: target.url.href }),
    create: (data, builtins) => new URLObj(builtins.URL, builtins.URLSearchParams, new URL(data.s ?? "")),
  }),
  codec(URLSearchParamsObj, {
    kind: "usp",
    encode: (target) => ({ s: target.params.toString() }),
    create: (data, builtins) => new URLSearchParamsObj(builtins.URLSearchParams, new URLSearchParams(data.s ?? "")),
  }),
  codec(HeadersObj, {
    kind: "hd",
    encode: (target) => ({ e: [...target.headers] }),
    create: (data, builtins) =>
      new HeadersObj(builtins.Headers, new Headers((data.e ?? []) as Array<[string, string]>)),
  }),
  codec(Bytes, {
    kind: "b",
    encode: (target) => ({ s: target.bytes.toBase64() }),
    create: (data, builtins) => new Bytes(builtins.Uint8Array, Uint8Array.fromBase64(data.s ?? "")),
  }),
  codec(TextDecoderObj, {
    kind: "td",
    // UTF-8 is the only encoding a program can construct.
    encode: (target) => ({
      n: (target.decoder.fatal ? 1 : 0) | (target.decoder.ignoreBOM ? 2 : 0),
    }),
    create: (data, builtins) =>
      new TextDecoderObj(
        builtins.TextDecoder,
        new TextDecoder("utf-8", { fatal: ((data.n ?? 0) & 1) !== 0, ignoreBOM: ((data.n ?? 0) & 2) !== 0 }),
      ),
  }),
  codec(PromiseObj, {
    kind: "pr",
    encode: (target, item, path) =>
      target.state === "fulfilled" ? { v: item(target.result as Value, `${path} (resolved value)`) } : target.describe,
    create: (_, builtins) => {
      const promise = new PromiseObj(builtins.Promise, 0)
      promise.state = "fulfilled"
      promise.handled = true
      return promise
    },
    fill: (target, data, restore) => {
      target.result = restore(data.v)
    },
  }),
])

const kinds = new Map([...codecs.values()].map((definition) => [definition.kind, definition]))

// --- Restoring ---

/** Rebuilds the top-level scope and every value reachable from it from records read at one commit. */
export const decode = <R>(
  ctx: Interpreter<R>,
  table: Intrinsics,
  records: ReadonlyMap<number, string>,
  root: number,
  nextId: number,
): State => {
  const builtins = ctx.builtins
  const parsed = new Map<number, Data>()
  const data = (id: number): Data => {
    const known = parsed.get(id)
    if (known !== undefined) return known
    const text = records.get(id)
    if (text === undefined) throw new Error(`record ${id} is missing.`)
    const decoded = JSON.parse(text) as Data
    parsed.set(id, decoded)
    return decoded
  }
  const sources = new Sources()
  const ids = new Map<object, number>()
  const made = new Map<number, Obj | Map<string, Binding>>()
  const fills: Array<() => void> = []
  const source = (id: number) => {
    const found = sources.get(id, () => (data(id).k === "src" ? data(id).s : undefined))
    if (found !== undefined) ids.set(found, id)
    return found
  }

  const restore: Restore = (saved) => {
    if (saved === undefined) return undefined
    if (saved === null || typeof saved !== "object") return saved
    if ("u" in saved) return undefined
    if ("n" in saved) return saved.n === "-0" ? -0 : Number(saved.n)
    if ("s" in saved) return saved.s === "asyncIterator" ? AsyncIteratorSymbol : IteratorSymbol
    if ("t" in saved) return new ToolReference([...saved.t])
    if ("i" in saved) {
      return table.objects.get(saved.i) ?? new Lost(builtins.Function, `The built-in \`${saved.i}\` no longer exists.`)
    }
    if ("r" in saved) {
      const target = object(saved.r)
      if (target instanceof Map) throw new Error(`record ${saved.r} is a scope, not a value.`)
      return target
    }
    throw new Error("unknown value encoding.")
  }

  const scope: RestoreScope = (saved) => {
    if (typeof saved === "object" && saved !== null && "g" in saved) return ctx.globalScope
    if (typeof saved !== "object" || saved === null || !("r" in saved)) throw new Error("invalid scope reference.")
    const target = object(saved.r)
    if (!(target instanceof Map)) throw new Error(`record ${saved.r} is not a scope.`)
    return target
  }

  const object = (id: number): Obj | Map<string, Binding> => {
    const known = made.get(id)
    if (known !== undefined) return known
    const record = data(id)
    if (record.k === "s") {
      const target = new Map<string, Binding>()
      remember(id, target)
      fills.push(() => fillScope(target, record))
      return target
    }
    if (record.k === "l") return remember(id, new Lost(builtins.Function, record.m ?? "A value was lost."))
    const definition = kinds.get(record.k)
    const created = definition?.create(record, builtins, source)
    if (definition === undefined || created === undefined) {
      return remember(id, new Lost(builtins.Function, `A saved ${record.k} value could not be restored.`))
    }
    remember(id, created)
    fills.push(() => {
      const proto = record.p === null ? null : restore(record.p)
      if (proto !== null && !(proto instanceof Obj)) throw new Error(`record ${id} has an invalid prototype.`)
      created.proto = proto
      created.props.clear()
      for (const [key, saved, flags] of record.o ?? []) {
        const name = typeof key === "string" ? key : key.s === "asyncIterator" ? AsyncIteratorSymbol : IteratorSymbol
        created.props.set(name, { value: restore(saved), ...attributes(flags ?? 7) })
      }
      if (record.x === 0) created.extensible = false
      definition.fill?.(created, record, restore, scope)
    })
    return created
  }

  const remember = <T extends Obj | Map<string, Binding>>(id: number, target: T): T => {
    made.set(id, target)
    ids.set(target, id)
    return target
  }

  const meta = new Map<string, BindingMeta>()
  const fillScope = (target: Map<string, Binding>, record: Data) => {
    for (const [name, saved, flags, declaration, cell] of record.b ?? []) {
      const value = restore(saved)
      // A lost top-level value throws as soon as its name is read, naming the binding.
      const initialized = (flags & 2) !== 0 && !(value instanceof Lost)
      target.set(name, { mutable: (flags & 1) !== 0, value, initialized })
      if (target === top && declaration !== undefined && cell !== undefined) meta.set(name, { declaration, cell })
    }
  }

  const top = scope({ r: root })
  for (let index = 0; index < fills.length; index++) fills[index]!()
  const stored = new Map<number, string>()
  for (const id of parsed.keys()) stored.set(id, records.get(id)!)
  return { scope: top, meta, ids, stored, sources, nextId }
}

/** Why an object of a kind without a codec cannot be saved, as the lost value's message says it. */
const unsaveable = (target: Obj): string =>
  target instanceof Native
    ? "a function that is neither a global nor defined in a cell (such as a bound function or a host result)"
    : target.describe

// --- Inventory ---

const kindOf = (value: Value): string => {
  if (value === null) return "null"
  if (value instanceof ToolReference) return "tool"
  if (value instanceof Lost) return "lost"
  if (value instanceof Callable) return "function"
  if (value instanceof Arr) return "array"
  if (value instanceof Obj) return value.tag === "Object" ? "object" : value.tag
  return typeof value
}

const PREVIEW = 100

const preview = (table: Intrinsics, binding: Binding): string => {
  const text =
    binding.initialized === false && !(binding.value instanceof Lost)
      ? "<uninitialized>"
      : show(table, binding.value, true)
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW - 3)}...` : text
}

// Reads only own data properties, so a preview never runs a getter or touches a lost prototype.
const ownValue = (target: Obj, key: string): Value => {
  const slot = target.props.get(key)
  return slot !== undefined && "value" in slot ? slot.value : undefined
}

const show = (table: Intrinsics, value: Value, top: boolean): string => {
  if (typeof value === "string") return JSON.stringify(value.length > PREVIEW ? `${value.slice(0, PREVIEW)}...` : value)
  if (typeof value === "symbol") return value === IteratorSymbol ? "Symbol.iterator" : "Symbol.asyncIterator"
  if (value instanceof ToolReference) return ["tools", ...value.path].join(".")
  if (!(value instanceof Obj)) return String(value)
  if (value instanceof Lost) return "<lost>"
  const name = table.names.get(value)
  if (name !== undefined) return `[built-in ${name}]`
  if (value instanceof Fn) {
    const parameters = value.parameters.map((parameter) => (parameter.type === "Identifier" ? parameter.name : "..."))
    if (value.arrow) return `${value.async ? "async " : ""}(${parameters.join(", ")}) => ...`
    const named = ownValue(value, "name")
    return `${value.async ? "async " : ""}function${value.generator ? "*" : ""} ${typeof named === "string" ? named : ""}(${parameters.join(", ")})`
  }
  if (value instanceof Callable) return "[host function]"
  if (value instanceof Arr) {
    if (!top) return `Array(${value.items.length})`
    const shown = value.items.slice(0, 5).map((item) => show(table, item, false))
    return `[${shown.join(", ")}${value.items.length > 5 ? `, ... ${value.items.length - 5} more` : ""}]`
  }
  if (value instanceof MapObj) return `Map(${value.map.size})`
  if (value instanceof SetObj) return `Set(${value.set.size})`
  if (value instanceof Bytes) return `Uint8Array(${value.bytes.length})`
  if (value instanceof DateObj || value instanceof RegExpObj || value instanceof URLObj) return value.toString()
  if (value instanceof ErrorObj) {
    const message = ownValue(value, "message")
    return typeof message === "string" ? `Error: ${message}` : "Error"
  }
  if (value.constructor !== Obj) return `[${value.tag}]`
  if (!top) return "{...}"
  const names = keys(value)
  const shown = names.slice(0, 6).map((key) => `${key}: ${show(table, ownValue(value, key), false)}`)
  return `{ ${shown.join(", ")}${names.length > 6 ? `, ... ${names.length - 6} more` : ""} }`
}
