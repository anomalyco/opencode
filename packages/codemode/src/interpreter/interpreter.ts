import type { TaggedTemplateExpression } from "acorn"
import { fromJson, type Json, toBoundary } from "../data.js"
import type { ToolRuntime } from "../tool-runtime.js"
import { Machine } from "../machine/machine.js"
import { Bridge } from "./bridge.js"
import { globals } from "./globals.js"
import type { Builtins } from "./intrinsics.js"
import { IntrinsicNames } from "./intrinsic-names.js"
import { type AstNode, type Binding, PendingThrow } from "./model.js"
import { moduleName, resolveModule } from "./modules.js"
import { type Arr, define, entries, nativeRule, Obj, type Value } from "./objects.js"
import { promiseLike } from "./promises.js"
import { ScopeStack } from "./scope.js"
import { AsyncBoundary, Call, type Eval, Host } from "./signals.js"
import type { NodeId, Source } from "./source.js"

/** One program execution: the tool bridge, the machine that runs it, captured logs, and the global scope built once. */
export class Interpreter<R> {
  readonly tools: ToolRuntime<R>
  readonly builtins: Builtins
  readonly logs: Array<string>
  /** Runs program code, and keeps the job queue, promises, and host calls the program waits on. */
  readonly machine: Machine
  /** Names for this runtime's intrinsics, taken before any program code can change a built-in. */
  readonly intrinsics: IntrinsicNames
  /** Template objects by site: a tag sees the same `strings` array every time its literal is evaluated, as in JS. */
  readonly templates = new WeakMap<TaggedTemplateExpression, Arr>()
  /** The parsed sources this execution runs, by id, so a `NodeId` resolves to its node. */
  readonly sources = new Map<string, Source>()
  private readonly bridge: Bridge<R>
  private readonly globalScope: Map<string, Binding>
  private readonly modules = new Map<string, Value>()
  private readonly namespaces = new Map<string, Obj>()

  constructor(options: {
    readonly tools: ToolRuntime<R>
    readonly builtins: Builtins
    readonly logs?: Array<string>
    readonly globals?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>
  }) {
    this.tools = options.tools
    this.builtins = options.builtins
    this.logs = options.logs ?? []
    // The machine never runs host work itself, so it does not need the services that work runs with.
    this.machine = new Machine(this as Interpreter<unknown>)
    this.bridge = new Bridge(this)
    // Program code has no receiver: top-level `this` is undefined, as in a module.
    this.globalScope = new Map<string, Binding>([["this", { mutable: false, value: undefined }]])
    const intrinsics = globals(this)
    this.intrinsics = new IntrinsicNames(intrinsics, this.builtins)
    for (const [name, value] of [...intrinsics, ...(options.globals?.(this) ?? [])]) {
      this.globalScope.set(name, { mutable: false, value })
    }
    nativeRule.sealed.add(this.builtins.Function)
  }

  /** A module, as `require` returns it and a default import binds it: a global, by its Node module name. */
  module(specifier: string, site?: AstNode): Value {
    const name = moduleName(specifier)
    const cached = this.modules.get(name)
    if (cached !== undefined) return cached
    const module = resolveModule(name, (global) => {
      const binding = this.globalScope.get(global)
      return binding && "value" in binding ? binding.value : undefined
    })
    if (module === undefined)
      throw new PendingThrow(
        "Error",
        `Cannot import "${specifier}": it isn't available in Code Mode, which can't load packages or files. Use the provided globals, or call tools through \`tools\`.`,
        site,
      )
    this.modules.set(name, module)
    return module
  }

  /**
   * What `import * as` and `import()` see: the module's own properties, and the module itself as `default`, the way
   * Node presents a CommonJS module.
   */
  namespace(specifier: string, site?: AstNode): Obj {
    const module = this.module(specifier, site)
    const name = moduleName(specifier)
    const cached = this.namespaces.get(name)
    if (cached) return cached
    const namespace = new Obj(null)
    if (module instanceof Obj) for (const [key, value] of entries(module)) define(namespace, key, value)
    define(namespace, "default", module)
    this.namespaces.set(name, namespace)
    return namespace
  }

  /** Queues the program's body as the first job; its completion value is copied out for the host. */
  start(source: Source): void {
    this.sources.set(source.id, source)
    this.machine.start(source)
  }

  /** A new chain over the global scope, where the program's own scope is pushed. */
  programScopes(): ScopeStack {
    return new ScopeStack([this.globalScope])
  }

  // The call returns its promise at once. Arguments cross on the caller's stack, since `toJSON` is program code, and a
  // promise argument is awaited first; the host call is queued once they have crossed, and the driver starts it, so
  // admission and hooks happen before any other job runs, and it runs concurrently with the program.
  *toolCall(path: ReadonlyArray<string>, args: Array<Value>, site: AstNode | undefined): Eval<Value> {
    const ctx = this
    const machine = ctx.machine
    const resolving = machine.resolving(machine.newPromise())
    const body = function* (): Eval<void> {
      const json: Array<Json | undefined> = []
      for (const arg of args) json.push(yield* toBoundary(ctx, arg))
      machine.host({ kind: "tool", path, args: json }, { label: path.join("."), result: "json", resolving, site })
    }
    return (yield new Call(body(), new AsyncBoundary(resolving))) as Value
  }

  /** The node a `NodeId` names, in one of this execution's sources. */
  node(id: NodeId): AstNode | undefined {
    return this.sources.get(id.source)?.node(id)
  }

  /** Calls into the program; a built-in passes its own call site so failures inside are located there. */
  call(callable: Value, thisValue: Value, args: Array<Value>, site?: AstNode): Eval<Value> {
    return this.bridge.call(callable, thisValue, args, site)
  }

  /** Await: suspends the innermost async body until `value` settles. */
  awaitValue(value: Value, node?: AstNode): Eval<Value> {
    return this.bridge.awaitValue(value, node)
  }

  iterate(value: Value) {
    return this.bridge.iterate(value)
  }

  iterateDirect(value: Value) {
    return this.bridge.iterateDirect(value)
  }

  /** The built-in search: its result is usable directly, and can also be awaited or chained like a Promise. */
  *search(args: Array<Value>) {
    const json: Array<Json | undefined> = []
    for (const arg of args) json.push(yield* toBoundary(this, arg))
    return promiseLike(this, fromJson(this, (yield new Host({ kind: "search", args: json })) as Json | undefined))
  }
}
