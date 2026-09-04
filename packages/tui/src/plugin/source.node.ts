import { registerHooks } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { freshSpecifier, localSource } from "./discovery"

export async function prepareSource(
  entrypoint: string,
  version: number,
  track: (file: string, directory?: boolean) => void,
) {
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
      return { ...resolved, url: freshSpecifier(resolved.url, version) }
    },
  })
  return { version: freshSpecifier(entrypoint, version), dispose: () => hook.deregister() }
}
