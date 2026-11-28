// Stand-ins let unused OpenTUI imports link. Report the first actual use of an unsupported export.
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
    // Async stand-ins must return a promise so callers can chain them.
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
