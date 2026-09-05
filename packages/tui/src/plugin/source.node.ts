import { registerHooks } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { localSource } from "./discovery"

let generation = Date.now()

export async function prepareSource(entrypoint: string, track: (file: string, directory?: boolean) => void) {
  const version = ++generation
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!context.parentURL?.endsWith(`?mtime=${version}`)) return nextResolve(specifier, context)
      const local = localSource(specifier, path.dirname(fileURLToPath(context.parentURL)))
      if (!local) return nextResolve(specifier, context)
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
      return { ...resolved, url: `${resolved.url}?mtime=${version}` }
    },
  })
  return { version: `${entrypoint}?mtime=${version}`, dispose: () => hook.deregister() }
}
