import { useDialog } from "@opencode/ui/context/dialog"
import { startTransition } from "solid-js"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { createKnownServerSessions, createServerSessionEntries, type CommandPaletteEntry } from "./palette"
import { CommandPaletteView } from "./dialog"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"

const RECENT_LIMIT = 10

export function DialogSessionSearch(props: { archived?: boolean }) {
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
      archived: props.archived,
      known: props.archived
        ? () => ctx.data.session.list().filter((session) => !session.parentID)
        : createKnownServerSessions(ctx),
      apply: ctx.data.session.apply,
      projects: ctx.projects.list,
      load: (search, signal) =>
        ctx.sdk.api.session.list({ parentID: null, search, archived: !!props.archived, limit: 50 }, { signal }),
      get: (sessionID, signal) => ctx.sdk.api.session.get({ sessionID }, { signal }),
      untitled: () => language.t("command.session.new"),
      category: () => language.t(props.archived ? "sidebar.inbox.archived.title" : "command.category.session"),
      recentCategory: () =>
        language.t(props.archived ? "sidebar.inbox.archived.title" : "palette.group.recentSessions"),
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
      items: (query: string) => format(load.items(query)),
      search: (query: string) => load.search(query).then(format),
    }
  })

  const items = (query: string) => {
    const entries = loaders
      .flatMap((loader) => loader.items(query))
      .toSorted((a, b) => (b.updated ?? 0) - (a.updated ?? 0))

    return query ? entries : entries.slice(0, RECENT_LIMIT)
  }

  const sessions = async (query: string) => {
    const entries = (await Promise.all(loaders.map((loader) => loader.search(query))))
      .flat()
      .toSorted((a, b) => (b.updated ?? 0) - (a.updated ?? 0))

    return query ? entries : entries.slice(0, RECENT_LIMIT)
  }

  const select = (item: CommandPaletteEntry | undefined) => {
    if (!item?.sessionID || !item.server) return
    const sessionId = item.sessionID
    const server = item.server
    const directory = item.project?.worktree ?? item.directory
    const conn = servers.find((conn) => ServerConnection.key(conn) === server)

    const open = () => {
      dialog.close()

      if (conn && directory) global.ensureServerCtx(conn).projects.touch(directory)
      void startTransition(() => tabs.select(tabs.addSessionTab({ server, sessionId })))
    }

    if (!props.archived) return open()

    if (!conn) return

    const ctx = global.ensureServerCtx(conn)

    void ctx.sdk.api.session
      .update({ sessionID: sessionId, archived: false })
      .then(async () => {
        ctx.data.session.remember(await ctx.sdk.api.session.get({ sessionID: sessionId }))
        open()
      })
      .catch((cause) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        }),
      )
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
