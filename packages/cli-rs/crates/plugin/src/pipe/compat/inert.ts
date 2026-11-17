// What the layer gives for an export of `@opentui/core` or `@opentui/solid` it does not implement (FT-5): a value
// that can be imported, called, constructed, extended and read through without throwing, and does nothing. Its first
// use warns once in the JS host's log, by the export's name: a plugin that imports a renderable class it never uses
// loads, where a missing ESM export would fail its whole module at link time.
import { core, promises, solid } from "./opentui.gen"

const warned = new Set<string>()
const promised = new Set(promises)

function warn(name: string) {
  if (warned.has(name)) return
  warned.add(name)
  console.warn(`${name} from @opentui is not supported by opencode-native yet; it does nothing`)
}

// Methods of an inert instance, and of a class that extends an inert class, do nothing and answer nothing.
const methods: object = new Proxy(
  {},
  {
    get(target, key) {
      if (typeof key === "symbol" || key in target) return Reflect.get(target, key)
      return () => undefined
    },
  },
)

export function inert(name: string): any {
  const target = function () {} as unknown as { prototype: object }
  target.prototype = methods
  return new Proxy(target, {
    get(_, key) {
      if (key === "prototype") return methods
      if (key === Symbol.toPrimitive) return () => ""
      // An empty iterable (a spread of `extensionToFiletype.values()`), not a promise or a class with its own
      // `instanceof`.
      if (key === Symbol.iterator) return function* () {}
      if (typeof key === "symbol" || key === "then") return undefined
      return inert(`${name}.${key}`)
    },
    // A method OpenTUI declares async answers a resolved promise of an inert value (CT-16: a plugin chains
    // `getTreeSitterClient().initialize().then(…)`); any other call an inert value.
    apply() {
      warn(name)
      const called = inert(`${name}()`)
      return promised.has(name.slice(name.lastIndexOf(".") + 1)) ? Promise.resolve(called) : called
    },
    construct(_, __, created) {
      warn(name)
      return Object.create(created.prototype)
    },
  })
}

// The exports of `module` (the installed package's names and plain values), with `own`'s in their place.
export function exports(module: "core" | "solid", own: Record<string, unknown>) {
  const listed = { core, solid }[module]
  return {
    ...Object.fromEntries(listed.names.map((key) => [key, inert(key)])),
    ...(listed.values as Record<string, unknown>),
    ...own,
  }
}
