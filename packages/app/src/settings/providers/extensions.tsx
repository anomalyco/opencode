import type { McpServer } from "@opencode/client/promise"
import { Component, For, Show, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { Tabs } from "@opencode/ui/tabs"
import { TruncatedText } from "@opencode/ui/truncated-text"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { ServerConnection } from "@/runtime/server/registry"
import { useMcpController } from "@/providers/connect/mcp"
import { mcpRowView } from "@/providers/connect/mcp-machine"
import { DialogMcp } from "@/providers/connect/mcp-dialog"
import { ExtensionPlugins } from "@/runtime/plugin/extension-plugins"
import { ExternalLink } from "@/runtime/platform/external-link"
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsList } from "@/settings/list"
import { createExtensionLoad, ExtensionLoadFailed } from "@/settings/extension-load"
import type { SettingsView } from "@/settings/surface"
import { ConsoleName, ConsoleReplaced, createConsoleSources } from "./console-link"
import "@/settings/settings.css"
import "@/shell/search-list.css"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

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
  const platform = usePlatform()
  // MCP connections are per Location, so read and toggle them where the active session runs, as the TUI does. The
  // names come from the default Location so this page lists only the servers available to all projects.
  const location = () => (props.directory ? { directory: props.directory } : data.location.default())
  const mcp = useMcpController(() => props.directory)

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

  const toggle = (item: McpServer, enabled: boolean) =>
    mcp.dispatch({ type: "toggle.requested", name: item.name, enabled, status: item.status.status })

  const sources = createConsoleSources(() => props.directory)

  const plugins = createExtensionLoad({
    key: () => serverSdk.scope,
    task: (_, signal) => serverSdk.api.plugin.list(undefined, { signal }).then((result) => result.data),
  })

  onCleanup(
    serverSdk.event.on("plugin.updated", (event) => {
      if (!event.location) plugins.invalidate()
    }),
  )

  const pluginList = createMemo(() => {
    const current = plugins.view()

    return current.status === "ready" ? current.value : undefined
  })

  // The desktop window runs the GUIs of its own server's plugins, so only that server's rows control them.
  const own = () => !!platform.plugins && ServerConnection.builtin(serverSdk.server)

  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.skill.sync().catch(() => undefined)
  })
  const skills = createMemo(() => (data.location.skill.list() ?? []).toSorted((a, b) => a.name.localeCompare(b.name)))

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
                    const row = () => mcpRowView(mcp.state(), item.name, item.status.status)

                    const busy = () => row().busy

                    const managed = () => sources.managed(item.name)

                    const links = () => sources.links(item.name)

                    const status = () =>
                      managed()?.needsConnection && item.status.status === "connected"
                        ? "needs_auth"
                        : item.status.status

                    // The dot shows the status, as in the MCPs dialog; the words stay for assistive technology.
                    const label = () => {
                      if (managed()) return language.t("settings.extensions.console.temporary")

                      return item.status.status === "pending" ? undefined : language.t(statusLabels[item.status.status])
                    }

                    const connect = () => sources.connect(item.name)

                    return (
                      <div class="settings-extension-row settings-mcp-row" data-status={status()}>
                        <div class="settings-extension-lead">
                          <span class="settings-mcp-status">
                            <span class="mcp-status-dot" data-status={status()} aria-hidden="true" />
                          </span>
                          <Show
                            when={managed() && links()}
                            fallback={<TruncatedText text={item.name} class="settings-extension-name" />}
                          >
                            {(current) => <ConsoleName name={item.name} href={current().manage} />}
                          </Show>
                          <Show when={sources.mcp(item.name)?.overridden && links()}>
                            {(current) => <ConsoleReplaced name={item.name} href={current().manage} />}
                          </Show>
                        </div>
                        <div class="settings-extension-trailing">
                          <Show when={item.status.status === "failed"}>
                            <Button
                              size="small"
                              variant="ghost-muted"
                              aria-label={language.t("dialog.mcp.error.viewLabel", { name: item.name })}
                              onClick={() =>
                                dialog.show(() => <DialogMcp directory={location().directory} server={item.name} />)
                              }
                            >
                              {language.t("dialog.mcp.error.view")}
                            </Button>
                          </Show>
                          <Show
                            when={connect()}
                            fallback={
                              <Show
                                when={item.status.status === "needs_auth" && item.integrationID}
                                fallback={
                                  <Switch
                                    checked={item.status.status !== "disabled"}
                                    disabled={row().pending}
                                    description={label()}
                                    class="[&_[data-slot=switch-description]]:sr-only"
                                    onChange={(enabled) => toggle(item, enabled)}
                                  >
                                    <span class="sr-only">{item.name}</span>
                                  </Switch>
                                }
                              >
                                <Button
                                  size="small"
                                  variant="ghost-muted"
                                  disabled={busy()}
                                  aria-busy={busy()}
                                  aria-label={language.t("dialog.mcp.signIn.open", { name: item.name })}
                                  onClick={() => toggle(item, true)}
                                >
                                  {language.t(busy() ? "dialog.mcp.signingIn" : "dialog.mcp.signIn")}
                                </Button>
                              </Show>
                            }
                          >
                            {(href) => (
                              <Button
                                size="small"
                                variant="ghost-muted"
                                aria-label={language.t("settings.extensions.console.connect", { name: item.name })}
                                onClick={() => platform.openExternal(href())}
                              >
                                {language.t("common.connect")}
                              </Button>
                            )}
                          </Show>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </SettingsList>
              <Show when={sources.view().status === "error"}>
                <ExtensionLoadFailed
                  message={language.t("settings.extensions.sources.loadFailed")}
                  retry={language.t("common.retry")}
                  onRetry={sources.retry}
                />
              </Show>
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
              {/* The desktop's own server also lists the plugins main runs, so its rows stay while the list loads. */}
              <Show when={own() || pluginList()}>
                <ExtensionPlugins plugins={pluginList() ?? []} own={own()} />
              </Show>
              <Show when={plugins.view().status === "loading" && !own()}>
                <p class="project-settings-extension-empty-description">{language.t("common.loading")}</p>
              </Show>
              <Show when={plugins.view().status === "error"}>
                <ExtensionLoadFailed
                  message={language.t("settings.extensions.plugins.loadFailed")}
                  retry={language.t("common.retry")}
                  onRetry={plugins.retry}
                />
              </Show>
            </div>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <ExternalLink class="settings-extension-link text-13-regular" href="https://opencode.ai/docs/skills">
                  {language.t("settings.extensions.addSkills")}
                </ExternalLink>
              </div>
              <SettingsList variant="catalog">
                <For each={skills()}>
                  {(skill) => {
                    const link = () => sources.skill(skill)

                    return (
                      <div class="settings-extension-row">
                        <div class="settings-extension-lead">
                          <Icon name="post-skill" class="text-v2-icon-icon-muted shrink-0" />
                          <Show
                            when={link()}
                            fallback={<span class="settings-extension-name truncate">{skill.name}</span>}
                          >
                            {(href) => <ConsoleName name={skill.name} href={href()} />}
                          </Show>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </SettingsList>
              <Show when={sources.view().status === "error"}>
                <ExtensionLoadFailed
                  message={language.t("settings.extensions.sources.loadFailed")}
                  retry={language.t("common.retry")}
                  onRetry={sources.retry}
                />
              </Show>
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </>
  )
}
