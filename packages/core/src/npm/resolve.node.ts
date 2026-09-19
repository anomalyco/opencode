import { Script, constants } from "node:vm"
import { createRequire, registerHooks } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { resolve, type Package } from "resolve.exports"

// Capture import conditions from the runtime, including custom conditions and module-sync.
let conditions: readonly string[] = []
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    // Concurrent startup requires must not overwrite the import probe's conditions.
    if (specifier === "node:module" && context.conditions.includes("import")) conditions = context.conditions
    return nextResolve(specifier, context)
  },
})
await new Script('import("node:module")', {
  importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
}).runInThisContext()
hooks.deregister()

export function resolveModule(_name: string, directory: string) {
  const pkg = createRequire(import.meta.url)(path.join(directory, "package.json")) as Package
  const target = resolve(pkg, ".", { conditions, unsafe: true })?.[0]
  if (target) return pathToFileURL(path.resolve(directory, target)).href
  return pathToFileURL(createRequire(path.join(directory, "package.json")).resolve(directory)).href
}
