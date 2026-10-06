import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Spinner } from "@opencode/ui/spinner"
import { Show } from "solid-js"
import { useExtension, type ServerRow } from "../sdk"
import { isSshConnecting, sshName } from "./name"
import type { SshController } from "./state"

export default function SshRow(props: { row: ServerRow; id: string; ssh: SshController }) {
  const extension = useExtension()
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
                    {extension.t("label")}
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
                  <span class="settings-servers-meta">{extension.t("stage.authentication")}</span>
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
                    <Spinner class="size-3.5" />
                  </Show>
                  {pending() ? extension.t("session.connecting") : extension.t("action.authenticate")}
                </Button>
              </Show>
              <Show when={props.row.default.available() && props.row.default.current()}>
                <Badge>{extension.t("server.default")}</Badge>
              </Show>
              <Menu gutter={4} modal={false} placement="bottom-end">
                <Menu.Trigger
                  as={IconButton}
                  variant="ghost-muted"
                  size="small"
                  icon={<Icon name="outline-dots" />}
                  aria-label={extension.t("common.moreOptions")}
                />
                <Menu.Portal>
                  <Menu.Content>
                    <Menu.Group>
                      <Menu.GroupLabel>{extension.t("server.menu.label")}</Menu.GroupLabel>
                      <props.row.Items />
                      <Show when={props.row.default.available() && !props.row.default.current()}>
                        <Menu.Item onSelect={() => props.row.default.set(true)}>
                          {extension.t("menu.default")}
                        </Menu.Item>
                      </Show>
                      <Show when={props.row.default.available() && props.row.default.current()}>
                        <Menu.Item onSelect={() => props.row.default.set(false)}>
                          {extension.t("menu.defaultRemove")}
                        </Menu.Item>
                      </Show>
                      <Menu.Separator />
                      <Menu.Item onSelect={() => void props.row.remove()}>{extension.t("menu.delete")}</Menu.Item>
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
