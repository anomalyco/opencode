import type { ParsedKey } from "@opentui/core"

export type PluginKeybindMap = Record<string, string>

type Base = {
  match: (key: string, evt: ParsedKey) => boolean
  print: (key: string) => string
}

export type PluginKeybind = {
  readonly all: PluginKeybindMap
  get: (name: string) => string
  match: (name: string, evt: ParsedKey) => boolean
  print: (name: string) => string
}

const txt = (value: unknown) => {
  if (typeof value !== "string") return
  if (!value.trim()) return
  return value
}

export function createPluginKeybind(
  base: Base,
  defaults: PluginKeybindMap,
  overrides?: Record<string, unknown>,
): PluginKeybind {
  const all = Object.freeze(
    Object.fromEntries(Object.entries(defaults).map(([name, value]) => [name, txt(overrides?.[name]) ?? value])),
  )
  const get = (name: string) => all[name] ?? name

  return {
    get all() {
      return all
    },
    get,
    match: (name, evt) => base.match(get(name), evt),
    print: (name) => base.print(get(name)),
  }
}
