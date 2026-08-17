import { createMemo } from "solid-js"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { type DialogContext } from "../ui/dialog"
import { COMMAND_PALETTE_COMMAND, Keymap, type KeymapCommand } from "../context/keymap"
import { DialogConfig, settingID, settings } from "./dialog-config"

function isSuggestedPaletteCommand(command: KeymapCommand) {
  const suggested = command.suggested
  if (typeof suggested === "boolean") return suggested
  if (typeof suggested === "function") return suggested() === true
  return false
}

export function CommandPaletteDialog() {
  const commands = Keymap.useCommands()
  const shortcuts = Keymap.useShortcuts()
  const options = createMemo(() =>
    commands().flatMap((command) => {
      if (!command.id || !command.palette || command.id === COMMAND_PALETTE_COMMAND) return []
      const footer = shortcuts.all(command.id)
      return {
        title: command.title ?? command.id,
        description: command.description,
        category: command.group,
        searchText: [command.id, command.description].filter(Boolean).join(" "),
        searchFooter: [command.group, footer].filter(Boolean).join(" · "),
        footer,
        value: command.id,
        suggested: isSuggestedPaletteCommand(command),
        onSelect: (dialog: DialogContext) => {
          dialog.clear()
          command.run()
        },
      }
    }),
  )
  const settingOptions = settings.map((setting) => ({
    title: setting.title,
    category: setting.category,
    searchText: setting.keywords?.join(" "),
    searchFooter: `Settings · ${setting.category}`,
    value: `setting:${settingID(setting)}`,
    onSelect: (dialog: DialogContext) => {
      dialog.replace(() => <DialogConfig current={settingID(setting)} />)
    },
  }))

  let ref: DialogSelectRef<string>
  const list = () => {
    if (ref?.filter) return [...options(), ...settingOptions]
    return [
      ...options()
        .filter((option) => option.suggested)
        .map((option) => ({
          ...option,
          value: `suggested:${option.value}`,
          category: "Suggested",
        })),
      ...options(),
    ]
  }

  return (
    <DialogSelect ref={(value) => (ref = value)} title="Commands" options={list()} flat={true} filterThreshold={0.7} />
  )
}
