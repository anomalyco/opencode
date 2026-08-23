import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, onCleanup } from "solid-js"
import { commandPaletteOptions, useCommand } from "@/shell/commands/command"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import {
  createCommandPaletteCommandEntry,
  createServerSessionEntries,
  type CommandPaletteEntry,
} from "@/shell/commands/palette"
import { CommandPaletteView, matchesCommandPaletteEntry } from "@/shell/commands/dialog"

export function HomeCommandPalette(props: {
  server: ServerConnection.Any
  onSelectSession: (entry: CommandPaletteEntry) => void
}) {
  const command = useCommand()
  const dialog = useDialog()
  const global = useGlobal()
  const language = useLanguage()
  const server = global.ensureServerCtx(props.server)
  const state = { cleanup: undefined as (() => void) | void, committed: false }
  const commandEntries = createMemo(() => {
    const category = language.t("palette.group.commands")
    return commandPaletteOptions(command.options).map((option) => createCommandPaletteCommandEntry(option, category))
  })
  const sessions = createServerSessionEntries({
    server: ServerConnection.key(props.server),
    opened: server.projects.list,
    stored: () => server.sync.data.project,
    load: (search, signal) => server.sdk.api.session.list({ parentID: null, search, limit: 50 }, { signal }),
    get: (sessionID, signal) => server.sdk.api.session.get({ sessionID }, { signal }),
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
      item.option?.onSelect?.("palette")
      return
    }
    if (item.type === "session") props.onSelectSession(item)
  }
  const loadItems = async (text: string) => {
    const query = text.trim()
    if (!query) return commandEntries().slice(0, 5)
    return [...commandEntries().filter((entry) => matchesCommandPaletteEntry(entry, query)), ...(await sessions(query))]
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

  return (
    <CommandPaletteView
      placeholder={language.t("palette.search.placeholder.home")}
      loadItems={loadItems}
      highlight={highlight}
      select={select}
      close={() => dialog.close()}
    />
  )
}
