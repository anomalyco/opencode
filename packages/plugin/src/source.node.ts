import { registerHooks } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { localSource } from "./source.js"
import { Host } from "./host.js"

let generation = Date.now()

export async function prepareSource(entrypoint: string, track: (file: string, directory?: boolean) => void) {
  const version = String(++generation)
  const fresh = (specifier: string) => {
    const url = new URL(specifier)
    url.searchParams.set("__opencode_reload", version)
    return url.href
  }
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!context.parentURL || new URL(context.parentURL).searchParams.get("__opencode_reload") !== version)
        return nextResolve(specifier, context)
      const local =
        specifier.startsWith("./") || specifier.startsWith("../")
          ? new URL(specifier, context.parentURL)
          : localSource(specifier, path.dirname(fileURLToPath(context.parentURL)))
      if (!local) return nextResolve(specifier, context)
      if (fileURLToPath(local).split(path.sep).includes("node_modules")) return nextResolve(specifier, context)
      const resolved = (() => {
        try {
          return nextResolve(specifier, context)
        } catch (error) {
          track(path.dirname(fileURLToPath(local)), true)
          throw error
        }
      })()
      if (!resolved.url.startsWith("file:")) return resolved
      const file = fileURLToPath(resolved.url)
      if (file.split(path.sep).includes("node_modules")) return resolved
      track(file)
      return { ...resolved, url: fresh(resolved.url) }
    },
  })
  const specifier = fresh(entrypoint)
  return { version: specifier, load: () => Host.load(specifier), dispose: () => hook.deregister() }
}
