export * as Host from "./host.js"

import { realpathSync } from "node:fs"
import path from "node:path"
import { importModule, resolveModule } from "@opencode/util/runtime-import"

export interface Target {
  readonly directory: string
  readonly name?: string
}

export interface Entrypoints {
  readonly server?: string
  readonly tui?: string
  readonly rpc?: string
}

export function resolve(target: Target): Entrypoints {
  // The runtime caches a symlinked directory's resolution for the life of the
  // process, so a plugin directory symlink retargeted since it was first resolved
  // (nix, home-manager, stow, dotfiles) would keep reporting its previous
  // target's entrypoints for every caller. Follow the link before resolving, so
  // the entrypoints belong to the directory's current target.
  const directory = target.name ? target.directory : realDirectory(target.directory)
  const entry = (subpaths: readonly string[]) => {
    for (const subpath of subpaths) {
      const specifier = target.name
        ? [target.name, subpath].filter(Boolean).join("/")
        : path.resolve(directory, subpath || "index")
      try {
        return resolveModule(specifier, directory)
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          ![
            "ENOENT",
            "ENOTDIR",
            "MODULE_NOT_FOUND",
            "ERR_MODULE_NOT_FOUND",
            "ERR_PACKAGE_PATH_NOT_EXPORTED",
            "ERR_UNSUPPORTED_DIR_IMPORT",
          ].includes(String(error.code))
        )
          throw error
      }
    }
    return undefined
  }
  return { server: entry(["server", ""]), tui: entry(["tui"]), rpc: entry(["rpc"]) }
}

export function load(entrypoint: string): Promise<unknown> {
  return importModule(entrypoint)
}

// A directory that does not exist yet must keep resolving to nothing rather than
// throw: callers ask about configured plugins that may have gone away.
function realDirectory(directory: string) {
  try {
    return realpathSync(directory)
  } catch {
    return directory
  }
}
