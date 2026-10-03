import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Show } from "solid-js"
import { useExtension, type RemoteClient, type ServerRow } from "../sdk"
import type { Wsl, WslServersState } from "./contract"
import { wslOpencodeAction } from "./model"

export default function WslRow(props: {
  row: ServerRow
  distro: string
  state: () => WslServersState | undefined
  api: () => RemoteClient<(typeof Wsl)["spec"]> | undefined
  pending: (key: string) => boolean
  request: (key: string, action: () => Promise<unknown>) => void
}) {
  const extension = useExtension()
  const check = () => props.state()?.opencodeChecks[props.distro]
  const opencodeAction = () => wslOpencodeAction(check())
  const busy = () => {
    const job = props.state()?.job
    return job?.kind === "install-opencode" && job.distro === props.distro
  }
  return (
    <Show when={props.api()}>
      {(api) => (
        <div class="settings-servers-row">
          <div class="settings-servers-lead">
            <props.row.Indicator health={props.row.health()} />
            <div class="settings-servers-copy">
              <span class="flex min-w-0 items-center gap-1">
                <span class="settings-servers-name">{props.distro}</span>
                <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
                  {extension.t("server.label")}
                </span>
              </span>
              <span class="settings-servers-meta">
                <Show when={check()?.version}>{(version) => `v${version()}`}</Show>
              </span>
            </div>
          </div>
          <div class="settings-servers-actions">
            <Show when={props.row.default.available() && props.row.default.current()}>
              <Badge>{extension.t("server.default")}</Badge>
            </Show>
            <Show when={opencodeAction()}>
              {(label) => (
                <Button
                  size="small"
                  disabled={busy() || props.pending(props.row.key)}
                  onClick={() => props.request(props.row.key, () => api().installOpencode({ name: props.distro }))}
                >
                  {busy() ? extension.t("server.updating") : extension.t(label())}
                </Button>
              )}
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
                      <Menu.Item onSelect={() => props.row.default.set(true)}>{extension.t("menu.default")}</Menu.Item>
                    </Show>
                    <Show when={props.row.default.available() && props.row.default.current()}>
                      <Menu.Item onSelect={() => props.row.default.set(false)}>
                        {extension.t("menu.defaultRemove")}
                      </Menu.Item>
                    </Show>
                    <Menu.Separator />
                    <Menu.Item
                      disabled={props.pending(props.row.key)}
                      onSelect={() => props.request(props.row.key, () => props.row.remove())}
                    >
                      {extension.t("menu.remove")}
                    </Menu.Item>
                  </Menu.Group>
                </Menu.Content>
              </Menu.Portal>
            </Menu>
          </div>
        </div>
      )}
    </Show>
  )
}
