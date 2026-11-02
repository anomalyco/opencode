export * as Extension from "./extension.js"

import type { Effect } from "effect"

/**
 * Host functions a program calls directly as globals, and host values it loads as modules. Values crossing in
 * either direction are converted, never shared: arguments come in as copies, results go out as copies, and a function
 * inside a result is callable the same way. Extension calls are not tool calls. A global may return a value, a
 * Promise, or an Effect, and an Effect's requirements join the runtime's environment.
 *
 * A global is synchronous unless it is an `async` function or is marked with `async`. The `extension.before` hook
 * runs before the call, so a denied call never reaches the host; it fails the way the global would, by rejecting the
 * promise of an asynchronous global and by throwing from a synchronous one.
 *
 * A module is any value a program loads with `import`, `require`, or `import()` by its name; `node:fs` names the same
 * module as `fs`. Every function reachable from a module is called like a global, hooks included.
 */
export type Extension<
  Globals extends Readonly<Record<string, Function>> = Readonly<Record<string, Function>>,
  Modules extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> = {
  readonly name: string
  readonly globals: Globals
  readonly modules: Modules
}

/** The Effect environment required by an extension's Effect-returning globals and module functions. */
export type Services<E> =
  | (E extends { readonly globals: infer Globals } ? Requirements<Globals[keyof Globals]> : never)
  | (E extends { readonly modules: infer Modules } ? ModuleServices<Modules[keyof Modules]> : never)

// A module's requirements come from the module itself and its own functions; deeper functions are not inferred.
type ModuleServices<Module> = Module extends object ? Requirements<Module> | Requirements<Module[keyof Module]> : never

type Requirements<F> = F extends (...args: never) => infer Result ? Effect.Services<Result> : never

export const make = <
  const Globals extends Readonly<Record<string, Function>> = {},
  const Modules extends Readonly<Record<string, unknown>> = {},
>(options: {
  readonly name: string
  readonly globals?: Globals
  readonly modules?: Modules
}): Extension<Globals, Modules> => {
  for (const [name, value] of Object.entries(options.globals ?? {})) {
    if (typeof value !== "function") {
      throw new TypeError(`Extension "${options.name}" global "${name}" must be a function.`)
    }
  }
  return {
    name: options.name,
    globals: { ...options.globals } as Globals,
    modules: { ...options.modules } as Modules,
  }
}

const asyncGlobals = new WeakSet<Function>()
const AsyncFunction = (async () => {}).constructor

/** Marks a global that returns a Promise or an Effect, so a denied call rejects its promise instead of throwing. */
export const async = <F extends Function>(global: F): F => {
  asyncGlobals.add(global)
  return global
}

export const isAsync = (global: Function) => global instanceof AsyncFunction || asyncGlobals.has(global)
