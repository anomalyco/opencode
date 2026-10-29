import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import type { ServerHealth } from "@/runtime/server/health"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { ServerLabel } from "@/servers/registry/label"
import { useSettingsSurface } from "@/settings/surface"
import { settingsServerReachable, useSettingsServers, type SettingsServer } from "./inventory"

/** Chooses the server per-server pages show; renders nothing with one server. */
export function SettingsServerSwitcher() {
  const language = useLanguage()
  const global = useGlobal()
  const surface = useSettingsSurface()
  const servers = useSettingsServers()
  const health = (server: SettingsServer) => global.servers.health[server.key]
  const unreachable = (server: SettingsServer) => !settingsServerReachable(server, health(server))

  return (
    <Show when={servers().length > 1 && surface.server()}>
      {(selected) => (
        <Menu placement="bottom-end" gutter={6} modal={false}>
          <Menu.Trigger
            as={Button}
            size="small"
            variant="outline"
            class="settings-server-switcher"
            data-action="settings-server-select"
          >
            <ServerDot health={health(selected())} unreachable={unreachable(selected())} />
            <span class="settings-server-switcher-label">{language.t("settings.server.switcher.label")}</span>
            <ServerLabel
              class="settings-server-switcher-name"
              server={selected().connection}
              name={selected().name}
            />
            <Icon name="chevron-down" class="settings-server-switcher-chevron" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content class="settings-server-switcher-menu">
              <Menu.RadioGroup value={selected().key} onChange={(key) => surface.selectServer(key)}>
                <For each={servers()}>
                  {(server) => (
                    <Menu.RadioItem value={server.key} closeOnSelect>
                      <ServerDot health={health(server)} unreachable={unreachable(server)} />
                      <ServerLabel class="settings-server-switcher-option" server={server.connection} name={server.name} hint />
                      <Show when={unreachable(server)}>
                        <span class="settings-server-switcher-status">
                          {language.t("settings.server.switcher.unreachable")}
                        </span>
                      </Show>
                    </Menu.RadioItem>
                  )}
                </For>
              </Menu.RadioGroup>
              <Menu.Separator />
              <Menu.Item onSelect={() => surface.select("servers")}>
                <span class="settings-server-switcher-icon">
                  <Icon name="server" />
                </span>
                {language.t("settings.server.switcher.manage")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      )}
    </Show>
  )
}

function ServerDot(props: { health: ServerHealth | undefined; unreachable: boolean }) {
  const health = () => props.health ?? (props.unreachable ? { healthy: false } : undefined)

  return (
    <span class="settings-server-switcher-icon">
      <ServerHealthIndicator health={health()} authenticationRequired={!!health()?.unauthorized} />
    </span>
  )
}
