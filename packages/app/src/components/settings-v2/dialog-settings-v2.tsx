import { Component, createMemo, createSignal, startTransition } from "solid-js"
import { Dialog } from "@opencode-ai/ui/v2/dialog-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneralV2 } from "./general"
import { SettingsAppearanceV2 } from "./appearance"
import { SettingsKeybinds } from "../settings-keybinds"
import { SettingsNotificationsV2 } from "./notifications"
import { SettingsProvidersV2 } from "./providers"
import { SettingsModelsV2 } from "./models"
import { SettingsServersV2 } from "./servers"
import { SettingsProjectsV2 } from "./projects"
import { SettingsExtensionsV2 } from "./extensions"
import { SettingsServerScope } from "../settings-server-picker"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { useTabs } from "@/context/tabs"
import { useServerSync } from "@/context/server-sync"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import "./settings-v2.css"

export const DialogSettings: Component<{
  sessionID?: string
  defaultValue?: string
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const layout = useLayout()
  const tabs = useTabs()
  const serverSync = useServerSync()
  const global = useGlobal()
  const currentServer = global.servers.list().find((server) => global.ensureServerCtx(server).sync === serverSync())
  if (currentServer) global.settings.server.set(ServerConnection.key(currentServer))
  const [tab, setTab] = createSignal(props.defaultValue ?? "general")
  const directory = createMemo(() => {
    const server = global.settings.server.selected()
    if (!server || serverSync() !== global.ensureServerCtx(server).sync) return
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "draft") {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.location.directory
    return undefined
  })

  const showProviders = () => {
    void dialog.show(() => <DialogSettings sessionID={props.sessionID} defaultValue="providers" />)
  }

  return (
    <Dialog size="x-large" variant="settings" class="settings-v2-dialog">
      <TabsV2
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class="settings-v2"
      >
        <TabsV2.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-4 w-full">
              {/* Group 1: Preferences */}
              <div class="flex flex-col gap-1 w-full">
                <TabsV2.Trigger value="general">
                  <Icon name="sliders" />
                  {language.t("settings.tab.preferences")}
                </TabsV2.Trigger>
                <TabsV2.Trigger value="appearance">
                  <Icon name="appearance" />
                  {language.t("settings.general.section.appearance")}
                </TabsV2.Trigger>
                <TabsV2.Trigger value="notifications">
                  <Icon name="notifications" />
                  {language.t("settings.tab.notifications")}
                </TabsV2.Trigger>
                <TabsV2.Trigger value="shortcuts">
                  <Icon name="keyboard" />
                  {language.t("settings.tab.shortcuts")}
                </TabsV2.Trigger>
              </div>

              {/* Group 2: Environment & Workspaces */}
              <div class="flex flex-col gap-1 w-full">
                <TabsV2.Trigger value="servers">
                  <Icon name="server" />
                  {language.t("status.popover.tab.servers")}
                </TabsV2.Trigger>
                <TabsV2.Trigger value="projects">
                  <Icon name="folder" />
                  {language.t("settings.tab.projects")}
                </TabsV2.Trigger>
              </div>

              {/* Group 3: Capabilities & Extensions */}
              <div class="flex flex-col gap-1 w-full">
                <TabsV2.Trigger value="providers">
                  <Icon name="providers" />
                  {language.t("settings.providers.title")}
                </TabsV2.Trigger>
                <TabsV2.Trigger value="models">
                  <Icon name="models" />
                  {language.t("settings.models.title")}
                </TabsV2.Trigger>
                <TabsV2.Trigger value="extensions">
                  <Icon name="extensions" />
                  {language.t("settings.tab.extensions")}
                </TabsV2.Trigger>
              </div>
            </div>

            <div class="settings-v2-nav-footer">
              <span>{language.t("app.name.desktop")}</span>
              <span>v{platform.version}</span>
            </div>
          </div>
        </TabsV2.List>

        <TabsV2.Content value="general" class="settings-v2-panel">
          <SettingsGeneralV2 sessionID={props.sessionID} />
        </TabsV2.Content>
        <TabsV2.Content value="appearance" class="settings-v2-panel">
          <SettingsAppearanceV2 />
        </TabsV2.Content>
        <TabsV2.Content value="notifications" class="settings-v2-panel">
          <SettingsNotificationsV2 />
        </TabsV2.Content>
        <TabsV2.Content value="shortcuts" class="settings-v2-panel">
          <SettingsKeybinds v2 />
        </TabsV2.Content>
        <TabsV2.Content value="servers" class="settings-v2-panel">
          <SettingsServersV2 />
        </TabsV2.Content>
        <TabsV2.Content value="projects" class="settings-v2-panel">
          <SettingsProjectsV2 />
        </TabsV2.Content>
        <SettingsServerScope directory={directory()}>
          <TabsV2.Content value="providers" class="settings-v2-panel">
            <SettingsProvidersV2 directory={directory()} onBack={showProviders} />
          </TabsV2.Content>
          <TabsV2.Content value="models" class="settings-v2-panel">
            <SettingsModelsV2 />
          </TabsV2.Content>
          <TabsV2.Content value="extensions" class="settings-v2-panel">
            <SettingsExtensionsV2 />
          </TabsV2.Content>
        </SettingsServerScope>
      </TabsV2>
    </Dialog>
  )
}
