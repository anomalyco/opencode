import type { TaggedTemplateExpression } from "acorn"
import { nativeKind } from "../machine/native-kind.js"
import { BoundaryWalk, fromJson, type Json, walk } from "../data.js"
import type { ToolRuntime } from "../tool-runtime.js"
import type { ExtensionRequest } from "../machine/scheduler.js"
import { requireSealedKinds } from "../machine/frame.js"
import { Machine } from "../machine/machine.js"
import { globals } from "./globals.js"
import type { Builtins } from "./intrinsics.js"
import { IntrinsicNames } from "./intrinsic-names.js"
import { type AstNode, type Binding, PendingThrow } from "./model.js"
import { moduleName, resolveModule } from "./modules.js"
import { type Arr, define, entries, nativeRule, Obj, type Value } from "./objects.js"
import { promiseLike } from "./promises.js"
import { Prelude, preludeSource } from "../prelude/prelude.js"
import { ScopeStack } from "./scope.js"
import { Host, Push } from "./signals.js"
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
  /** The built-ins written in Code Mode, and the scope they close over. */
  readonly prelude: Prelude
  /** Template objects by site: a tag sees the same `strings` array every time its literal is evaluated, as in JS. */
  readonly templates = new Map<TaggedTemplateExpression, Arr>()
  /** Makes the Effect an extension function's host work runs as; set by the extension bridge. */
  extensionWork: ((request: ExtensionRequest) => unknown) | undefined
  /** The parsed sources this execution runs, by id, so a `NodeId` resolves to its node. */
  readonly sources = new Map<string, Source>()
  /** The global bindings: the intrinsics, the host's globals, and the program's bindings. */
  readonly globalScope: Map<string, Binding>
  private readonly modules = new Map<string, Value>()
  private readonly namespaces = new Map<string, Obj>()

  constructor(options: {
    readonly tools: ToolRuntime<R>
    readonly builtins: Builtins
    readonly logs?: Array<string>
    /** The host's globals (extensions, a test harness): made again, the same way, when a saved run is restored. */
    readonly globals?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>
    /** Data bound for this program, part of its saved state; host globals of the same name win. */
    readonly bindings?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>
  }) {
    requireSealedKinds()
    this.tools = options.tools
    this.builtins = options.builtins
    this.logs = options.logs ?? []
    // The machine never runs host work itself, so it does not need the services that work runs with.
    this.machine = new Machine(this as Interpreter<unknown>)
    // Program code has no receiver: top-level `this` is undefined, as in a module.
    this.globalScope = new Map<string, Binding>([["this", { mutable: false, value: undefined }]])
    const intrinsics = globals(this)
    this.prelude = new Prelude(this as Interpreter<unknown>, intrinsics)
    this.sources.set("prelude", preludeSource())
    const hosts = options.globals?.(this) ?? []
    this.intrinsics = new IntrinsicNames(intrinsics, this.builtins, hosts, [
      ["Prelude", this.prelude.functions],
      ["PreludeHelpers", this.prelude.helpers],
    ])
    for (const [name, value] of [...intrinsics, ...(options.bindings?.(this) ?? []), ...hosts]) {
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

  /** The node a `NodeId` names, in one of this execution's sources. */
  node(id: NodeId): AstNode | undefined {
    return this.sources.get(id.source)?.node(id)
  }

  /** The built-in search: its result is usable directly, and can also be awaited or chained like a Promise. */
  search(args: Array<Value>): Push {
    return new Push(Search, [args, 0, []])
  }
}

// Slots: the arguments, the next one to cross, and those crossed so far. A promise argument is awaited first.
const Search = nativeKind("search", (task, frame, input) => {
  const slots = frame.slots
  const args = slots[0] as Array<Value>
  const json = slots[2] as Array<Json | undefined>
  if (frame.phase === 2) return promiseLike(task.ctx, fromJson(task.ctx, input as Json | undefined))
  if (frame.phase === 1) {
    json.push(input as Json | undefined)
    slots[1] = (slots[1] as number) + 1
  }
  const index = slots[1] as number
  frame.phase = 1
  if (index < args.length) return task.push(BoundaryWalk, frame.node, walk(task.ctx.builtins, args[index], true))
  frame.phase = 2
  return task.request(new Host({ kind: "search", args: json }), frame.node)
})
