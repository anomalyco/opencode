import { readFileSync } from "node:fs"
import path from "node:path"
import { xdgConfig } from "xdg-basedir"
import { parse } from "jsonc-parser"
import type { ConfigProxy } from "../config/proxy"

/**
 * Read the `proxy` section from OpenCode's configuration. Proxy settings are
 * network-wide, so this reads the global config plus any project configs found
 * walking up from `cwd`; the nearest file wins.
 *
 * This is a standalone reader because the shared `httpClient` node is global
 * while `Config` is location-scoped. It intentionally handles only `proxy`.
 */
export function readProxyConfig(cwd: string, globalConfigDir = path.join(xdgConfig!, "opencode")): ConfigProxy.Info | undefined {
  const files = walk(cwd)
    .flatMap((directory) => [path.join(directory, "opencode.jsonc"), path.join(directory, "opencode.json")])
    .concat([path.join(globalConfigDir, "opencode.jsonc"), path.join(globalConfigDir, "opencode.json")])

  let proxy: ConfigProxy.Info | undefined
  for (const file of files) {
    const parsed = readJson(file)
    const candidate = parsed?.proxy
    if (candidate && typeof candidate === "object") proxy = { ...proxy, ...candidate }
  }
  return proxy
}

function readJson(file: string): { proxy?: ConfigProxy.Info } | undefined {
  try {
    const errors: unknown[] = []
    return parse(readFileSync(file, "utf8"), errors, { allowTrailingComma: true })
  } catch {
    return undefined
  }
}

function walk(start: string): string[] {
  const directories: string[] = []
  let current = path.resolve(start)
  while (true) {
    directories.push(current, path.join(current, ".opencode"))
    const parent = path.dirname(current)
    if (parent === current) return directories
    current = parent
  }
}
