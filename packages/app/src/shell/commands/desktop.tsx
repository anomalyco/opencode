import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCommand, type CommandOption } from "./command"

export function DesktopCommands() {
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()

  command.register("desktop", () => {
    const commands: CommandOption[] = []
    if (platform.platform !== "desktop") return commands
    commands.push({
      id: "window.new",
      title: language.t("desktop.menu.newWindow"),
      keybind: "mod+shift+n",
      hidden: true,
      onSelect: () => void platform.runDesktopMenuAction?.("window.new"),
    })
    if (platform.exportDebugLogs)
      commands.push({
        id: "logs.export",
        title: language.t("command.logs.export"),
        category: language.t("command.category.settings"),
        onSelect: () => void platform.exportDebugLogs?.(),
      })
    return commands
  })

  return null
}
