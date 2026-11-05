import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo } from "solid-js"
import { useLanguage, sourceText } from "@/runtime/i18n/language"
import { COMMAND_SEARCH_ID, commandPaletteOptions, useCommand } from "./command"
import { CommandPaletteView, matchesCommandPaletteEntry } from "./dialog"
import { createCommandPaletteCommandEntry, createPaletteHighlight, type CommandPaletteEntry } from "./palette"

/** Search everything, limited to commands. */
export function DialogCommandSearch() {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const preview = createPaletteHighlight()

  const entries = createMemo(() => {
    const category = language.t("palette.group.commands")

    return commandPaletteOptions(command.options)
      .filter((option) => option.id !== COMMAND_SEARCH_ID)
      .map((option) => createCommandPaletteCommandEntry(option, category, sourceText("palette.group.commands")))
  })

  const select = (item: CommandPaletteEntry | undefined) => {
    if (!item) return
    preview.select(item)
    dialog.close()
    void item.option?.onSelect?.("palette")
  }

  return (
    <CommandPaletteView
      placeholder={language.t("command.commands.search")}
      items={(query) => entries().filter((entry) => matchesCommandPaletteEntry(entry, query))}
      sources={[]}
      highlight={preview.highlight}
      select={select}
      close={() => dialog.close()}
    />
  )
}
