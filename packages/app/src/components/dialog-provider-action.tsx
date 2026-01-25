import { Component } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"

interface DialogProviderActionProps {
  provider: string
  providerName: string
}

export const DialogProviderAction: Component<DialogProviderActionProps> = (props) => {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const actions = () => [
    {
      id: "disconnect",
      label: language.t("dialog.provider.action.disconnect"),
      icon: "close" as const,
    },
    {
      id: "reconnect",
      label: language.t("dialog.provider.action.reconnect"),
      icon: "plus" as const,
    },
  ]

  async function handleSelect(action: { id: string } | undefined) {
    if (!action) return
    if (action.id === "disconnect") {
      await globalSDK.client.auth.remove({ providerID: props.provider })
      await globalSDK.client.global.dispose()
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.provider.toast.disconnected.title", { provider: props.providerName }),
        description: language.t("dialog.provider.toast.disconnected.description", { provider: props.providerName }),
      })
    } else if (action.id === "reconnect") {
      dialog.show(() => <DialogConnectProvider provider={props.provider} />)
    }
  }

  return (
    <Dialog title={props.providerName}>
      <List items={actions} key={(x) => x?.id} onSelect={handleSelect}>
        {(item) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <Icon data-slot="list-item-extra-icon" name={item.icon} />
            <span>{item.label}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
