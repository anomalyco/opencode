import { Component, For, createEffect, createMemo, createResource } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { Tabs } from "@opencode/ui/tabs"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWidgetsQuery } from "@/runtime/server/widgets"
import { useWidgetGrants, type WidgetCapability } from "@/session/widgets/grants"
import { useMcpToggle } from "@/providers/connect/mcp"
import { pluginLabels } from "@/providers/catalog/plugin"
import { ExternalLink } from "@/runtime/platform/external-link"
import { SettingsList } from "@/settings/list"
import type { SettingsView } from "@/settings/surface"
import "@/settings/settings.css"

interface McpRowItem {
  name: string
  enabled: boolean
}

interface PluginRowItem {
  name: string
}

const WIDGET_LEVELS: readonly WidgetCapability[] = ["read", "write", "full"]

// Widgets available to the whole server, discovered from the global config
// widgets directory. Project-level widgets appear in the project settings view.
const ServerWidgets: Component = () => {
  const language = useLanguage()
  const server = useServerSDK()
  const grants = useWidgetGrants()
  const query = useWidgetsQuery({ key: "server-widgets" })
  const widgets = () => (query.isPending || query.isError ? [] : (query.data?.data ?? []))

  return (
    <div class="settings-section">
      <div class="flex items-center justify-between">
        <span class="settings-extension-heading text-13-medium">
          {language.t("settings.extensions.availableAll")}
        </span>
        <span class="text-13-regular text-v2-text-text-muted">
          {language.t("settings.extensions.manageConfig")}
        </span>
      </div>
      <p class="project-settings-extension-empty-description">{language.t("widgets.access.description")}</p>
      <SettingsList variant="catalog">
        <For each={widgets()}>
          {(widget) => (
            <div class="settings-extension-row">
              <div class="settings-extension-lead">
                <Icon
                  name="widget"
                  class="text-v2-icon-icon-muted shrink-0"
                  classList={{ "text-v2-state-fg-danger": widget.state.status === "failed" }}
                />
                <span class="settings-extension-name truncate">{widget.title}</span>
              </div>
              <div class="flex items-center gap-3">
                <For each={WIDGET_LEVELS}>
                  {(capability) => (
                    <span
                      class="flex items-center gap-1.5"
                      title={language.t(`widgets.access.${capability}.description`)}
                    >
                      <span class="text-11-regular text-v2-text-text-muted">
                        {language.t(`widgets.access.${capability}`)}
                      </span>
                      <Switch
                        checked={grants.granted(server.scope, widget.id).includes(capability)}
                        disabled={!widget.requests.includes(capability) || widget.state.status === "failed"}
                        hideLabel
                        onChange={(checked) => grants.toggle(server.scope, widget.id, capability, checked)}
                      >
                        {language.t(`widgets.access.${capability}`)}
                      </Switch>
                    </span>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </SettingsList>
    </div>
  )
}

export const SettingsExtensions: Component<{
  subtab?: SettingsView["subtab"]
  onSubtab: (value: SettingsView["subtab"]) => void
}> = (props) => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const data = useData()
  const [mcpList, { refetch: refetchMcp }] = createResource(
    () => serverSdk.connection.status() === "connected",
    () => serverSdk.api.mcp.list().then((result) => result.data),
    { initialValue: [] },
  )
  const toggleMcp = useMcpToggle(() => undefined, refetchMcp)
  const mcps = createMemo<McpRowItem[]>(() => {
    return (mcpList.latest ?? []).map((server) => ({
      name: server.name,
      enabled: server.status.status === "connected",
    }))
  })

  const handleMcpToggle = (item: McpRowItem, checked: boolean) => {
    if (item.enabled === checked || toggleMcp.isPending) return
    toggleMcp.mutate(item.name)
  }

  const [pluginList] = createResource(
    () => serverSdk.connection.status() === "connected",
    () => serverSdk.api.plugin.list().then((result) => result.data),
    { initialValue: [] },
  )
  const plugins = createMemo<PluginRowItem[]>(() => pluginLabels(pluginList.latest ?? []).map((name) => ({ name })))

  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.skill.sync().catch(() => undefined)
  })
  const skills = () => data.location.skill.list() ?? []

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.extensions")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.extensions.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <Tabs
          variant="pill"
          value={props.subtab ?? "mcps"}
          onChange={(value) => {
            if (value === "mcps" || value === "plugins" || value === "skills" || value === "widgets")
              props.onSubtab(value)
          }}
          class="settings-extensions-tabs settings-subtabs"
        >
          <Tabs.List>
            <Tabs.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</Tabs.Trigger>
            <Tabs.Trigger value="plugins">{language.t("status.popover.tab.plugins")}</Tabs.Trigger>
            <Tabs.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</Tabs.Trigger>
            <Tabs.Trigger value="widgets">{language.t("project.settings.extensions.tab.widgets")}</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="mcps">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <span class="text-13-regular text-v2-text-text-muted">
                  {language.t("settings.extensions.manageConfig")}
                </span>
              </div>
              <SettingsList variant="catalog">
                <For each={mcps()}>
                  {(item) => (
                    <div class="settings-extension-row">
                      <div class="settings-extension-lead">
                        <Icon name="mcp" class="text-v2-icon-icon-muted shrink-0" />
                        <span class="settings-extension-name truncate">{item.name}</span>
                      </div>
                      <Switch checked={item.enabled} onChange={(checked) => handleMcpToggle(item, checked)} hideLabel>
                        {item.name}
                      </Switch>
                    </div>
                  )}
                </For>
              </SettingsList>
            </div>
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <span class="text-13-regular text-v2-text-text-muted">
                  {language.t("settings.extensions.manageConfig")}
                </span>
              </div>
              <SettingsList variant="catalog">
                <For each={plugins()}>
                  {(plugin) => (
                    <div class="settings-extension-row">
                      <div class="settings-extension-lead">
                        <Icon name="cube" class="text-v2-icon-icon-muted shrink-0" />
                        <span class="settings-extension-name truncate">{plugin.name}</span>
                      </div>
                    </div>
                  )}
                </For>
              </SettingsList>
            </div>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <ExternalLink class="settings-extension-link text-13-regular" href="https://opencode.ai/docs/skills/">
                  {language.t("settings.extensions.addSkills")}
                </ExternalLink>
              </div>
              <SettingsList variant="catalog">
                <For each={skills()}>
                  {(skill) => (
                    <div class="settings-extension-row">
                      <div class="settings-extension-lead">
                        <Icon name="post-skill" class="text-v2-icon-icon-muted shrink-0" />
                        <span class="settings-extension-name truncate">{skill.name}</span>
                      </div>
                    </div>
                  )}
                </For>
              </SettingsList>
            </div>
          </Tabs.Content>
          <Tabs.Content value="widgets">
            <ServerWidgets />
          </Tabs.Content>
        </Tabs>
      </div>
    </>
  )
}