import { Schema } from "effect"
import { Plugin } from "@opencode/plugin/desktop"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"
import { evaluateBundle } from "@opencode/plugin/desktop/bundle"

export async function loadExtension(input: ExtensionManager.Source) {
  const { modules } = await import("./modules.gen")
  const shared = new Map(
    await Promise.all(
      input.manifest.imports.map(async (name) => {
        const load = modules[name]
        if (!load) throw new ExtensionManager.ManagerError("invalidModule")
        return [name, await load()] as const
      }),
    ),
  )
  const value = Schema.decodeUnknownOption(Schema.Struct({ default: Plugin.Definition }))(
    evaluateBundle(input.source, shared),
  )
  if (value._tag === "None" || value.value.default.id !== input.manifest.id)
    throw new ExtensionManager.ManagerError("invalidModule")
  const definition = value.value.default
  return {
    ...definition,
    setup(context) {
      if (input.manifest.style) {
        const stylesheet = document.createElement("link")
        stylesheet.rel = "stylesheet"
        stylesheet.href = context.assets.url(input.manifest.style)
        document.head.append(stylesheet)
        context.lifecycle.own(() => stylesheet.remove())
      }
      return definition.setup(context)
    },
  } satisfies Plugin.Definition
}
