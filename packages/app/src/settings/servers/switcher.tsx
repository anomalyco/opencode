import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { ServerLabel } from "@/servers/registry/label"
import { useSettingsSurface } from "@/settings/surface"
import { useSettingsServers, type SettingsServer } from "./inventory"
import { isSettingsServerUnreachable, selectSettingsServerHealth } from "./machine"

/** Chooses the server per-server pages show; renders nothing with one server. */
export function SettingsServerSwitcher() {
  const language = useLanguage()
  const surface = useSettingsSurface()
  const servers = useSettingsServers()

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
            <ServerDot server={selected()} />
            <span class="settings-server-switcher-label">{language.t("settings.server.switcher.label")}</span>
            <ServerLabel class="settings-server-switcher-name" server={selected().connection} name={selected().name} />
            <Icon name="chevron-down" class="settings-server-switcher-chevron" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content class="settings-server-switcher-menu">
              <Menu.RadioGroup value={selected().key} onChange={(key) => surface.selectServer(key)}>
                <For each={servers()}>
                  {(server) => (
                    <Menu.RadioItem value={server.key} closeOnSelect>
                      <ServerDot server={server} />
                      <ServerLabel
                        class="settings-server-switcher-option"
                        server={server.connection}
                        name={server.name}
                        hint
                      />
                      <Show when={isSettingsServerUnreachable(server.availability)}>
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

function ServerDot(props: { server: SettingsServer }) {
  return (
    <span class="settings-server-switcher-icon">
      <ServerHealthIndicator health={selectSettingsServerHealth(props.server.availability)} />
    </span>
  )
}
