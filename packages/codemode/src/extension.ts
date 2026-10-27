export * as Extension from "./extension.js"

/**
 * Host functions a program calls directly as globals. Values crossing in either direction are converted, never
 * shared: arguments come in as copies, results go out as copies, and a function inside a result is callable the
 * same way. A global that returns an Effect gives the program a promise of its result; the Effect runs inside the
 * execution with the services the runtime's tools get, and is interrupted with it. Extension calls are not tool calls.
 */
export type Extension = {
  readonly name: string
  readonly globals: Readonly<Record<string, Function>>
}

export const make = (options: Extension): Extension => {
  for (const [name, value] of Object.entries(options.globals)) {
    if (typeof value !== "function") {
      throw new TypeError(`Extension "${options.name}" global "${name}" must be a function.`)
    }
  }
  return { name: options.name, globals: { ...options.globals } }
}
