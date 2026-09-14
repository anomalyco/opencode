export * as Extension from "./extension.js"

/**
 * Host classes and functions a program uses directly, like JavaScript. Values crossing in either direction are
 * converted, never shared: plain data is copied, instances of the classes stay on the host behind program-side
 * handles. Extension calls are not tool calls.
 */
export type Extension = {
  readonly name: string
  /** Each value is a class or a function; everything on a class is exposed, including statics and accessors. */
  readonly globals: Readonly<Record<string, Function>>
}

export const make = (options: Extension): Extension => {
  for (const [name, value] of Object.entries(options.globals)) {
    if (typeof value !== "function") {
      throw new TypeError(`Extension "${options.name}" global "${name}" must be a class or a function.`)
    }
  }
  return { name: options.name, globals: { ...options.globals } }
}
