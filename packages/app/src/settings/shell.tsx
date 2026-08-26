import { createEffect, createMemo, onMount } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsGeneral } from "./general/general"
import { SettingsAppearance } from "./appearance/appearance"
import { SettingsKeybinds } from "./keybinds/keybinds"
import { SettingsNotifications } from "./notifications/notifications"
import { SettingsProviders } from "./providers/providers"
import { SettingsModels } from "./models/models"
import { SettingsServers } from "./servers/servers"
import { SettingsWorkspaces } from "./workspaces/workspaces"
import { SettingsProjects } from "./workspaces/projects"
import { SettingsExtensions } from "./providers/extensions"
import { SettingsServerScope } from "./server-scope"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useSettingsNavigation } from "./navigation"
import { useSettingsCommand } from "./command"
import "@/settings/settings.css"

export function SettingsScreen() {
  const language = useLanguage()
  const dialog = useDialog()
  const navigation = useSettingsNavigation()
  const location = useLocation()
  const navigate = useNavigate()
  const servers = useServers()
  const global = useGlobal()
  useSettingsCommand()
  const tab = () => {
    const value = location.query.tab
    return typeof value === "string" &&
      [
        "general",
        "appearance",
        "notifications",
        "shortcuts",
        "servers",
        "projects",
        "workspaces",
        "providers",
        "models",
        "extensions",
      ].includes(value)
      ? value
      : "general"
  }
  const setTab = (value: string) => {
    const query = new URLSearchParams(location.search)
    query.set("tab", value)
    navigate(`/settings?${query}`, { replace: true, scroll: false })
  }
  let root: HTMLDivElement | undefined

  onMount(() => {
    root?.focus({ preventScroll: true })
  })

  const server = createMemo(
    () =>
      servers.list.find((item) => ServerConnection.key(item) === location.query.server) ??
      global.settings.server.selected(),
  )

  createEffect(() => {
    const current = server()
    if (current) global.settings.server.set(ServerConnection.key(current))
  })

  const directory = createMemo(() => {
    const selected = global.settings.server.selected()
    const current = server()
    if (!selected || !current || ServerConnection.key(selected) !== ServerConnection.key(current)) return
    if (location.query.server !== ServerConnection.key(current)) return
    return typeof location.query.directory === "string" ? location.query.directory : undefined
  })

  const showProviders = () => {
    dialog.close()
    setTab("providers")
  }

  return (
    <div
      ref={root}
      data-testid="settings-screen"
      class="settings-screen"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || dialog.active) return
        event.preventDefault()
        navigation.close()
      }}
    >
      <Tabs orientation="vertical" variant="settings" value={tab()} onChange={setTab} class="settings">
        <Tabs.List>
          <div class="settings-nav">
            <button type="button" class="settings-back" onClick={navigation.close}>
              <Icon name="arrow-left" size="small" class="settings-back-icon" />
              <span>{language.t("settings.backToApp")}</span>
            </button>
            <div class="flex flex-col gap-4 w-full">
              {/* Group 1: Preferences */}
              <div class="flex flex-col gap-1 w-full">
                <Tabs.Trigger value="general">
                  <Icon name="sliders" />
                  {language.t("settings.tab.preferences")}
                </Tabs.Trigger>
                <Tabs.Trigger value="appearance">
                  <Icon name="appearance" />
                  {language.t("settings.general.section.appearance")}
                </Tabs.Trigger>
                <Tabs.Trigger value="notifications">
                  <Icon name="notifications" />
                  {language.t("settings.tab.notifications")}
                </Tabs.Trigger>
                <Tabs.Trigger value="shortcuts">
                  <Icon name="keyboard" />
                  {language.t("settings.tab.shortcuts")}
                </Tabs.Trigger>
              </div>

              {/* Group 2: Environment & Workspaces */}
              <div class="flex flex-col gap-1 w-full">
                <Tabs.Trigger value="servers">
                  <Icon name="server" />
                  {language.t("status.popover.tab.servers")}
                </Tabs.Trigger>
                <Tabs.Trigger value="projects">
                  <Icon name="folder" />
                  {language.t("settings.tab.projects")}
                </Tabs.Trigger>
                <Tabs.Trigger value="workspaces">
                  <Icon name="workspace-isolated" />
                  {language.t("settings.tab.workspaces")}
                </Tabs.Trigger>
              </div>

              {/* Group 3: Capabilities & Extensions */}
              <div class="flex flex-col gap-1 w-full">
                <Tabs.Trigger value="providers">
                  <Icon name="providers" />
                  {language.t("settings.providers.title")}
                </Tabs.Trigger>
                <Tabs.Trigger value="models">
                  <Icon name="models" />
                  {language.t("settings.models.title")}
                </Tabs.Trigger>
                <Tabs.Trigger value="extensions">
                  <Icon name="extensions" />
                  {language.t("settings.tab.extensions")}
                </Tabs.Trigger>
              </div>
            </div>
          </div>
        </Tabs.List>

        <Tabs.Content value="general" class="settings-panel">
          <SettingsGeneral server={server()} />
        </Tabs.Content>
        <Tabs.Content value="appearance" class="settings-panel">
          <SettingsAppearance />
        </Tabs.Content>
        <Tabs.Content value="notifications" class="settings-panel">
          <SettingsNotifications />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="settings-panel">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="servers" class="settings-panel">
          <SettingsServers />
        </Tabs.Content>
        <Tabs.Content value="projects" class="settings-panel">
          <SettingsProjects />
        </Tabs.Content>
        <SettingsServerScope directory={directory()}>
          <Tabs.Content value="workspaces" class="settings-panel">
            <SettingsWorkspaces activeDirectory={directory()} />
          </Tabs.Content>
          <Tabs.Content value="providers" class="settings-panel">
            <SettingsProviders directory={directory()} onBack={showProviders} />
          </Tabs.Content>
          <Tabs.Content value="models" class="settings-panel">
            <SettingsModels />
          </Tabs.Content>
          <Tabs.Content value="extensions" class="settings-panel">
            <SettingsExtensions />
          </Tabs.Content>
        </SettingsServerScope>
      </Tabs>
    </div>
  )
}
