import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { COMMAND_SEARCH_ID, commandPaletteOptions, useCommand } from "./command"
import { CommandPaletteView, matchesCommandPaletteEntry } from "./dialog"
import { createCommandPaletteCommandEntry, type CommandPaletteEntry, type PaletteHighlight } from "./palette"

/** Search everything, limited to commands. */
export function DialogCommandSearch() {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const state: PaletteHighlight = { cleanup: undefined, committed: false }

  const entries = createMemo(() => {
    const category = language.t("palette.group.commands")

    return commandPaletteOptions(command.options)
      .filter((option) => option.id !== COMMAND_SEARCH_ID)
      .map((option) => createCommandPaletteCommandEntry(option, category))
  })

  const highlight = (item: CommandPaletteEntry | undefined) => {
    state.cleanup?.()
    state.cleanup = item?.option?.onHighlight?.()
  }

  const select = (item: CommandPaletteEntry | undefined) => {
    if (!item) return
    state.committed = true
    state.cleanup = undefined
    dialog.close()
    void item.option?.onSelect?.("palette")
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

  return (
    <CommandPaletteView
      placeholder={language.t("command.commands.search")}
      items={(query) => entries().filter((entry) => matchesCommandPaletteEntry(entry, query))}
      sources={[]}
      highlight={highlight}
      select={select}
      close={() => dialog.close()}
    />
  )
}
