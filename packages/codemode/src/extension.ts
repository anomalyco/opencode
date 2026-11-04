export * as Extension from "./extension.js"

import type { Effect } from "effect"

/**
 * Host values a program reaches directly as globals: functions, or objects of functions such as `fs`. Values crossing
 * in either direction are converted, never shared: arguments come in as copies, results go out as copies, and a
 * function inside a result is callable the same way. Extension calls are not tool calls. A global may return a value,
 * a Promise, or an Effect, and an Effect's requirements join the runtime's environment.
 *
 * A global is synchronous unless it is an `async` function or is marked with `async`. The `extension.before` hook
 * runs before the call, so a denied call never reaches the host; it fails the way the global would, by rejecting the
 * promise of an asynchronous global and by throwing from a synchronous one. Functions inside a global object are
 * called the same way, named by their path (`fs.readFile`).
 *
 * Programs can also `import` or `require` a global by its Node module name; see `interpreter/modules.ts`.
 */
export type Extension<Globals extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> = {
  readonly name: string
  readonly globals: Globals
}

/** The Effect environment required by an extension's Effect-returning functions, at the top level or one level in. */
export type Services<E> = E extends { readonly globals: infer Globals } ? GlobalServices<Globals[keyof Globals]> : never

type GlobalServices<Global> = Global extends (...args: never) => unknown
  ? Requirements<Global>
  : Global extends object
    ? Requirements<Global[keyof Global]>
    : never

type Requirements<F> = F extends (...args: never) => infer Result ? Effect.Services<Result> : never

export const make = <const Globals extends Readonly<Record<string, unknown>>>(
  options: Extension<Globals>,
): Extension<Globals> => {
  for (const [name, value] of Object.entries(options.globals)) {
    if (typeof value !== "function" && (typeof value !== "object" || value === null)) {
      throw new TypeError(`Extension "${options.name}" global "${name}" must be a function or an object.`)
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
