import { PaletteSource, type PaletteEntry } from "@opencode/plugin/gui"
import { ServerConnection } from "@/runtime/server/registry"
import type { CommandPaletteEntry } from "@/shell/commands/palette"
import { usePluginHost, type Item } from "./host"

/**
 * A plugin's rows as palette session entries. Each row takes the id the palette's own session search gives that
 * session, so a session both find lists once: the built-in row, whose source runs first, wins.
 */
export function pluginPaletteEntries(rows: readonly PaletteEntry[], category: string): CommandPaletteEntry[] {
  return rows.map((row) => {
    const server = ServerConnection.Key.make(row.server)

    return {
      id: `session:${server}:${row.session}`,
      type: "session" as const,
      title: row.title,
      description: row.description,
      keywords: row.keywords,
      category,
      directory: row.directory,
      sessionID: row.session,
      server,
      updated: row.updated,
    }
  })
}

/**
 * Searches every registered source. Each runs on its own: one that throws or rejects is logged against its plugin
 * and contributes nothing, and the others' rows still list.
 */
export async function searchPluginSources(
  items: readonly Item<PaletteSource>[],
  query: string,
  signal: AbortSignal,
  category: string,
): Promise<CommandPaletteEntry[]> {
  if (!query || items.length === 0) return []

  const results = await Promise.allSettled(items.map((item) => Promise.try(() => item.value.search({ query, signal }))))

  return results.flatMap((result, index) => {
    if (result.status === "fulfilled") return pluginPaletteEntries(result.value, category)

    if (!signal.aborted) console.error(`[plugin] ${items[index].plugin} palette source`, result.reason)

    return []
  })
}

/** The palette source that searches plugin sources, read per call so a plugin that mounts later is included. */
export function usePluginPaletteSources(category: () => string) {
  const host = usePluginHost()

  return (query: string, signal: AbortSignal) =>
    searchPluginSources(host.items(PaletteSource), query, signal, category())
}
