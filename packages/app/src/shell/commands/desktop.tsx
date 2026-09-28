import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCommand, type CommandOption } from "./command"
import { useDialog } from "@opencode/ui/context/dialog"
import { DialogSsh } from "@/servers/ssh/dialog"
import { useUpdaterAction } from "@/shell/updates/action"
import { useSettingsSurface } from "@/settings/surface"

export function DesktopCommands() {
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const updater = useUpdaterAction()

  command.register("desktop", () => {
    const commands: CommandOption[] = []
    if (platform.platform === "desktop")
      commands.push({
        id: "app.checkForUpdates",
        title: language.t("desktop.menu.checkForUpdates"),
        hidden: true,
        onSelect: () => void updater.check(),
      })
    if (platform.sshServers)
      commands.push({
        id: "server.ssh.add",
        title: language.t("ssh.add"),
        category: language.t("command.category.server"),
        onSelect: () => void dialog.push(() => <DialogSsh openProject />),
      })
    if (platform.platform !== "desktop" || !platform.exportDebugLogs) return commands
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

export function DesktopPairingCommand() {
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettingsSurface()

  command.register("desktop-pairing", () =>
    platform.platform === "desktop" && platform.pair
      ? [
          {
            id: "server.pair",
            title: language.t("command.server.pair"),
            category: language.t("command.category.server"),
            onSelect: () => settings.open("pairing"),
          },
        ]
      : [],
  )

  return null
}
