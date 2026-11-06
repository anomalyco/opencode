import type { ToolRuntime } from "../../tool-runtime.js"
import type { ExtensionRequest } from "../scheduler.js"
import type { HostBridge } from "../snapshot/codec.js"
import { Vm } from "../vm.js"
import { globals } from "./globals.js"
import type { Builtins } from "./intrinsics.js"
import { IntrinsicNames } from "./intrinsic-names.js"
import { type AstNode, type Binding, PendingThrow } from "./model.js"
import { moduleName, resolveModule } from "./modules.js"
import { define, entries, makingIntrinsics, nativeRule, Obj, type Value } from "./objects.js"
import { Prelude } from "../prelude/prelude.js"
import { Push } from "./signals.js"
import type { NodeId, Source } from "./source.js"

/** One program execution: the tool bridge, the VM that runs it, captured logs, and the global scope built once. */
export class Interpreter<R> {
  readonly tools: ToolRuntime<R>
  readonly builtins: Builtins
  readonly logs: Array<string>
  /** Runs program code, and keeps the job queue, promises, and host calls the program waits on. */
  readonly vm: Vm
  /** Names for this runtime's intrinsics, taken before any program code can change a built-in. */
  readonly intrinsics: IntrinsicNames
  /** The built-ins written in Code Mode, and the scope they close over. */
  readonly prelude: Prelude
  /** Makes the Effect an extension function's host work runs as; set by the extension bridge. */
  extensionWork: ((request: ExtensionRequest) => unknown) | undefined
  /** Saves and restores the functions inside values extensions returned; set by the extension bridge. */
  hosts: HostBridge | undefined
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
    this.tools = options.tools
    this.builtins = options.builtins
    this.logs = options.logs ?? []
    // Program code has no receiver: top-level `this` is undefined, as in a module.
    this.globalScope = new Map<string, Binding>([["this", { value: undefined }]])
    // Everything made from here to the host globals is an intrinsic, with a static id (see `IntrinsicNames`).
    const [[intrinsics, prelude], made] = makingIntrinsics(Object.values(this.builtins), () => {
      const intrinsics = globals(this)
      return [intrinsics, new Prelude(this as Interpreter<unknown>, intrinsics)] as const
    })
    this.prelude = prelude
    const hosts = options.globals?.(this) ?? []
    this.intrinsics = new IntrinsicNames(
      made,
      {
        globals: intrinsics,
        builtins: this.builtins,
        internals: [
          ["Prelude", this.prelude.functions],
          ["PreludeHelpers", this.prelude.helpers],
        ],
      },
      hosts,
    )
    for (const [name, value] of [...intrinsics, ...(options.bindings?.(this) ?? []), ...hosts]) {
      this.globalScope.set(name, { value })
    }
    nativeRule.sealed.add(this.builtins.Function)
    // The VM never runs host work itself, so it does not need the services that work runs with.
    this.vm = new Vm(this as Interpreter<unknown>)
  }

  /** A module, as `require` returns it and a default import binds it: a global, by its Node module name. */
  module(specifier: string, site?: AstNode): Value {
    const name = moduleName(specifier)
    const cached = this.modules.get(name)
    if (cached !== undefined) return cached
    const module = resolveModule(name, (global) => this.globalScope.get(global)?.value)
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

  /** The node a `NodeId` names, in one of this execution's sources. */
  node(id: NodeId): AstNode | undefined {
    return this.sources.get(id.source)?.node(id)
  }

  /** The built-in search: its result is usable directly, and can also be awaited or chained like a Promise. */
  search(args: Array<Value>): Push {
    return new Push("search", [args])
  }
}
