import type { Interpreter } from "../runtime/interpreter.js"
import { define, Fn, get, hidden, Obj, type Value } from "../runtime/objects.js"
import { builtinCodes } from "./bytecode.js"
import { helpers } from "./helpers.js"
import { code } from "./source.js"

// The prelude: built-ins that call program code, written in Code Mode itself and compiled to bytecode ahead of time
// (see bytecode.ts). Each runtime makes its top-level functions as `Fn`s; their free names are the intrinsic globals, the `$`
// helpers, and the prelude's own functions (`GET_INTRINSIC`), so programs can't reach the helpers, and replacing a
// global can't change what a built-in does. A function named `Array$prototype$map` is installed as
// `Array.prototype.map`; one without a `$` is internal, and a generator makes iterator helpers. Snapshots name prelude
// functions as intrinsics and never copy them; the prelude's bytecode hash is part of the build id. Natives reach a
// prelude function with `fn` and hand their work on to it (`new Invoke(...)`).

let compiled: ReturnType<typeof builtinCodes> | undefined

/**
 * The prelude's bytecode, and its top-level functions' code by name. It is parsed without locations: a failure raised
 * inside it has none, so it is located at the program's call instead (see `locate`).
 */
export const compiledPrelude = () => (compiled ??= builtinCodes("@prelude", code))

/** One runtime's prelude: what its functions' free names see, and its functions and helpers, by name. */
export class Prelude {
  readonly scope = new Map<string, Value>()
  /** Every prelude function (installed or internal), as an object the intrinsic names reach. */
  readonly functions: Obj
  /** The `$` helpers, as an object the intrinsic names reach. */
  readonly helpers: Obj

  constructor(ctx: Interpreter<unknown>, globals: ReadonlyArray<readonly [string, Value]>) {
    const builtins = ctx.builtins
    this.functions = new Obj(null)
    this.helpers = new Obj(null)
    for (const [name, value] of globals) this.scope.set(name, value)
    for (const [name, value] of helpers(ctx)) {
      define(this.helpers, name, value, hidden)
      this.scope.set(name, value)
    }
    for (const [name, made] of compiledPrelude().byName) {
      const path = name.split("$")
      const fn = new Fn(builtins.Function, made, [], path.at(-1))
      // The prelude's generators are iterator helpers.
      if (fn.generator) define(fn, "prototype", builtins.IteratorHelper, hidden)
      this.scope.set(name, fn)
      define(this.functions, name, fn, hidden)
      if (path.length === 1) continue
      const owner = path.slice(1, -1).reduce((value, key) => get(value as Obj, key), this.scope.get(path[0]!))
      define(owner as Obj, path.at(-1)!, fn, hidden)
    }
  }

  /** A prelude function, for a native that hands its work on to it. */
  fn(name: string): Fn {
    return get(this.functions, name) as Fn
  }
}
