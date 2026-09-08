import { Plugin } from "@opencode/plugin/desktop"
import { Panel, NativeSurface } from "@opencode/plugin/desktop/solid"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { Switch } from "@opencode/ui/switch"
import { Stack, SettingsRow } from "@opencode/ui/layout"
import { For, Show } from "solid-js"
import { createBrowser } from "./model"
import { BrowserToolbar } from "./toolbar"

export default Plugin.define({
  id: "opencode.browser",
  name: "session.tab.browser",
  main: true,
  setup(ctx) {
    if (!ctx.app.native) return
    const [settings, setSettings] = ctx.storage.store("settings", { initial: { enabled: false } })
    const browser = createBrowser(ctx, () => settings.enabled)
    ctx.ui.slot({
      append: "settings.experimental",
      render: () => (
        <SettingsRow
          title={ctx.i18n.t("settings.general.row.browserPane.title")}
          description={ctx.i18n.t("settings.general.row.browserPane.description")}
        >
          <Switch
            checked={settings.enabled}
            onChange={(enabled) =>
              setSettings((settings) => {
                settings.enabled = enabled
              })
            }
            hideLabel
          >
            {ctx.i18n.t("settings.general.row.browserPane.title")}
          </Switch>
        </SettingsRow>
      ),
    })
    ctx.ui.slot({
      append: "session.panel.actions",
      when: () => {
        const session = ctx.sessions.current()
        return !!session && browser.available(session)
      },
      render: ({ session }) => (
        <Menu.Item onSelect={() => browser.open(session)}>
          <Icon name="window-cursor" size="small" />
          {ctx.i18n.t("session.tab.browser")}
        </Menu.Item>
      ),
    })
    ctx.ui.slot({
      append: "session.panel",
      when: () => settings.enabled,
      render: ({ session }) => (
        <For each={browser.tabs(session)}>
          {(tab) => (
            <Panel
              id={tab.id}
              title={tab.title || ctx.i18n.t("session.tab.browser")}
              icon={<Icon name="window-cursor" size="small" />}
              loading={tab.loading}
              onClose={() => browser.close(session, tab.id)}
              onSelect={() => browser.focus(session, tab.id)}
            >
              <Stack>
                <BrowserToolbar
                  context={ctx}
                  tab={tab}
                  error={browser.state(session)?.error}
                  command={(action) => browser.command(session, action)}
                />
                <Show when={browser.state(session)?.surfaces[tab.id]}>{(id) => <NativeSurface id={id()} />}</Show>
              </Stack>
            </Panel>
          )}
        </For>
      ),
    })
  },
})
