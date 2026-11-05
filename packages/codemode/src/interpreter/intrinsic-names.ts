import type { Builtins } from "./intrinsics.js"
import { AsyncIteratorSymbol, IteratorSymbol } from "./model.js"
import { Obj, type Value } from "./objects.js"

/**
 * Deterministic names for one runtime's intrinsic objects, so saved state can refer to a built-in by name instead of
 * copying it: a breadth-first walk from the global names (`Array.prototype.map`), then `%Name%` for built-in
 * prototypes the walk cannot reach (`%Generator%`) and what is reachable from them, then `@name` for the host's globals
 * (extensions, a test harness) and what only they reach. The first path found names a value.
 *
 * The walk runs when the runtime is created, before any program can change a built-in; the names themselves are
 * spelled out only when asked for.
 */
export class IntrinsicNames {
  /** The intrinsics in walk order. */
  readonly values: Array<Obj> = []
  private readonly index = new Map<Obj, number>()
  // How each value was reached: a root name, or its parent's index and the property key.
  private readonly paths: Array<string | readonly [parent: number, key: string | symbol]> = []
  private names: Array<string> | undefined
  private lookup: Map<string, Obj> | undefined

  constructor(
    globals: ReadonlyArray<readonly [string, Value]>,
    builtins: Builtins,
    hosts: ReadonlyArray<readonly [string, Value]> = [],
    /** Internal objects no global reaches (the prelude's functions and helpers), named like the builtins. */
    internals: ReadonlyArray<readonly [string, Obj]> = [],
  ) {
    let next = 0
    const visit = (value: Value, path: string | readonly [number, string | symbol]) => {
      if (!(value instanceof Obj) || this.index.has(value)) return
      this.index.set(value, this.values.length)
      this.values.push(value)
      this.paths.push(path)
    }
    const drain = () => {
      for (; next < this.values.length; next++) {
        const item = this.values[next]!
        for (const [key, slot] of item.props) if ("value" in slot) visit(slot.value, [next, key])
        if (item.proto !== null) visit(item.proto, [next, prototypeKey])
      }
    }
    for (const [name, value] of globals) visit(value, name)
    drain()
    for (const [name, value] of [...Object.entries(builtins), ...internals]) {
      visit(value, `%${name}%`)
      drain()
    }
    for (const [name, value] of hosts) {
      visit(value, `@${name}`)
      drain()
    }
  }

  /** The name of an intrinsic, or undefined for any other object. */
  nameOf(value: Obj): string | undefined {
    const at = this.index.get(value)
    return at === undefined ? undefined : this.all()[at]
  }

  /** The intrinsic a name refers to. */
  valueOf(name: string): Obj | undefined {
    this.lookup ??= new Map(this.all().map((name, index) => [name, this.values[index]!]))
    return this.lookup.get(name)
  }

  /** Every name, in walk order. */
  all(): ReadonlyArray<string> {
    if (this.names !== undefined) return this.names
    const names: Array<string> = []
    for (const path of this.paths) names.push(typeof path === "string" ? path : member(names[path[0]]!, path[1]))
    this.names = names
    return names
  }
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
