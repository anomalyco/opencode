import { Component, createMemo, createSignal, startTransition } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { useTabs } from "@/context/tabs"
import { useServerSync } from "@/context/server-sync"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsServers } from "./settings-servers"
import { SettingsContextV2 } from "./settings-v2/context"

export const DialogCustomMenu: Component<{ defaultValue?: string }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const [tab, setTab] = createSignal(props.defaultValue ?? "general")

  const layout = useLayout()
  const tabs = useTabs()
  const serverSync = useServerSync()
  const directory = createMemo(() => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "draft") {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
    return undefined
  })

  const showProviders = () => {
    void dialog.show(() => <DialogCustomMenu defaultValue="providers" />)
  }

  return (
    <Dialog size="x-large" transition>
      <Tabs
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class="h-full settings-dialog"
      >
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full gap-4">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-1.5 w-full">
                <Tabs.Trigger value="custom">
                  <Icon name="plus" />
                  {language.t("customMenu.tab.custom")}
                </Tabs.Trigger>
              </div>

              <Collapsible variant="ghost" defaultOpen={false} class="w-full">
                <Collapsible.Trigger class="flex items-center gap-1 px-1">
                  <span>{language.t("customMenu.tab.settings")}</span>
                  <Collapsible.Arrow />
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <div class="flex flex-col gap-3 pt-1">
                    <div class="flex flex-col gap-1.5">
                      <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                      <div class="flex flex-col gap-1.5 w-full">
                        <Tabs.Trigger value="general">
                          <Icon name="sliders" />
                          {language.t("settings.tab.general")}
                        </Tabs.Trigger>
                        <Tabs.Trigger value="shortcuts">
                          <Icon name="keyboard" />
                          {language.t("settings.tab.shortcuts")}
                        </Tabs.Trigger>
                        <Tabs.Trigger value="servers">
                          <Icon name="server" />
                          {language.t("status.popover.tab.servers")}
                        </Tabs.Trigger>
                      </div>
                    </div>

                    <div class="flex flex-col gap-1.5">
                      <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                      <div class="flex flex-col gap-1.5 w-full">
                        <Tabs.Trigger value="providers">
                          <Icon name="providers" />
                          {language.t("settings.providers.title")}
                        </Tabs.Trigger>
                        <Tabs.Trigger value="models">
                          <Icon name="models" />
                          {language.t("settings.models.title")}
                        </Tabs.Trigger>
                      </div>
                    </div>
                  </div>
                </Collapsible.Content>
              </Collapsible>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.desktop")}</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="custom" class="no-scrollbar">
          <SettingsContextV2 directory={directory} />
        </Tabs.Content>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="servers" class="no-scrollbar">
          <SettingsServers />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders onBack={showProviders} />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
