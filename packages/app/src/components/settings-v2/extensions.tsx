import { Component, For, createMemo, createResource } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { ExternalLink } from "../external-link"
import { InlineServerSelect } from "./parts/server-select"
import "./settings-v2.css"

interface McpRowItem {
  name: string
  enabled: boolean
}

interface PluginRowItem {
  name: string
}

export const SettingsExtensionsV2: Component = () => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const mcps = createMemo<McpRowItem[]>(() => {
    const configMcp = serverSync.data.config.mcp ?? {}
    return Object.entries(configMcp).map(([name, config]) => ({
      name,
      enabled: typeof config !== "object" || config === null || !("enabled" in config) || config.enabled !== false,
    }))
  })

  const handleMcpToggle = (item: McpRowItem, checked: boolean) => {
    const before = serverSync.data.config.mcp ?? {}
    const config = before[item.name]
    if (typeof config !== "object" || config === null) return
    const next = { ...before, [item.name]: { ...config, enabled: checked } }
    serverSync.set("config", "mcp", next)
    void serverSync.updateConfig({ mcp: next }).catch(() => serverSync.set("config", "mcp", before))
  }

  const plugins = createMemo<PluginRowItem[]>(() => {
    const raw = serverSync.data.config.plugin ?? []
    return raw.map((item) => {
      const name = typeof item === "string" ? item : item[0]
      return { name }
    })
  })

  const [skills] = createResource(serverSdk, (sdk) => sdk.api.skill.list().then((result) => result.data), {
    initialValue: [],
  })

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-v2-tab-title">{language.t("settings.tab.extensions")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.extensions.description")}</span>
          </div>
          <InlineServerSelect />
        </div>
      </div>

      <div class="settings-v2-tab-body">
        <TabsV2 variant="pill" defaultValue="mcps" class="settings-v2-extensions-tabs">
          <TabsV2.List>
            <TabsV2.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</TabsV2.Trigger>
            <TabsV2.Trigger value="plugins">{language.t("status.popover.tab.plugins")}</TabsV2.Trigger>
            <TabsV2.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</TabsV2.Trigger>
          </TabsV2.List>

          <TabsV2.Content value="mcps">
            <div class="settings-v2-section">
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
          </TabsV2.Content>

          <TabsV2.Content value="plugins">
            <div class="settings-v2-section">
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
          </TabsV2.Content>

          <TabsV2.Content value="skills">
            <div class="settings-v2-section">
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
          </TabsV2.Content>
        </TabsV2>
      </div>
    </>
  )
}
