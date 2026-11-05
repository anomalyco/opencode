import { type FunctionDeclaration, parse } from "acorn"
import type { Interpreter } from "../interpreter/interpreter.js"
import type { Binding } from "../interpreter/model.js"
import { createFunction } from "../interpreter/operations.js"
import { define, type Fn, get, hidden, Obj, type Value } from "../interpreter/objects.js"
import { ScopeStack } from "../interpreter/scope.js"
import { Source } from "../interpreter/source.js"
import { helpers } from "./helpers.js"
import { code } from "./source.js"

// The prelude: built-ins that call program code, written in Code Mode itself and run as ordinary program frames. Its
// source is parsed once per process. Each runtime makes its top-level functions as `Fn`s over a private scope (the
// intrinsic globals, the `$` helpers, and the prelude's own functions), so programs can't reach the helpers, and
// replacing a global can't change what a built-in does. A function named `Array$prototype$map` is installed as
// `Array.prototype.map`; one without a `$` is internal. Snapshots name prelude nodes by id in the "prelude" source and
// never copy it; its hash is part of the build id.

let parsed: Source | undefined

/**
 * The prelude's parsed source. It is parsed without locations: a failure raised inside it has none, so it is located
 * at the program's call instead (see `locate`).
 */
export const preludeSource = (): Source =>
  (parsed ??= new Source("prelude", code, parse(code, { ecmaVersion: "latest", sourceType: "script" })))

/** One runtime's prelude: the scope its functions close over, and its functions and helpers, by name. */
export class Prelude {
  readonly scope = new Map<string, Binding>()
  /** Every prelude function (installed or internal), as an object the intrinsic names reach. */
  readonly functions: Obj
  /** The `$` helpers, as an object the intrinsic names reach. */
  readonly helpers: Obj

  constructor(ctx: Interpreter<unknown>, globals: ReadonlyArray<readonly [string, Value]>) {
    const builtins = ctx.builtins
    this.functions = new Obj(null)
    this.helpers = new Obj(null)
    const bind = (name: string, value: Value) => this.scope.set(name, { mutable: false, value, initialized: true })
    for (const [name, value] of globals) bind(name, value)
    for (const [name, value] of helpers(ctx)) {
      define(this.helpers, name, value, hidden)
      bind(name, value)
    }
    const scopes = new ScopeStack([this.scope])
    const program = preludeSource().program
    for (const node of program.body as Array<FunctionDeclaration>) {
      const path = node.id.name.split("$")
      const made = createFunction(builtins, scopes, node, path.at(-1))
      bind(node.id.name, made)
      define(this.functions, node.id.name, made, hidden)
      if (path.length === 1) continue
      const target = path
        .slice(1, -1)
        .reduce<Value>((owner, key) => get(owner as Obj, key), this.scope.get(path[0]!)?.value ?? builtins[path[0] as never])
      define(target as Obj, path.at(-1)!, made, hidden)
    }
  }

  /** A prelude function, for a native that hands its work on (`new Invoke(...)`). */
  fn(name: string): Fn {
    return get(this.functions, name) as Fn
  }
}
