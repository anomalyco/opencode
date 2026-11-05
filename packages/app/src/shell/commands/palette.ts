import { getFilename } from "@opencode/util/path"
import type { Project } from "@/runtime/server/types"
import type { SessionInfo } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import { commandPaletteOptions, useCommand, type CommandOption } from "@/shell/commands/command"
import { useFile } from "@/workspaces/files/model"
import type { ServerCtx } from "@/runtime/server/runtime"
import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import type { LocalProject } from "@/shell/state/layout"
import { ServerConnection } from "@/runtime/server/registry"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { displayName } from "@opencode/ui/project-avatar"
import { projectForSession } from "@/shell/layout/helpers"
import { usePluginHost } from "@/runtime/plugin/host"
import { usePluginAttachment } from "@/runtime/plugin/host-apis"
import { looksLikeSessionID } from "@/session/search"
import { createSettingsPaletteEntries } from "@/settings/palette"
import type { SettingsSearchResult } from "@/settings/search-results"
import { matchesCommandPaletteEntry } from "./search"
import {
  INITIAL_PALETTE_HIGHLIGHT_STATE,
  transitionPaletteHighlight,
  type PaletteHighlightEvent,
} from "./highlight-machine"
import {
  INITIAL_SESSION_SOURCE_STATE,
  PALETTE_SESSION_DEBOUNCE_MS,
  transitionSessionSource,
  type SessionSourceEffect,
  type SessionSourceEvent,
} from "./search-machine"

export type CommandPaletteEntry = {
  id: string
  type: "command" | "file" | "session" | "setting"
  title: string
  description?: string
  keywords?: string
  keybind?: string
  category: string
  option?: CommandOption
  path?: string
  directory?: string
  sessionID?: string
  server?: ServerConnection.Key
  project?: LocalProject
  archived?: number
  updated?: number
  setting?: SettingsSearchResult
}

const ENTRY_LIMIT = 5

// The palette opens with these host commands. Featured plugin commands list before the view toggles.
const COMMON_COMMAND_IDS = ["session.new", "workspace.new", "session.previous", "session.next"] as const

const COMMON_VIEW_COMMAND_IDS = ["review.toggle"] as const

export function uniqueCommandPaletteEntries(items: CommandPaletteEntry[]) {
  const seen = new Set<string>()

  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)

    return true
  })
}

export function createCommandPaletteFileEntry(path: string, category: string): CommandPaletteEntry {
  return {
    id: "file:" + path,
    type: "file",
    title: path,
    category,
    path,
  }
}

export function createCommandPaletteFileOpener(onOpenFile?: (path: string) => void) {
  const links = usePluginHost().links
  const attachment = usePluginAttachment()

  return (path: string) => {
    links.open({ href: path, exact: true, background: true, session: attachment.current() })
    onOpenFile?.(path)
  }
}

/** Previews the highlighted command and reverts the preview unless the palette commits to that command. */
export function createPaletteHighlight() {
  let state = INITIAL_PALETTE_HIGHLIGHT_STATE
  let highlighted: CommandPaletteEntry | undefined
  let revert: (() => void) | void

  const dispatch = (event: PaletteHighlightEvent) => {
    const next = transitionPaletteHighlight(state, event)
    state = next.state
    next.effects.forEach((effect) => {
      if (effect.type === "preview.apply") {
        revert = highlighted?.option?.onHighlight?.()

        return
      }

      const cleanup = revert
      revert = undefined
      cleanup?.()
    })
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    highlight(item: CommandPaletteEntry | undefined) {
      highlighted = item
      dispatch({
        type: "highlight.changed",
        entryID: item?.id,
        previewable: item?.type === "command" && !!item.option?.onHighlight,
      })
    },
    select(item: CommandPaletteEntry) {
      dispatch({ type: "entry.selected", entryID: item.id })
    },
  }
}

export function createCommandPaletteModel(props: { filesOnly?: () => boolean; onOpenFile?: (path: string) => void }) {
  const command = useCommand()
  const language = useLanguage()
  const file = useFile()
  const dialog = useDialog()
  const serverSDK = useServerSDK()
  const serverCtx = useServer().ctx
  const appTabs = useTabs()
  const attachment = usePluginAttachment()
  const openFile = createCommandPaletteFileOpener(props.onOpenFile)
  const settings = createSettingsPaletteEntries()
  const preview = createPaletteHighlight()
  const filesOnly = () => props.filesOnly?.() ?? false

  const allowedCommands = createMemo(() => {
    if (filesOnly()) return []

    return commandPaletteOptions(command.options)
  })

  const commandEntries = createMemo(() => {
    const category = language.t("palette.group.commands")

    return allowedCommands().map((option) => createCommandPaletteCommandEntry(option, category))
  })

  const preferredCommandEntries = createMemo(() => {
    const all = allowedCommands()

    const ids = [
      ...COMMON_COMMAND_IDS,
      ...all.flatMap((option) => (option.featured ? [option.id] : [])),
      ...COMMON_VIEW_COMMAND_IDS,
    ]

    const order = new Map<string, number>(ids.map((id, index) => [id, index]))
    const picked = all.filter((option) => order.has(option.id))
    const base = picked.length ? picked : all.slice(0, ENTRY_LIMIT)
    const sorted = picked.length ? [...base].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) : base
    const category = language.t("palette.group.commands")

    return sorted.map((option) => createCommandPaletteCommandEntry(option, category))
  })

  const recentFileEntries = createMemo(() => {
    const all = attachment.files.opened()
    const active = attachment.files.active()
    const order = active ? [active, ...all.filter((path) => path !== active)] : all
    const category = language.t("palette.group.files")

    return order.slice(0, ENTRY_LIMIT).map((path) => createCommandPaletteFileEntry(path, category))
  })

  const rootFileEntries = createMemo(() => {
    const category = language.t("palette.group.files")

    return file.tree
      .children("")
      .filter((node) => node.type === "file")
      .map((node) => node.path)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, ENTRY_LIMIT)
      .map((path) => createCommandPaletteFileEntry(path, category))
  })

  const sessions = createServerSessionEntries({
    server: ServerConnection.key(serverSDK.server),
    known: createKnownServerSessions(() => serverCtx),
    projects: serverCtx.projects.list,
    load: (search, signal) =>
      serverSDK.api.session.list({ parentID: null, search, archived: false, limit: 50 }, { signal }),
    get: (sessionID, signal) => serverSDK.api.session.get({ sessionID }, { signal }),
    untitled: () => language.t("command.session.new"),
    category: () => language.t("command.category.session"),
    recentCategory: () => language.t("palette.group.recentSessions"),
  })

  const select = (item: CommandPaletteEntry | undefined) => {
    if (!item) return
    preview.select(item)
    dialog.close()

    if (item.type === "command") {
      void item.option?.onSelect?.("palette")

      return
    }

    if (item.type === "session") {
      if (!item.sessionID || !item.server) return
      const directory = item.project?.worktree ?? item.directory

      if (directory) serverCtx.projects.touch(directory)

      const tab = appTabs.addSessionTab({
        server: item.server,
        sessionId: item.sessionID,
      })

      appTabs.select(tab)

      return
    }

    if (item.type === "setting") return settings.select(item)

    if (!item.path) return
    openFile(item.path)
  }

  return {
    language,
    file,
    commandEntries,
    preferredCommandEntries,
    recentFileEntries,
    rootFileEntries,
    sessions,
    settings,
    highlight: preview.highlight,
    select,
    close: () => dialog.close(),
  }
}

export function createCommandPaletteCommandEntry(option: CommandOption, category: string): CommandPaletteEntry {
  return {
    id: "command:" + option.id,
    type: "command",
    title: option.title,
    description: option.description,
    keywords: option.keywords,
    keybind: option.keybind,
    category,
    option,
  }
}

export function createServerSessionEntries(props: {
  server: ServerConnection.Key
  archived?: boolean
  known?: () => SessionInfo[]
  /** Hides sessions deleted since they were loaded. */
  apply?: (sessions: SessionInfo[]) => SessionInfo[]
  projects: () => Project[]
  load: (search: string, signal: AbortSignal) => Promise<{ data: SessionInfo[] }>
  get: (sessionID: string, signal: AbortSignal) => Promise<SessionInfo>
  untitled: () => string
  category: () => string
  recentCategory: () => string
  recentLimit?: number
}) {
  const [sourceState, setSourceState] = createSignal(INITIAL_SESSION_SOURCE_STATE)

  const runs = new Map<
    number,
    {
      result: PromiseWithResolvers<CommandPaletteEntry[]>
      timer: ReturnType<typeof setTimeout>
      controller?: AbortController
      unlink?: () => void
    }
  >()

  // Let the newest metadata win duplicates before ranking the merged sessions newest-first.
  const known = createMemo(() => {
    const merged = [
      ...new Map(
        [...(props.known?.() ?? []), ...sourceState().loaded]
          .toSorted((a, b) => a.time.updated - b.time.updated)
          .map((session) => [session.id, session] as const),
      ).values(),
    ].toSorted((a, b) => b.time.updated - a.time.updated)

    return props.apply?.(merged) ?? merged
  })

  const dispatch = (event: SessionSourceEvent) =>
    untrack(() => {
      const previous = sourceState()
      const next = transitionSessionSource(previous, event)

      if (next.state !== previous) setSourceState(next.state)
      next.effects.forEach(run)
    })

  function run(effect: SessionSourceEffect) {
    if (effect.type === "debounce.start") {
      runs.set(effect.attempt, {
        result: Promise.withResolvers(),
        timer: setTimeout(() => dispatch({ type: "debounce.fired", attempt: effect.attempt }), effect.delayMs),
      })

      return
    }

    const current = runs.get(effect.attempt)

    if (!current) return

    if (effect.type === "fetch.start") {
      const controller = new AbortController()
      current.controller = controller
      const search = effect.query
      void Promise.all([
        Promise.try(() => props.load(search, controller.signal)).then(
          (result) => ({ items: result.data, failed: false }),
          () => ({ items: [], failed: true }),
        ),
        looksLikeSessionID(search)
          ? Promise.try(() => props.get(search, controller.signal)).then(
              (result) => [result],
              () => [],
            )
          : Promise.resolve([]),
      ]).then(([listed, exact]) =>
        dispatch(
          listed.failed && exact.length === 0
            ? { type: "fetch.failed", attempt: effect.attempt, error: new Error("Session search failed") }
            : {
                type: "fetch.succeeded",
                attempt: effect.attempt,
                sessions: [
                  ...new Map([...exact, ...listed.items].map((session) => [session.id, session] as const)).values(),
                ],
              },
        ),
      )

      return
    }

    runs.delete(effect.attempt)
    clearTimeout(current.timer)
    current.unlink?.()

    if (effect.type === "attempt.cancel") {
      current.controller?.abort()
      current.result.resolve([])

      return
    }

    // The local collection owns the recent rows, including newly loaded ones.
    if (effect.type === "attempt.resolve")
      return current.result.resolve(effect.query ? entries([...effect.sessions], effect.query) : [])

    current.result.reject(effect.error)
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  const entries = (sessions: SessionInfo[], search: string): CommandPaletteEntry[] => {
    const projects = props.projects()
    const category = search ? props.category() : props.recentCategory()

    return sessions.flatMap((session) => {
      if (!!session.time.archived !== !!props.archived) return []

      const project = projectForSession(session, projects)

      return [
        {
          id: `session:${props.server}:${session.id}`,
          type: "session" as const,
          title: session.title || props.untitled(),
          description: project ? displayName(project) : getFilename(session.location.directory),
          category,
          directory: session.location.directory,
          sessionID: session.id,
          server: props.server,
          project,
          updated: session.time.updated,
        },
      ]
    })
  }

  // A superseded or aborted search answers with no results.
  const search = (text: string, signal?: AbortSignal): Promise<CommandPaletteEntry[]> => {
    if (signal?.aborted) return Promise.resolve([])
    const query = text.trim()

    // Typed searches wait for a pause; an empty query lists recent sessions right away.
    dispatch({ type: "search.requested", query, delayMs: query ? PALETTE_SESSION_DEBOUNCE_MS : 0 })
    const current = untrack(sourceState)
    const started = current.status === "debouncing" ? runs.get(current.attempt) : undefined

    if (current.status !== "debouncing" || !started) return Promise.resolve([])
    const attempt = current.attempt

    if (signal) {
      const abort = () => dispatch({ type: "search.aborted", attempt })
      signal.addEventListener("abort", abort, { once: true })
      started.unlink = () => signal.removeEventListener("abort", abort)
    }

    return started.result.promise
  }

  return Object.assign(search, {
    search,
    items(text: string) {
      const search = text.trim()
      const all = entries(known(), search)

      if (!search) return all.slice(0, props.recentLimit ?? ENTRY_LIMIT)

      return all.filter((entry) => matchesCommandPaletteEntry(entry, search)).slice(0, 50)
    },
  })
}

export function createKnownServerSessions(context: Accessor<ServerCtx | undefined>) {
  const queryClient = useQueryClient()

  return () => {
    const server = context()

    if (!server) return []

    // Reuse the Home index already loaded before opening the palette; do not fetch an index for search.
    const cached =
      queryClient.getQueryData<SessionInfo[]>(["home-sessions", server.sdk.server]) ??
      queryClient.getQueryData<SessionInfo[]>(["home-sessions", ServerConnection.key(server.sdk.server)]) ??
      []

    const merged = new Map([...cached, ...server.data.session.list()].map((session) => [session.id, session] as const))

    return server.data.session.apply(
      [...merged.values()].filter((session) => !session.parentID && !session.time.archived),
    )
  }
}
