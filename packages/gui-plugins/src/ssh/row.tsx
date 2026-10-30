import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Loader } from "@opencode/ui/loader"
import { Show } from "solid-js"
import { usePlugin, type ServerRow } from "@opencode/plugin/gui"
import { isSshConnecting, sshName } from "./name"
import type { SshController } from "./state"

export default function SshRow(props: { row: ServerRow; id: string; ssh: SshController }) {
  const plugin = usePlugin()
  const pending = () => props.ssh.pending(props.id)

  return (
    <Show when={props.ssh.item(props.id)}>
      {(item) => {
        const indicator = () => {
          if (item().stage === "ready") return props.row.health() ?? { healthy: true }

          if (item().stage === "incompatible") return { healthy: false, incompatible: true }

          if (item().stage === "failed") return { healthy: false }

          return undefined
        }

        return (
          <div class="settings-servers-row">
            <div class="settings-servers-lead">
              <props.row.Indicator
                health={indicator()}
                connecting={isSshConnecting(item().stage)}
                auth={item().stage === "authentication"}
              />
              <div class="settings-servers-copy">
                <span class="flex min-w-0 items-center gap-1">
                  <bdi class="settings-servers-name truncate" dir={item().config.name ? "auto" : "ltr"}>
                    {sshName(item().config)}
                  </bdi>
                  <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
                    {plugin.t("label")}
                  </span>
                </span>
                <Show
                  when={item().stage === "authentication"}
                  fallback={
                    <Show when={props.row.health()?.version}>
                      {(version) => <span class="settings-servers-meta">v{version()}</span>}
                    </Show>
                  }
                >
                  <span class="settings-servers-meta">{plugin.t("stage.authentication")}</span>
                </Show>
              </div>
            </div>
            <div class="settings-servers-actions">
              <Show when={item().stage === "authentication" || pending()}>
                <Button
                  size="small"
                  variant="ghost-muted"
                  disabled={pending()}
                  aria-busy={pending()}
                  onClick={() => props.ssh.connect(item().config)}
                >
                  <Show when={pending()}>
                    <Loader class="size-3.5" />
                  </Show>
                  {pending() ? plugin.t("session.connecting") : plugin.t("action.authenticate")}
                </Button>
              </Show>
              <Menu gutter={4} modal={false} placement="bottom-end">
                <Menu.Trigger
                  as={IconButton}
                  variant="ghost-muted"
                  size="small"
                  icon={<Icon name="outline-dots" />}
                  aria-label={plugin.t("common.moreOptions")}
                />
                <Menu.Portal>
                  <Menu.Content>
                    <Menu.Group>
                      <Menu.GroupLabel>{plugin.t("server.menu.label")}</Menu.GroupLabel>
                      <props.row.Items />
                      <Menu.Separator />
                      <Menu.Item onSelect={() => void props.row.remove()}>{plugin.t("menu.delete")}</Menu.Item>
                    </Menu.Group>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            </div>
          </div>
        )
      }}
    </Show>
  )
}
