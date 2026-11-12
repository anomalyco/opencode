import type { Builtins } from "./intrinsics.js"
import { AsyncIteratorSymbol, IteratorSymbol } from "./model.js"
import { Arr, Fn, Native, Obj, type Value } from "./objects.js"

/**
 * Deterministic names for one runtime's intrinsic objects, so saved state can refer to a built-in by name instead of
 * copying it, and whether each one changed since the runtime was made.
 *
 * - **Static ids.** Every object made with the intrinsics (`createBuiltins`, the globals, the prelude) has an id: its
 *   creation index, which is the same in every runtime because making them is deterministic (see `makingIntrinsics`).
 *   The ids are named once per process, by a breadth-first walk of the first runtime made, before any program runs:
 *   from the global names (`Array.prototype.map`), then `%Name%` for built-in prototypes the walk cannot reach
 *   (`%Generator%`) and the prelude's internals, and what is reachable from them. The first path found names a value.
 *   No later runtime walks anything.
 * - **`@host` names.** The host's globals (extensions, a test harness) differ between runtimes, so each runtime names
 *   them itself, `@name`, by a walk over only the objects they reach that have no static id. Host lists are small.
 * - **Dirty bits.** `Obj.intrinsic` is the id plus one while the object is as made, negated once it changes. Every
 *   write to an object's properties, prototype, extensibility or elements marks it (`changed` in objects.ts), and so
 *   does restoring it from a saved record, so a run suspended twice keeps what changed before the first suspend.
 */
export class IntrinsicNames {
  private readonly hostValues: Array<Obj> = []
  private readonly hostNames: Array<string> = []
  private readonly hostIndex = new Map<Obj, number>()
  private named: Array<Obj> | undefined

  constructor(
    /** The objects made with the intrinsics, by id. */
    private readonly made: ReadonlyArray<Obj>,
    roots: Roots,
    hosts: ReadonlyArray<readonly [string, Value]> = [],
  ) {
    made.forEach((value, id) => {
      value.intrinsic = id + 1
    })
    table ??= walk(made, roots)
    if (made.length !== table.count) {
      throw new Error(`This runtime made ${made.length} intrinsics, and the first one made ${table.count}.`)
    }
    const visit = (value: Value, name: () => string) => {
      if (!(value instanceof Obj) || this.hostIndex.has(value) || this.isStatic(value)) return
      this.hostIndex.set(value, this.hostValues.length)
      this.hostValues.push(value)
      this.hostNames.push(name())
      value.intrinsic = table!.count + this.hostValues.length
    }
    let next = 0
    for (const [name, value] of hosts) {
      visit(value, () => `@${name}`)
      for (; next < this.hostValues.length; next++) {
        const item = this.hostValues[next]!
        const base = this.hostNames[next]!
        for (const [key, slot] of item.props) if ("value" in slot) visit(slot.value, () => member(base, key))
        if (item.proto !== null) visit(item.proto, () => member(base, prototypeKey))
      }
    }
  }

  /** The named intrinsics, in name order (see `all`). */
  get values(): ReadonlyArray<Obj> {
    return (this.named ??= [...table!.order.map((id) => this.made[id]!), ...this.hostValues])
  }

  /** The name of an intrinsic, or undefined for any other object. */
  nameOf(value: Obj): string | undefined {
    if (this.isStatic(value)) {
      const at = table!.position[Math.abs(value.intrinsic) - 1]!
      return at < 0 ? undefined : table!.names[at]
    }
    const host = this.hostIndex.get(value)
    return host === undefined ? undefined : this.hostNames[host]
  }

  /** The intrinsic a name refers to. */
  valueOf(name: string): Obj | undefined {
    const id = staticIds().get(name)
    if (id !== undefined) return this.made[id]
    const host = this.hostNames.indexOf(name)
    return host < 0 ? undefined : this.hostValues[host]
  }

  /** Every name: the static ones in walk order, then the host globals'. */
  all(): ReadonlyArray<string> {
    return [...table!.names, ...this.hostNames]
  }

  /** The host globals' names, `@name`, in walk order. */
  hosts(): ReadonlyArray<string> {
    return this.hostNames
  }

  /**
   * The named intrinsics a saved state has to record: those changed since the runtime was made, and host values of
   * classes whose state is not their properties (an extension's Map), which count as changed.
   */
  changed(): Array<Obj> {
    return this.values.filter((value) => !unchanged(value))
  }

  private isStatic(value: Obj): boolean {
    const id = Math.abs(value.intrinsic) - 1
    return id >= 0 && id < this.made.length && this.made[id] === value
  }
}

/** Whether a named object is still as the runtime made it, so its name alone restores it. */
export const unchanged = (value: Obj): boolean => {
  if (value.intrinsic <= 0) return false
  const ctor = value.constructor
  return ctor === Obj || ctor === Arr || ctor === Native || ctor === Fn
}

/** The static names, in walk order, once a runtime has been made in this process. */
export const staticNames = (): ReadonlyArray<string> => {
  if (table === undefined) throw new Error("No runtime has been made yet, so the intrinsics have no names.")
  return table.names
}

/** Where the walk that names the static intrinsics starts. */
export type Roots = {
  readonly globals: ReadonlyArray<readonly [string, Value]>
  readonly builtins: Builtins
  /** Internal objects no global reaches (the prelude's functions and helpers), named like the builtins. */
  readonly internals: ReadonlyArray<readonly [string, Obj]>
}

type Table = {
  readonly count: number
  /** Static ids in walk order, and their names. */
  readonly order: ReadonlyArray<number>
  readonly names: ReadonlyArray<string>
  /** By id: the position in `order`, or -1 for an object the walk does not reach. */
  readonly position: ReadonlyArray<number>
}

let table: Table | undefined
let ids: Map<string, number> | undefined

const staticIds = () => (ids ??= new Map(table!.names.map((name, at) => [name, table!.order[at]!])))

const walk = (made: ReadonlyArray<Obj>, roots: Roots): Table => {
  const order: Array<number> = []
  const paths: Array<string | readonly [parent: number, key: string | symbol]> = []
  const position = made.map(() => -1)
  const visit = (value: Value, path: string | readonly [number, string | symbol]) => {
    if (!(value instanceof Obj)) return
    const id = value.intrinsic - 1
    if (id < 0 || made[id] !== value) {
      throw new Error(`The intrinsic at ${describe(path)} was not made with this runtime's intrinsics.`)
    }
    if (position[id] !== -1) return
    position[id] = order.length
    order.push(id)
    paths.push(path)
  }
  const describe = (path: string | readonly [number, string | symbol]): string =>
    typeof path === "string" ? path : member(describe(paths[path[0]]!), path[1])
  let next = 0
  const drain = () => {
    for (; next < order.length; next++) {
      const item = made[order[next]!]!
      for (const [key, slot] of item.props) if ("value" in slot) visit(slot.value, [next, key])
      if (item.proto !== null) visit(item.proto, [next, prototypeKey])
    }
  }
  for (const [name, value] of roots.globals) visit(value, name)
  drain()
  for (const [name, value] of [...Object.entries(roots.builtins), ...roots.internals]) {
    visit(value, `%${name}%`)
    drain()
  }
  const names: Array<string> = []
  for (const path of paths) names.push(typeof path === "string" ? path : member(names[path[0]]!, path[1]))
  return { count: made.length, order, names, position }
}

const prototypeKey: unique symbol = Symbol("[[Prototype]]")

const symbolNames = new Map<symbol, string>([
  [IteratorSymbol, "[Symbol.iterator]"],
  [AsyncIteratorSymbol, "[Symbol.asyncIterator]"],
  [prototypeKey, ".[[Prototype]]"],
])

const member = (base: string, key: string | symbol): string => {
  if (typeof key === "symbol") return `${base}${symbolNames.get(key) ?? `[${String(key)}]`}`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`
}
