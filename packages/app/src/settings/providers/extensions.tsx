import { Component, For, createEffect, createMemo, createResource } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useMcpToggle } from "@/providers/connect/mcp"
import { pluginLabel } from "@/providers/catalog/plugin"
import { ExternalLink } from "@/runtime/platform/external-link"
import { InlineServerSelect } from "@/settings/server-select"
import "@/settings/settings.css"

interface McpRowItem {
  name: string
  enabled: boolean
}

interface PluginRowItem {
  name: string
}

export const SettingsExtensions: Component = () => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const data = useData()
  const [mcpList, { refetch: refetchMcp }] = createResource(
    () => serverSdk.connection.status() === "connected",
    () => serverSdk.api.mcp.list().then((result) => result.data),
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
  )
  const plugins = createMemo<PluginRowItem[]>(() =>
    (pluginList.latest ?? []).map((item) => ({ name: pluginLabel(item) })),
  )

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
          <InlineServerSelect />
        </div>
      </div>

      <div class="settings-tab-body">
        <Tabs variant="pill" defaultValue="mcps" class="settings-extensions-tabs">
          <Tabs.List>
            <Tabs.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</Tabs.Trigger>
            <Tabs.Trigger value="plugins">{language.t("status.popover.tab.plugins")}</Tabs.Trigger>
            <Tabs.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="mcps">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="text-13-medium text-v2-text-text-base">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <span class="text-13-regular text-v2-text-faint">{language.t("settings.extensions.manageConfig")}</span>
              </div>
              <div class="bg-[var(--v2-background-bg-base)] border-[0.5px] border-[var(--v2-border-border-base)] rounded-[8px] pl-4 pr-3 overflow-hidden">
                <For each={mcps()}>
                  {(item) => (
                    <div class="py-4 flex items-center justify-between border-b-[0.5px] border-[var(--v2-border-border-base)] last:border-b-0">
                      <div class="flex items-center gap-2.5 min-w-0">
                        <Icon name="mcp" class="text-v2-icon-icon-muted shrink-0" />
                        <span class="text-13-medium text-v2-text-text-base truncate">{item.name}</span>
                      </div>
                      <Switch checked={item.enabled} onChange={(checked) => handleMcpToggle(item, checked)} hideLabel>
                        {item.name}
                      </Switch>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="text-13-medium text-v2-text-text-base">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <span class="text-13-regular text-v2-text-faint">{language.t("settings.extensions.manageConfig")}</span>
              </div>
              <div class="bg-[var(--v2-background-bg-base)] border-[0.5px] border-[var(--v2-border-border-base)] rounded-[8px] pl-4 pr-3 overflow-hidden">
                <For each={plugins()}>
                  {(plugin) => (
                    <div class="py-4 flex items-center justify-between border-b-[0.5px] border-[var(--v2-border-border-base)] last:border-b-0">
                      <div class="flex items-center gap-2.5 min-w-0">
                        <Icon name="cube" class="text-v2-icon-icon-muted shrink-0" />
                        <span class="text-13-medium text-v2-text-text-base truncate font-mono">{plugin.name}</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="text-13-medium text-v2-text-text-base">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <ExternalLink
                  class="text-13-regular text-v2-text-accent hover:underline"
                  href="https://opencode.ai/docs/skills/"
                >
                  {language.t("settings.extensions.addSkills")}
                </ExternalLink>
              </div>
              <div class="bg-[var(--v2-background-bg-base)] border-[0.5px] border-[var(--v2-border-border-base)] rounded-[8px] pl-4 pr-3 overflow-hidden">
                <For each={skills()}>
                  {(skill) => (
                    <div class="py-4 flex items-center justify-between border-b-[0.5px] border-[var(--v2-border-border-base)] last:border-b-0">
                      <div class="flex items-center gap-2.5 min-w-0">
                        <Icon name="post-skill" class="text-v2-icon-icon-muted shrink-0" />
                        <span class="text-13-medium text-v2-text-text-base truncate">{skill.name}</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </>
  )
}
