import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { DialogAddSshServer } from "@/ssh/dialog-add-server"
import { DialogAddWslServer } from "@/wsl/dialog-add-server"

export function AddServerMenu(props: { onAddServer: () => void }) {
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const openAddWsl = () => {
    dialog.push(() => <DialogAddWslServer />)
  }
  const openAddSsh = () => {
    dialog.push(() => <DialogAddSshServer />)
  }
  return (
    <Show
      when={platform.wslServers || platform.sshServers}
      fallback={
        <ButtonV2 variant="ghost-muted" icon="plus" onClick={props.onAddServer}>
          {language.t("dialog.server.add.button")}
        </ButtonV2>
      }
    >
      <MenuV2 gutter={4} modal={false} placement="bottom-end">
        <MenuV2.Trigger as={ButtonV2} variant="ghost-muted" icon="plus">
          {language.t("dialog.server.add.button")}
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <MenuV2.Item onSelect={props.onAddServer}>{language.t("dialog.server.add.button")}</MenuV2.Item>
            <Show when={platform.sshServers}>
              <MenuV2.Item onSelect={openAddSsh}>{language.t("ssh.server.add")}</MenuV2.Item>
            </Show>
            <Show when={platform.wslServers}>
              <MenuV2.Item onSelect={openAddWsl}>{language.t("wsl.server.add")}</MenuV2.Item>
            </Show>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </Show>
  )
}
