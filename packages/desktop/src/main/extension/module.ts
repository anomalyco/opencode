import { createRequire, isBuiltin } from "node:module"
import type { MainSetup } from "@opencode/gui-extensions/sdk/main"
import { Option, Predicate, Schema } from "effect"
import { ExtensionError } from "./error"

const native = createRequire(import.meta.url)

// Installed bundles share the host's module instances, so tokens and schemas they import are the
// same objects the host checks against.
const shared = new Map<string, () => Promise<object>>([
  ["effect", () => import("effect")],
  ["@opencode/gui-extensions/sdk/main", () => import("@opencode/gui-extensions/sdk/main")],
  ["@opencode/schema/rpc", () => import("@opencode/schema/rpc")],
  ["@opencode/client", () => import("@opencode/client")],
  ["@opencode/client/effect", () => import("@opencode/client/effect")],
])

// Installed catalogs ship every locale inline; only built-ins load locales lazily.
const InlineCatalog = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))

/** The CommonJS module an installed main bundle fills: its setup and, optionally, its catalog. */
type Module = { exports: { default?: object; i18n?: object } }

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

  const module: Module = { exports: {} }

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
  const i18n = module.exports.i18n

  if (!Predicate.isFunction(setup)) throw new ExtensionError("invalidModule")
  const catalog = i18n === undefined ? undefined : Schema.decodeUnknownOption(InlineCatalog)(i18n)

  if (catalog && Option.isNone(catalog)) throw new ExtensionError("invalidModule", { message: "i18n" })

  // SAFETY: a bundle is plain JavaScript; a function default export is its setup, all the host can check of it.
  return { setup: setup as MainSetup, i18n: catalog && { en: {}, ...catalog.value } }
}
