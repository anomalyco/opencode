import { Component, createEffect, createMemo, createSignal, startTransition } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
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
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import "@/settings/settings.css"

export const DialogSettings: Component<{
  sessionID?: string
  defaultValue?: string
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const layout = useLayout()
  const servers = useServers()
  const tabs = useTabs()
  const global = useGlobal()
  const [tab, setTab] = createSignal(props.defaultValue ?? "general")
  const server = createMemo(() => {
    const route = layout.route()
    switch (route.type) {
      case "draft": {
        const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
        return servers.list.find((item) => ServerConnection.key(item) === draft?.server)
      }
      case "session":
        return servers.list.find((item) => ServerConnection.key(item) === route.server)
      case "home":
        return servers.list.find((item) => ServerConnection.key(item) === layout.home.selection().server)
    }
  })
  const serverCtx = useServerCtx(server)

  createEffect(() => {
    const current = server()
    if (current) global.settings.server.set(ServerConnection.key(current))
  })

  const directory = createMemo(() => {
    const selected = global.settings.server.selected()
    const current = server()
    if (!selected || !current || ServerConnection.key(selected) !== ServerConnection.key(current)) return
    const route = layout.route()
    if (route.type === "draft") {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (route.type === "session") return serverCtx()?.data.session.get(route.sessionId)?.location.directory
    return undefined
  })

  const showProviders = () => {
    void dialog.show(() => <DialogSettings sessionID={props.sessionID} defaultValue="providers" />)
  }

  return (
    <Dialog size="x-large" variant="settings" class="settings-dialog">
      <Tabs
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class="settings"
      >
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
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

            <div class="settings-nav-footer">
              <span>{language.t("app.name.desktop")}</span>
              <span>v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>

        <Tabs.Content value="general" class="settings-panel">
          <SettingsGeneral server={server()} sessionID={props.sessionID} />
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
    </Dialog>
  )
}
