import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSettingsCommand } from "@/components/settings-dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useProviders } from "@/hooks/use-providers"

export function createNewSessionCommandController(input: {
  restoreFocus: () => void
  project: {
    empty: () => boolean
    open: () => void
  }
}) {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const serverSync = useServerSync()
  const providers = useProviders(() => sdk().directory)

  useSettingsCommand()
  command.register("new-session", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const { DialogSelectFile } = await import("@/components/dialog-select-file")
        void dialog.show(() => <DialogSelectFile />)
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

  return {
    provider: {
      ready: () => serverSync().child(sdk().directory)[0].provider_ready,
      connected: () => providers.paid().length > 0,
      open: () => {
        void import("@/components/dialog-connect-provider").then(({ DialogConnectProvider }) => {
          void dialog.show(() => <DialogConnectProvider directory={() => sdk().directory} />)
        })
      },
    },
  }
}

export type NewSessionCommandController = ReturnType<typeof createNewSessionCommandController>
