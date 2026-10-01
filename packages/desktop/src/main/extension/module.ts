import { createRequire, isBuiltin } from "node:module"
import type { Catalog, Setup } from "@opencode/gui-extensions/sdk/main"
import { Schema } from "effect"
import { ExtensionError } from "./error"

const native = createRequire(import.meta.url)
// Installed bundles share the host's module instances, so tokens and schemas they import are the
// same objects the host checks against.
const shared = new Map<string, () => Promise<unknown>>([
  ["effect", () => import("effect")],
  ["@opencode/gui-extensions/sdk/main", () => import("@opencode/gui-extensions/sdk/main")],
  ["@opencode/schema/rpc", () => import("@opencode/schema/rpc")],
  ["@opencode/client", () => import("@opencode/client")],
  ["@opencode/client/effect", () => import("@opencode/client/effect")],
])

// Installed catalogs ship every locale inline; only built-ins load locales lazily.
const InlineCatalog = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))

export function mainImportAllowed(name: string) {
  return name === "electron" || isBuiltin(name) || shared.has(name)
}

/** Evaluates an installed extension's main bundle as CommonJS against the shared module map. */
export async function evaluateMain(source: string, imports: readonly string[]) {
  const modules = new Map(
    await Promise.all(
      imports.map(async (name) => {
        if (name === "electron" || isBuiltin(name)) return [name, native(name)] as const
        const load = shared.get(name)
        if (!load) throw new ExtensionError("invalidModule", { message: name })
        return [name, await load()] as const
      }),
    ),
  )
  const module = { exports: {} as Record<string, unknown> }
  // Installed extensions are trusted code the user chose to install.
  new Function("require", "module", "exports", source)(
    (name: string) => {
      if (!modules.has(name)) throw new ExtensionError("invalidModule", { message: name })
      return modules.get(name)
    },
    module,
    module.exports,
  )
  const setup = module.exports.default
  if (!isSetup(setup)) throw new ExtensionError("invalidModule")
  return { setup, i18n: catalog(module.exports.i18n) }
}

function isSetup(value: unknown): value is Setup {
  return typeof value === "function"
}

function catalog(value: unknown): Catalog | undefined {
  if (value === undefined) return undefined
  const decoded = Schema.decodeUnknownOption(InlineCatalog)(value)
  if (decoded._tag === "None") throw new ExtensionError("invalidModule", { message: "i18n" })
  return { en: {}, ...decoded.value }
}
