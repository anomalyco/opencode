import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"
import { startTransition } from "solid-js"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { isServerFailed } from "@/runtime/server/health-machine"
import { useTabs } from "@/shell/tabs/tabs"
import { createKnownServerSessions, createServerSessionEntries, type CommandPaletteEntry } from "./palette"
import { CommandPaletteView } from "./dialog"

const RECENT_LIMIT = 10

export function DialogSessionSearch() {
  const dialog = useDialog()
  const layer = useDialogLayer()
  const global = useGlobal()
  const language = useLanguage()
  const tabs = useTabs()
  const registry = useServers()

  const servers = registry.visible.filter((conn) => !isServerFailed(global.servers.health[ServerConnection.key(conn)]))

  const loaders = servers.flatMap((conn) => {
    const ctx = global.serverCtx(ServerConnection.key(conn))

    if (!ctx) return []

    const load = createServerSessionEntries({
      server: ServerConnection.key(conn),
      known: createKnownServerSessions(() => ctx),
      apply: ctx.data.session.apply,
      projects: ctx.projects.list,
      load: (search, signal) =>
        ctx.sdk.api.session.list({ parentID: null, search, archived: false, limit: 50 }, { signal }),
      get: (sessionID, signal) => ctx.sdk.api.session.get({ sessionID }, { signal }),
      untitled: () => language.t("command.session.new"),
      category: () => language.t("command.category.session"),
      recentCategory: () => language.t("palette.group.recentSessions"),
      recentLimit: RECENT_LIMIT,
    })

    const tag = registry.tag(conn)

    const format = (entries: CommandPaletteEntry[]) =>
      servers.length < 2 || !tag
        ? entries
        : entries.map((entry) => ({
            ...entry,
            description: language.t("palette.session.location", { project: entry.description ?? "", server: tag }),
          }))

    return [
      {
        items: (query: string) => format(load.items(query)),
        search: (query: string, signal: AbortSignal) => load.search(query, signal).then(format),
      },
    ]
  })

  const items = (query: string) => {
    const entries = loaders
      .flatMap((loader) => loader.items(query))
      .toSorted((a, b) => (b.updated ?? 0) - (a.updated ?? 0))

    return query ? entries : entries.slice(0, RECENT_LIMIT)
  }

  const select = (item: CommandPaletteEntry | undefined) => {
    if (dialog.closing || !item?.sessionID || !item.server) return

    const { server, sessionID } = item
    const directory = item.project?.worktree ?? item.directory

    dialog.close(layer?.id)

    if (directory) global.serverCtx(server)?.projects.touch(directory)
    void startTransition(() => tabs.select(tabs.addSessionTab({ server, sessionId: sessionID })))
  }

  // Each server is its own source, so a slow or failing server never holds back or hides another's sessions.
  return (
    <CommandPaletteView
      placeholder={language.t("home.sessions.search.placeholder")}
      items={items}
      sources={loaders.map((loader) => loader.search)}
      highlight={() => {}}
      select={select}
      close={() => dialog.close(layer?.id)}
      bare
      unhide={(entry) => {
        const server = entry.server
        const id = entry.sessionID

        if (!server || !id || !global.sessionPreferences.hidden(server, id)) return

        return () => {
          global.sessionPreferences.update("hidden", server, id, false)
          dialog.close(layer?.id)
        }
      }}
    />
  )
}
