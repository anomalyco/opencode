export * as Extension from "./extension.js"

import type { Effect } from "effect"

/**
 * Host functions a program calls directly as globals. Values crossing in either direction are converted, never
 * shared: arguments come in as copies, results go out as copies, and a function inside a result is callable the
 * same way. Extension calls are not tool calls. A global may return a value, a Promise, or an Effect, and an
 * Effect's requirements join the runtime's environment.
 *
 * A global is synchronous unless it is an `async` function or is marked with `async`. The `extension.before` hook
 * runs before the call, so a denied call never reaches the host; it fails the way the global would, by rejecting the
 * promise of an asynchronous global and by throwing from a synchronous one.
 */
export type Extension<Globals extends Readonly<Record<string, Function>> = Readonly<Record<string, Function>>> = {
  readonly name: string
  readonly globals: Globals
}

/** The Effect environment required by an extension's Effect-returning globals. */
export type Services<E> = E extends { readonly globals: infer Globals }
  ? Globals[keyof Globals] extends infer Global
    ? Global extends (...args: never) => infer Result
      ? Effect.Services<Result>
      : never
    : never
  : never

export const make = <const Globals extends Readonly<Record<string, Function>>>(
  options: Extension<Globals>,
): Extension<Globals> => {
  for (const [name, value] of Object.entries(options.globals)) {
    if (typeof value !== "function") {
      throw new TypeError(`Extension "${options.name}" global "${name}" must be a function.`)
    }
  }
  return { name: options.name, globals: { ...options.globals } }
}

const asyncGlobals = new WeakSet<Function>()
const AsyncFunction = (async () => {}).constructor

/** Marks a global that returns a Promise or an Effect, so a denied call rejects its promise instead of throwing. */
export const async = <F extends Function>(global: F): F => {
  asyncGlobals.add(global)
  return global
}

export const isAsync = (global: Function) => global instanceof AsyncFunction || asyncGlobals.has(global)
