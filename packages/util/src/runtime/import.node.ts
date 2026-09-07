import { Script, constants } from "node:vm"
import { registerHooks } from "node:module"
import { statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

// SEA's entry module has no import.meta.resolve. Use a separate ESM module
// loaded through the main-context loader so bundling cannot inline it into SEA.
const resolver = (await importModule("data:text/javascript,export default import.meta.resolve")) as {
  default: (specifier: string) => string
}

export async function importModule(specifier: string) {
  const imported = (await new Script(`import(${JSON.stringify(specifier)})`, {
    importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  }).runInThisContext()) as unknown
  if (typeof imported !== "object" || imported === null) return imported

  const module = imported as Record<string, unknown>
  const exports = module["module.exports"]
  if (exports !== module.default || (typeof exports !== "object" && typeof exports !== "function") || exports === null)
    return imported
  return Object.assign({}, module, exports)
}

export function resolveModule(specifier: string, directory: string) {
  // Node only accepts import.meta.resolve's parent URL behind an experimental
  // flag. Scope this synchronous resolution to the caller's package directory
  // through the supported resolver hook instead.
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier, { ...context, parentURL: pathToFileURL(path.join(directory, "package.json")).href })
    },
  })
  try {
    const resolve = (target: string) => {
      const resolved = resolver.default(path.isAbsolute(target) ? pathToFileURL(target).href : target)
      if (resolved.startsWith("file:")) statSync(new URL(resolved))
      return resolved
    }
    try {
      return resolve(specifier)
    } catch (error) {
      if (path.extname(specifier) || !missing(error)) throw error
      // Node does not infer extensions for local files or legacy package
      // subpaths. Resolve each candidate natively so package exports still apply.
      for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"]) {
        try {
          return resolve(specifier + extension)
        } catch (cause) {
          if (!missing(cause)) throw cause
        }
      }
      throw error
    }
  } finally {
    hook.deregister()
  }
}

function missing(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    ["ENOENT", "ENOTDIR", "ERR_MODULE_NOT_FOUND"].includes(String(error.code))
  )
}
