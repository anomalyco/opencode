import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"
import { createSignal, onCleanup, startTransition, untrack } from "solid-js"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { isServerFailed } from "@/runtime/server/health-machine"
import { useTabs } from "@/shell/tabs/tabs"
import { createKnownServerSessions, createServerSessionEntries, type CommandPaletteEntry } from "./palette"
import { CommandPaletteView } from "./dialog"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import {
  INITIAL_SESSION_SEARCH_STATE,
  selectSessionRestoreEntryID,
  transitionSessionSearch,
  type SessionSearchEffect,
  type SessionSearchEvent,
} from "./session-search-machine"

const RECENT_LIMIT = 10

export function DialogSessionSearch(props: { archived?: boolean }) {
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
      archived: props.archived,
      known: props.archived
        ? () => ctx.data.session.known().filter((session) => !session.parentID)
        : createKnownServerSessions(() => ctx),
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

  const [searchState, setSearchState] = createSignal(INITIAL_SESSION_SEARCH_STATE)
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  const dispatch = (event: SessionSearchEvent) =>
    untrack(() => {
      const previous = searchState()
      const next = transitionSessionSearch(previous, event)

      if (next.state !== previous) setSearchState(next.state)
      next.effects.forEach((effect) => void Promise.try(() => run(effect)).catch(console.error))
    })

  const run = (effect: SessionSearchEffect) => {
    if (effect.type === "timer.clear") {
      clearTimeout(timers.get(effect.attempt))
      timers.delete(effect.attempt)

      return
    }

    if (effect.type === "session.remember")
      return global.serverCtx(effect.server)?.data.session.remember(effect.session)

    if (effect.type === "session.open") {
      // By id: once this dialog is gone, or replaced through `show`, the open closes nothing else.
      dialog.close(layer?.id)

      if (effect.directory) global.serverCtx(effect.server)?.projects.touch(effect.directory)
      void startTransition(() =>
        tabs.select(tabs.addSessionTab({ server: effect.server, sessionId: effect.sessionID })),
      )

      return
    }

    if (effect.type === "toast.failed") {
      const fallback = language.t("common.requestFailed")

      return showToast({ title: fallback, description: effect.error ? errorMessage(effect.error, fallback) : fallback })
    }

    timers.set(
      effect.attempt,
      setTimeout(() => dispatch({ type: "restore.timed-out", attempt: effect.attempt }), effect.timeoutMs),
    )
    // Not aborted on timeout or close: the restore may still land, and its result then refreshes the session.
    void Promise.try(async () => {
      const ctx = global.serverCtx(effect.server)

      if (!ctx) throw new Error(language.t("common.requestFailed"))
      await ctx.sdk.api.session.update({ sessionID: effect.sessionID, archived: false })

      return ctx.sdk.api.session.get({ sessionID: effect.sessionID })
    }).then(
      (session) => dispatch({ type: "restore.succeeded", attempt: effect.attempt, server: effect.server, session }),
      (error) => dispatch({ type: "restore.failed", attempt: effect.attempt, error }),
    )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  const select = (item: CommandPaletteEntry | undefined) => {
    if (!item?.sessionID || !item.server) return
    dispatch({
      type: "entry.selected",
      server: item.server,
      sessionID: item.sessionID,
      directory: item.project?.worktree ?? item.directory,
      archived: !!props.archived,
    })
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
      busyEntryID={selectSessionRestoreEntryID(searchState())}
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
