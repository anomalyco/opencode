import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSettingsCommand } from "@/settings/command"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"

export function useNewSessionCommands(input: {
  restoreFocus: () => void
  project: {
    empty: () => boolean
    open: () => void
  }
}) {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()

  useSettingsCommand()
  command.register("new-session", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const { DialogCommandPalette } = await import("@/shell/commands/dialog")
        void dialog.show(() => <DialogCommandPalette />)
      },
    },
    {
      id: "input.focus",
      title: language.t("command.input.focus"),
      category: language.t("command.category.view"),
      keybind: "ctrl+l",
      onSelect: input.restoreFocus,
    },
    {
      id: "project.select",
      title: language.t("session.new.project.search"),
      category: language.t("command.category.project"),
      keybind: "mod+shift+o",
      disabled: input.project.empty(),
      onSelect: input.project.open,
    },
  ])
}
