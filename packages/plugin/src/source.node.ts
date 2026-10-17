import { registerHooks } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { localSource } from "./source.js"
import { missingPackageTarget } from "./source.package.js"
import { Host } from "./host.js"

let generation = Date.now()

function projectRoot(entrypoint: string): string | undefined {
  const filePath = fileURLToPath(entrypoint)
  const parts = filePath.split(path.sep)
  const idx = parts.indexOf(".opencode")
  if (idx < 1) return undefined
  return parts.slice(0, idx).join(path.sep)
}

export async function prepareSource(entrypoint: string, track: (file: string, directory?: boolean) => void) {
  const version = String(++generation)
  const projectDir = projectRoot(entrypoint)
  const fresh = (specifier: string) => {
    const url = new URL(specifier)
    url.searchParams.set("__opencode_reload", version)
    return url.href
  }
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!context.parentURL || new URL(context.parentURL).searchParams.get("__opencode_reload") !== version)
        return nextResolve(specifier, context)
      const parentDir = path.dirname(fileURLToPath(context.parentURL))
      const local =
        specifier.startsWith("./") || specifier.startsWith("../")
          ? new URL(specifier, context.parentURL)
          : localSource(specifier, parentDir)
      if (!local) {
        if (specifier.startsWith("@") && projectDir) {
          const pluginDir = path.dirname(fileURLToPath(context.parentURL))
          if (pluginDir.startsWith(projectDir + path.sep) || pluginDir === projectDir) {
            try {
              const resolved = nextResolve(specifier, { ...context, parentURL: pathToFileURL(projectDir).href })
              if (resolved.url.startsWith("file:")) {
                const file = fileURLToPath(resolved.url)
                if (!file.split(path.sep).includes("node_modules")) {
                  track(file)
                  return { ...resolved, url: fresh(resolved.url) }
                }
              }
              return resolved
            } catch {}
          }
        }
        try {
          return nextResolve(specifier, context)
        } catch (error) {
          const target = missingPackageTarget(specifier, fileURLToPath(context.parentURL))
          if (target) track(target, true)
          throw error
        }
      }
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
