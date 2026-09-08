import { createRequire, isBuiltin } from "node:module"
import { Schema } from "effect"
import { MainPlugin } from "@opencode/plugin/desktop/main"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"
import { evaluateBundle } from "@opencode/plugin/desktop/bundle"
import type { createExtensionManager } from "./manager"

const native = createRequire(import.meta.url)
const shared = new Map<string, () => Promise<unknown>>([
  ["effect", () => import("effect")],
  ["@opencode/plugin/desktop/main", () => import("@opencode/plugin/desktop/main")],
  ["@opencode/schema/rpc", () => import("@opencode/schema/rpc")],
  ["@opencode/client/effect", () => import("@opencode/client/effect")],
  ["@opencode/client", () => import("@opencode/client")],
])

export async function loadMainPlugin(manager: ReturnType<typeof createExtensionManager>, id: string) {
  const entry = manager.list().find((entry) => entry.id === id && entry.enabled && entry.hasMain)
  if (!entry) return
  const input = manager.source(id, entry.revision, true)
  const modules = new Map(
    await Promise.all(
      (input.manifest.mainImports ?? []).map(async (name) => {
        if (name === "electron" || isBuiltin(name)) return [name, native(name)] as const
        const load = shared.get(name)
        if (!load) throw new ExtensionManager.ManagerError("invalidModule")
        return [name, await load()] as const
      }),
    ),
  )
  // Re-read after module loading so disabling/replacing an archive takes effect
  // before a new main instance can start.
  const current = manager.source(id, entry.revision, true)
  const decoded = Schema.decodeUnknownOption(Schema.Struct({ default: MainPlugin.Entry }))(
    evaluateBundle(current.source, modules),
  )
  if (decoded._tag === "None" || decoded.value.default.id !== id)
    throw new ExtensionManager.ManagerError("invalidModule")
  return decoded.value.default
}
