import { define, get, Obj, type Value } from "./objects.js"

/**
 * What `import` and `require` load: a global, by the Node module name that provides it. `fs` loads the `fs` global
 * and `crypto` the `crypto` global; the names below come from globals with different names. A module that would be
 * empty isn't available.
 */
const aliases: Record<string, (global: (name: string) => Value) => Value> = {
  "fs/promises": (global) => {
    const fs = global("fs")
    return fs instanceof Obj ? get(fs, "promises") : undefined
  },
  url: (global) => pick(global, ["URL", "URLSearchParams"]),
  util: (global) => pick(global, ["TextEncoder", "TextDecoder"]),
  buffer: (global) => pick(global, ["Buffer", "atob", "btoa"]),
}

/** `node:fs` names the same module as `fs`. */
export const moduleName = (specifier: string) => (specifier.startsWith("node:") ? specifier.slice(5) : specifier)

// Node's core modules, fixed here so every host gives the same answer (Bun's `isBuiltin` also claims `ws` and `undici`).
const core = new Set(
  "assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs http http2 https inspector module net os path perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib".split(
    " ",
  ),
)

/** Whether a specifier names a module a runtime provides, as Node's and Bun's own modules are, rather than a package. */
export const isRuntimeModule = (specifier: string) =>
  specifier.startsWith("node:") ||
  specifier === "bun" ||
  specifier.startsWith("bun:") ||
  core.has(specifier.split("/")[0]!)

/** `hosted` names the global a host's own module names load (`{ bun: "Bun" }`). */
export const resolveModule = (
  specifier: string,
  global: (name: string) => Value,
  hosted: Readonly<Record<string, string>> = {},
): Value => {
  const name = moduleName(specifier)
  const named = Object.hasOwn(hosted, name) ? hosted[name] : undefined
  return global(name) ?? (named === undefined ? undefined : global(named)) ?? aliases[name]?.(global)
}

function pick(global: (name: string) => Value, names: ReadonlyArray<string>): Value {
  const found = names.flatMap((name) => {
    const value = global(name)
    return value === undefined ? [] : [[name, value] as const]
  })
  if (found.length === 0) return undefined
  const module = new Obj(null)
  for (const [name, value] of found) define(module, name, value)
  return module
}
