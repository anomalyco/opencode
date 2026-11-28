export * as Host from "./host.js"

import { readFileSync } from "node:fs"
import path from "node:path"
import { Option, Schema } from "effect"
import { importModule, resolveModule } from "@opencode/util/runtime-import"

export interface Target {
  readonly directory: string
  readonly name?: string
}

export interface Entrypoints {
  readonly server?: string
  readonly tui?: string
  readonly rpc?: string
  /**
   * The prebuilt CommonJS GUI bundle (`./gui-experimental`, or `gui-experimental.cjs` or `gui-experimental.js` in a
   * local directory without `exports`). Each desktop app window runs its default export; the desktop app's main
   * process runs its `main` export.
   */
  readonly gui?: string
}

export function resolve(input: Target): Entrypoints {
  // A local directory whose package.json names the package and maps `exports` resolves through them, like the
  // published package; without them it uses the conventional file names at its root.
  const manifest = input.name ? undefined : packageManifest(input.directory)
  const target =
    typeof manifest?.name === "string" && manifest.exports !== undefined ? { ...input, name: manifest.name } : input
  const entry = (subpaths: readonly string[]) => {
    for (const subpath of subpaths) {
      const specifier = target.name
        ? [target.name, subpath].filter(Boolean).join("/")
        : path.resolve(target.directory, subpath || "index")
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
    return undefined
  }
  return {
    server: entry(["server", ""]),
    tui: entry(["tui"]),
    rpc: entry(["rpc"]),
    // The app evaluates the bundle as CommonJS text, so a TypeScript source or an ES module is never a GUI entry.
    gui: [target.name ? entry(["gui-experimental"]) : entry(["gui-experimental.cjs", "gui-experimental.js"])].find(
      (file) => file && /\.c?js$/.test(file),
    ),
  }
}

export function load(entrypoint: string): Promise<unknown> {
  return importModule(entrypoint)
}

/**
 * The id of a plugin without a server part: its package name, or a local directory's name when it has no
 * package.json name. A server part names its plugin in `Plugin.define` instead.
 */
export function packageID(target: Target) {
  if (target.name) return target.name
  const name = packageManifest(target.directory)?.name
  return typeof name === "string" && name ? name : path.basename(target.directory)
}

// The fields resolution reads from a local directory's package.json.
const Manifest = Schema.fromJsonString(
  Schema.Struct({ name: Schema.optional(Schema.Unknown), exports: Schema.optional(Schema.Unknown) }),
)

// An unreadable or invalid package.json counts as missing, so one broken plugin directory never stops the rest
// from resolving: it falls back to the conventional root file names.
function packageManifest(directory: string) {
  let content: string
  try {
    content = readFileSync(path.join(directory, "package.json"), "utf8")
  } catch {
    return undefined
  }
  return Option.getOrUndefined(Schema.decodeUnknownOption(Manifest)(content))
}
