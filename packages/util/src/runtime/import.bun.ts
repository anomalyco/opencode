import { pathToFileURL } from "node:url"

export function importModule(specifier: string) {
  return import(specifier) as Promise<unknown>
}

export function resolveModule(specifier: string, directory: string) {
  const resolved = Bun.resolveSync(specifier, directory)
  return resolved.startsWith("node:") ? resolved : pathToFileURL(resolved).href
}
