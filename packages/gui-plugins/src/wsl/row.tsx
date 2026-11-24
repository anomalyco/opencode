import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { createMemo, Show } from "solid-js"
import { usePlugin, type IpcClient, type ServerRow } from "@opencode/plugin/gui"
import type { Wsl, WslServersState } from "./contract"
import { wslRowView } from "./row-view"

export default function WslRow(props: {
  row: ServerRow
  distro: string
  state: () => WslServersState | undefined
  api: () => IpcClient<(typeof Wsl)["spec"]> | undefined
  run: (action: () => Promise<void>) => void
}) {
  const plugin = usePlugin()
  const view = createMemo(() => wslRowView(props.state(), props.distro))

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
                  {plugin.t("server.label")}
                </span>
              </span>
              <span class="settings-servers-meta">
                <Show when={view().version}>{(version) => `v${version()}`}</Show>
              </span>
            </div>
          </div>
          <div class="settings-servers-actions">
            <Show when={view().button}>
              {(button) => (
                <Button
                  size="small"
                  disabled={button().disabled}
                  onClick={() => props.run(() => api().installOpencode({ name: props.distro }))}
                >
                  {plugin.t(button().label)}
                </Button>
              )}
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
                    <Menu.Item disabled={!view().removable} onSelect={() => props.run(() => props.row.remove())}>
                      {plugin.t("menu.remove")}
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
