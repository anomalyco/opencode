import type { Panel } from "@opencode/gui-extensions/sdk"

/** The key the host stores a panel tab under. */
export function panelKey(extension: string, id: string) {
  return `${extension}:${id}`
}

/** The stored keys the panels map with `Panel.legacy`, each to the key of the tab it is now. */
export function legacyKeys(providers: readonly { readonly extension: string; readonly value: Panel }[]) {
  return new Map(
    providers.flatMap((item) =>
      Object.entries(item.value.legacy ?? {}).map(([key, id]) => [key, panelKey(item.extension, id)] as const),
    ),
  )
}
