import type { BuiltinPanel } from "@opencode/plugin/gui/builtin"

/** The key the host stores a panel tab under. */
export function panelKey(plugin: string, id: string) {
  return `${plugin}:${id}`
}

/** The stored keys the panels map with `BuiltinPanel.legacy`, each to the key of the tab it is now. */
export function legacyKeys(providers: readonly { readonly plugin: string; readonly value: BuiltinPanel }[]) {
  return new Map(
    providers.flatMap((item) =>
      Object.entries(item.value.legacy ?? {}).map(([key, id]) => [key, panelKey(item.plugin, id)] as const),
    ),
  )
}
