import { getFilename } from "@opencode/util/path"
import type { Project } from "@/runtime/server/types"
import type { SessionInfo } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, onCleanup } from "solid-js"
import { commandPaletteOptions, useCommand, type CommandOption } from "@/shell/commands/command"
import { useFile } from "@/workspaces/files/model"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import type { LocalProject } from "@/shell/state/layout"
import { ServerConnection } from "@/runtime/server/registry"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { displayName } from "@opencode/ui/project-avatar"
import { resolveProjectForSession } from "@/shell/layout/helpers"
import { useExtensionHost } from "@/runtime/extension/host"
import { useExtensionAttachment } from "@/runtime/extension/services"
import { looksLikeSessionID } from "@/session/search"

export type CommandPaletteEntry = {
  id: string
  type: "command" | "file" | "session"
  title: string
  description?: string
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
}

const ENTRY_LIMIT = 5
// The palette opens with these host commands. Featured extension commands list before the view toggles.
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
  const links = useExtensionHost().links
  const extensions = useExtensionAttachment()

  return (path: string) => {
    links.open({ href: path, exact: true, background: true, session: extensions.current() })
    onOpenFile?.(path)
  }
}

export function createCommandPaletteModel(props: { filesOnly?: () => boolean; onOpenFile?: (path: string) => void }) {
  const command = useCommand()
  const global = useGlobal()
  const language = useLanguage()
  const file = useFile()
  const dialog = useDialog()
  const serverSDK = useServerSDK()
  const serverCtx = global.ensureServerCtx(serverSDK.server)
  const appTabs = useTabs()
  const extensions = useExtensionAttachment()
  const openFile = createCommandPaletteFileOpener(props.onOpenFile)
  const state = { cleanup: undefined as (() => void) | void, committed: false }
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
    const all = extensions.files.opened()
    const active = extensions.files.active()
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
    opened: serverCtx.projects.list,
    stored: () => serverCtx.sync.data.project,
    load: (search, signal) => serverSDK.api.session.list({ parentID: null, search, limit: 50 }, { signal }),
    get: (sessionID, signal) => serverSDK.api.session.get({ sessionID }, { signal }),
    untitled: () => language.t("command.session.new"),
    category: () => language.t("command.category.session"),
  })

  const highlight = (item: CommandPaletteEntry | undefined) => {
    state.cleanup?.()
    state.cleanup = undefined
    if (item?.type !== "command") return
    state.cleanup = item.option?.onHighlight?.()
  }

  const select = (item: CommandPaletteEntry | undefined) => {
    if (!item) return
    state.committed = true
    state.cleanup = undefined
    dialog.close()
    if (item.type === "command") {
      void item.option?.onSelect?.("palette")
      return
    }
    if (item.type === "session") {
      if (!item.sessionID || !item.server) return
      const directory = item.project?.worktree ?? item.directory
      if (directory) {
        serverCtx.projects.open(directory)
        serverCtx.projects.touch(directory)
      }
      const tab = appTabs.addSessionTab({
        server: item.server,
        sessionId: item.sessionID,
      })
      appTabs.select(tab)
      return
    }
    if (!item.path) return
    openFile(item.path)
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

  return {
    language,
    file,
    commandEntries,
    preferredCommandEntries,
    recentFileEntries,
    rootFileEntries,
    sessions,
    highlight,
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
    keybind: option.keybind,
    category,
    option,
  }
}

export function createServerSessionEntries(props: {
  server: ServerConnection.Key
  opened: () => LocalProject[]
  stored: () => Project[]
  load: (search: string, signal: AbortSignal) => Promise<{ data: SessionInfo[] }>
  get: (sessionID: string, signal: AbortSignal) => Promise<SessionInfo>
  untitled: () => string
  category: () => string
}) {
  let abort: AbortController | undefined

  onCleanup(() => abort?.abort())

  return async (text: string): Promise<CommandPaletteEntry[]> => {
    const search = text.trim()
    if (!search) {
      abort?.abort()
      return []
    }
    abort?.abort()
    const current = new AbortController()
    abort = current
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 100)
      current.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })
    if (current.signal.aborted) return []
    const opened = props.opened()
    const stored = props.stored().map((project) => ({ ...project, expanded: false }))
    return Promise.all([
      props.load(search, current.signal).then(
        (result) => result.data,
        () => [],
      ),
      looksLikeSessionID(search)
        ? props.get(search, current.signal).then(
            (result) => [result],
            () => [],
          )
        : Promise.resolve([]),
    ]).then(([listed, exact]) =>
      [...new Map([...exact, ...listed].map((session) => [session.id, session] as const)).values()]
        .filter((session) => !session.time.archived)
        .map((session) => {
          const project = resolveProjectForSession(session, opened, stored)
          return {
            id: `session:${props.server}:${session.id}`,
            type: "session" as const,
            title: session.title || props.untitled(),
            description: project ? displayName(project) : getFilename(session.location.directory),
            category: props.category(),
            directory: session.location.directory,
            sessionID: session.id,
            server: props.server,
            project,
            updated: session.time.updated,
          }
        }),
    )
  }
}
