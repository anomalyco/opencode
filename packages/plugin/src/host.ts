export * as Host from "./host.js"

import path from "node:path"
import { importModule, resolveModule } from "@opencode/util/runtime-import"
import { manifest } from "./manifest.js"

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
  const local = target.name ? undefined : manifest(target.directory)
  const entry = (subpaths: readonly string[]) => {
    for (const subpath of subpaths) {
      const specifiers = target.name
        ? [[target.name, subpath].filter(Boolean).join("/")]
        : (local?.(subpath) ?? [subpath || "index"]).map((file) => path.resolve(target.directory, file))
      for (const specifier of specifiers) {
        try {
          return resolveModule(specifier, target.directory)
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
    }
    return undefined
  }
  return { server: entry(["server", ""]), tui: entry(["tui"]), rpc: entry(["rpc"]) }
}

export function load(entrypoint: string): Promise<unknown> {
  return importModule(entrypoint)
}
