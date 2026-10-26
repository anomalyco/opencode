import { Component, For, Show, createEffect, createMemo, createResource, type JSX } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { Tabs } from "@opencode/ui/tabs"
import { TruncatedText } from "@opencode/ui/truncated-text"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useMcpToggle } from "@/providers/connect/mcp"
import { DialogMcp } from "@/providers/connect/mcp-dialog"
import { pluginLabels } from "@/providers/catalog/plugin"
import { ExternalLink } from "@/runtime/platform/external-link"
import { SettingsList } from "@/settings/list"
import type { SettingsView } from "@/settings/surface"
import "@/settings/settings.css"
import "@/shell/search-list.css"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

interface PluginRowItem {
  name: string
}

export const SettingsExtensions: Component<{
  directory?: string
  subtab?: SettingsView["subtab"]
  onSubtab: (value: SettingsView["subtab"]) => void
  headerAction?: JSX.Element
}> = (props) => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()
  // MCP connections are per Location, so read and toggle them where the active session runs, as the TUI does. The
  // names come from the default Location so this page lists only the servers available to all projects.
  const location = () => (props.directory ? { directory: props.directory } : data.location.default())
  const toggleMcp = useMcpToggle(() => props.directory)

  // The synced lists follow mcp.status.changed, so a finished sign-in shows up without a refetch.
  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.mcp.server.sync(data.location.default()).catch(() => undefined)

    if (props.directory) void data.location.mcp.server.sync(location()).catch(() => undefined)
  })

  const mcps = createMemo(() => {
    const active = data.location.mcp.server.list(location())

    return (data.location.mcp.server.list(data.location.default()) ?? [])
      .map((server) => active?.find((item) => item.name === server.name) ?? server)
      .toSorted((a, b) => a.name.localeCompare(b.name))
  })

  const toggle = (name: string) => {
    if (toggleMcp.isPending) return
    toggleMcp.mutate(name)
  }

  const [pluginList] = createResource(
    () => serverSdk.connection.status() === "connected",
    () =>
      serverSdk.api.plugin
        .list()
        .then((result) => result.data)
        .catch(() => []),
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
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.extensions")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.extensions.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
      </div>

      <div class="settings-tab-body">
        <Tabs
          variant="pill"
          value={props.subtab ?? "mcps"}
          onChange={(value) => {
            if (value === "mcps" || value === "plugins" || value === "skills") props.onSubtab(value)
          }}
          class="settings-extensions-tabs settings-subtabs"
        >
          <Tabs.List>
            <Tabs.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</Tabs.Trigger>
            <Tabs.Trigger value="plugins">{language.t("settings.extensions.tab.plugins")}</Tabs.Trigger>
            <Tabs.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</Tabs.Trigger>
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
                  {(item) => {
                    const busy = () => {
                      const target = toggleMcp.isPending ? toggleMcp.variables : undefined

                      return (typeof target === "string" ? target : target?.name) === item.name
                    }

                    // The dot shows the status, as in the MCPs dialog; the words stay for assistive technology.
                    const label = () =>
                      item.status.status === "pending" ? undefined : language.t(statusLabels[item.status.status])

                    return (
                      <div class="settings-extension-row settings-mcp-row" data-status={item.status.status}>
                        <div class="settings-extension-lead">
                          <span class="settings-mcp-status">
                            <span class="mcp-status-dot" data-status={item.status.status} aria-hidden="true" />
                          </span>
                          <TruncatedText text={item.name} class="settings-extension-name" />
                        </div>
                        <div class="settings-extension-trailing">
                          <Show when={item.status.status === "failed"}>
                            <Button
                              size="small"
                              variant="ghost-muted"
                              class="mcp-status-action"
                              aria-label={language.t("dialog.mcp.error.viewLabel", { name: item.name })}
                              onClick={() =>
                                dialog.show(() => <DialogMcp directory={location().directory} server={item.name} />)
                              }
                            >
                              {language.t("dialog.mcp.error.view")}
                            </Button>
                          </Show>
                          <Show
                            when={item.status.status === "needs_auth" && item.integrationID}
                            fallback={
                              <Switch
                                checked={item.status.status !== "disabled"}
                                disabled={item.status.status === "pending" || busy()}
                                description={label()}
                                class="[&_[data-slot=switch-description]]:sr-only"
                                onChange={(enabled) => {
                                  if (toggleMcp.isPending) return
                                  toggleMcp.mutate({ name: item.name, enabled })
                                }}
                              >
                                <span class="sr-only">{item.name}</span>
                              </Switch>
                            }
                          >
                            <Button
                              size="small"
                              variant="ghost-muted"
                              class="mcp-status-action"
                              disabled={busy()}
                              aria-busy={busy()}
                              aria-label={language.t("dialog.mcp.signIn.open", { name: item.name })}
                              onClick={() => toggle(item.name)}
                            >
                              {language.t(busy() ? "dialog.mcp.signingIn" : "dialog.mcp.signIn")}
                            </Button>
                          </Show>
                        </div>
                      </div>
                    )
                  }}
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
                <ExternalLink class="settings-extension-link text-13-regular" href="https://opencode.ai/v2/docs/skills">
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
        </Tabs>
      </div>
    </>
  )
}
