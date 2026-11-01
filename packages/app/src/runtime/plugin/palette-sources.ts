import { PaletteSource, type PaletteEntry } from "@opencode/plugin/gui"
import { ServerConnection } from "@/runtime/server/registry"
import type { CommandPaletteEntry } from "@/shell/commands/palette"
import { usePluginHost } from "./host"

/**
 * One source's rows as palette entries. Ids carry the plugin and the source, so two plugins that return the same row
 * id stay distinct, and a row the palette already lists from another source is still deduped by session.
 */
export function pluginPaletteEntries(
  plugin: string,
  source: string,
  rows: readonly PaletteEntry[],
  category: string,
): CommandPaletteEntry[] {
  return rows.map((row) => ({
    id: `plugin:${plugin}:${source}:${row.id}`,
    type: "session" as const,
    title: row.title,
    description: row.description,
    keywords: row.keywords,
    category: row.category ?? category,
    directory: row.directory,
    sessionID: row.session,
    server: ServerConnection.Key.make(row.server),
    updated: row.updated,
  }))
}

/**
 * The palette source that searches every source plugins contribute, read per call so a plugin that mounts later is
 * included. Sources list in `order`; a source that rejects fails the palette search as the built-in sources do.
 */
export function usePluginPaletteSources(category: () => string) {
  const host = usePluginHost()

  return async (query: string, signal: AbortSignal): Promise<CommandPaletteEntry[]> => {
    if (!query) return []

    const items = host
      .items(PaletteSource)
      .toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0))

    if (items.length === 0) return []

    const results = await Promise.all(
      items.map((item) => item.value.search({ query, signal })),
    )

    return results.flatMap((rows, index) =>
      pluginPaletteEntries(items[index].plugin, items[index].value.id, rows, category()),
    )
  }
}
