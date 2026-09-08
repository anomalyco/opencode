import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { ServerActionsController } from "@/servers/registry/controller"
import { ServerConnection } from "@/runtime/server/registry"
import { useSshServers } from "./context"
import { useSshReconnect } from "./reconnect"

export function SshMenu(props: { id: string; domain: ServerActionsController }) {
  const ssh = useSshServers()
  const language = useLanguage()
  const reconnect = useSshReconnect()
  const item = () => ssh.data?.servers.find((item) => item.config.id === props.id)
  const key = () => ServerConnection.Key.make(`ssh:${props.id}`)
  return (
    <Show when={item()}>
      {(item) => (
        <Menu gutter={4} modal={false} placement="bottom-end">
          <Menu.Trigger
            as={IconButton}
            variant="ghost-muted"
            size="small"
            icon={<Icon name="outline-dots" />}
            aria-label={language.t("common.moreOptions")}
          />
          <Menu.Portal>
            <Menu.Content>
              <Menu.Group>
                <Menu.GroupLabel>{language.t("ssh.server.menu.label")}</Menu.GroupLabel>
                <Show when={item().stage !== "ready"}>
                  <Menu.Item disabled={reconnect.pending(props.id)} onSelect={() => reconnect.start(item().config)}>
                    {language.t(item().stage === "authentication" ? "ssh.authenticate" : "ssh.connect")}
                  </Menu.Item>
                </Show>
                <Show when={props.domain.defaults.available() && props.domain.defaults.key() !== key()}>
                  <Menu.Item onSelect={() => props.domain.defaults.set(key())}>
                    {language.t("dialog.server.menu.default")}
                  </Menu.Item>
                </Show>
                <Show when={props.domain.defaults.available() && props.domain.defaults.key() === key()}>
                  <Menu.Item onSelect={() => props.domain.defaults.set(null)}>
                    {language.t("dialog.server.menu.defaultRemove")}
                  </Menu.Item>
                </Show>
                <Menu.Separator />
                <Menu.Item onSelect={() => void props.domain.connection.remove(key())}>
                  {language.t("dialog.server.menu.delete")}
                </Menu.Item>
              </Menu.Group>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      )}
    </Show>
  )
}
