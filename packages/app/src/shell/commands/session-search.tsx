import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, createSignal, startTransition } from "solid-js"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { createKnownServerSessions, createServerSessionEntries, type CommandPaletteEntry } from "./palette"
import { CommandPaletteView } from "./dialog"

const RECENT_LIMIT = 10

export function DialogSessionSearch() {
  const dialog = useDialog()
  const global = useGlobal()
  const language = useLanguage()
  const tabs = useTabs()
  const registry = useServers()

  const servers = registry.visible.filter(
    (conn) => global.servers.health[ServerConnection.key(conn)]?.healthy !== false,
  )

  const loaders = servers.map((conn) => {
    const ctx = global.ensureServerCtx(conn)

    const load = createServerSessionEntries({
      server: ServerConnection.key(conn),
      known: createKnownServerSessions(ctx),
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

    return {
      all: () => format(load.all()),
      items: (query: string) => format(load.items(query)),
      search: (query: string) => load.search(query).then(format),
      recent: load.recent,
    }
  })

  const ranked = (query: string) => {
    const entries = loaders
      .flatMap((loader) => loader.items(query))
      .toSorted((a, b) => (b.updated ?? 0) - (a.updated ?? 0))

    return query ? entries : entries.slice(0, RECENT_LIMIT)
  }

  // Rank recent sessions once, from what is already known, and keep that order while the dialog is open instead of
  // moving rows as sessions get activity. Rows still show live titles, and deleted or archived sessions leave.
  const top = () => ranked("").map((entry) => entry.id)
  const [order, setOrder] = createSignal(top())

  // The server's list only adds the sessions the order is missing, such as all of them when none were known.
  const initial = Promise.all(loaders.map((loader) => loader.recent().catch(() => {}))).then(() =>
    setOrder((current) => [...current, ...top().filter((id) => !current.includes(id))].slice(0, RECENT_LIMIT)),
  )

  const recent = createMemo(() => {
    const live = new Map(loaders.flatMap((loader) => loader.all()).map((entry) => [entry.id, entry] as const))

    return order().flatMap((id) => live.get(id) ?? [])
  })

  const items = (query: string) => (query ? ranked(query) : recent())

  const sessions = async (query: string) => {
    // Waiting on the server's list shows the loading state, not an empty one, when no recent sessions were known.
    if (!query) return initial.then(() => [])

    return (await Promise.all(loaders.map((loader) => loader.search(query))))
      .flat()
      .toSorted((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
  }

  const select = (item: CommandPaletteEntry | undefined) => {
    if (!item?.sessionID || !item.server) return
    const sessionId = item.sessionID
    const server = item.server
    const directory = item.project?.worktree ?? item.directory
    const conn = servers.find((conn) => ServerConnection.key(conn) === server)
    dialog.close()

    if (conn && directory) global.ensureServerCtx(conn).projects.touch(directory)
    void startTransition(() => tabs.select(tabs.addSessionTab({ server, sessionId })))
  }

  return (
    <CommandPaletteView
      placeholder={language.t("home.sessions.search.placeholder")}
      items={items}
      sources={[sessions]}
      highlight={() => {}}
      select={select}
      close={() => dialog.close()}
    />
  )
}
