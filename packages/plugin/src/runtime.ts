import { loadRuntimeModules, resolveHostPackageRoots, type RuntimeModuleLoader } from "./runtime-modules.js"

const foreignPkgSuffix = String.raw`(?:node_modules[/\\](@opencode[/\\]plugin|effect)|(@opencode[/\\]plugin|effect)@[^/\\]+@@@\d+)`
const foreignPkgPattern = new RegExp(String.raw`^(.*[/\\]${foreignPkgSuffix})[/\\](.+)$`)

let installed: Readonly<Record<string, RuntimeModuleLoader>> | undefined

export function provides(specifier: string) {
  return installed !== undefined && Object.hasOwn(installed, specifier)
}

/** Later host consumers may add shared modules without replacing existing owners. */
export function ensurePluginRuntime(additional: Readonly<Record<string, Record<string, unknown>>> = {}) {
  if (typeof Bun === "undefined") return {}
  const previous = installed
  const modules = previous ?? loadRuntimeModules()
  const added = Object.fromEntries(
    Object.entries(additional)
      .filter(([specifier]) => !Object.hasOwn(modules, specifier))
      .map(([specifier, exports]) => [specifier, () => exports]),
  )
  if (previous && Object.keys(added).length === 0) return previous
  installed = { ...modules, ...added }
  const pending = previous ? added : installed
  Bun.plugin({
    name: "opencode-plugin-runtime",
    setup(build) {
      for (const [specifier, load] of Object.entries(pending)) {
        build.module(specifier, () => {
          const exports = load()
          return exports instanceof Promise
            ? exports.then((value) => ({ exports: value, loader: "object" as const }))
            : { exports, loader: "object" as const }
        })
      }
      if (!previous)
        build.onLoad({ filter: createForeignPackageFilter() }, (args) => {
          const match = args.path.match(foreignPkgPattern)
          const target = match ? `${match[2] ?? match[3]}/${match[4]}`.replaceAll("\\", "/") : args.path
          throw new Error(
            `Cannot load "${target}" from plugin node_modules: "${target}" is not provided by OpenCode; plugins must use the host's "effect" and "@opencode/plugin" modules.`,
          )
        })
    },
  })
  return installed
}

export function createForeignPackageFilter(rootsInput: Iterable<string> = resolveHostPackageRoots()) {
  const suffix = String.raw`[/\\]${foreignPkgSuffix}[/\\].*\.[cm]?[jt]sx?(?:[?#].*)?$`
  const roots = [...new Set(rootsInput)]
  if (roots.length === 0) return new RegExp(suffix)
  const escaped = roots
    .map((value) =>
      value
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/(?:\\\/|\\\\|\/)+/g, "[/\\\\]"),
    )
    .join("|")
  return new RegExp(`^(?!(?:${escaped})[/\\\\]).*${suffix}`)
}
