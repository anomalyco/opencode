/**
 * Dialog Settings Override
 *
 * Extends the base settings dialog to include Remote Access when tunnelEnabled.
 * On mobile (<640px), uses a drill-down pattern: menu → content with back button.
 */

import { Component, createSignal, ErrorBoundary, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneral } from "@/components/settings-general"
import { SettingsKeybinds } from "@/components/settings-keybinds"
import { SettingsProviders } from "@/components/settings-providers"
import { SettingsModels } from "@/components/settings-models"
import { SettingsTerminals } from "../../components/settings-terminals"
import { useConfigOptional } from "../../context/config"
import { RemoteAccessSettings } from "../../components/settings-remote-access"

export const DialogSettings: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const config = useConfigOptional()
  const [activeTab, setActiveTab] = createSignal("general")
  const [mobileShowContent, setMobileShowContent] = createSignal(false)

  const tunnelEnabled = () => config?.tunnelEnabled ?? false

  return (
    <Dialog size="x-large" transition class="flex-1">
      <Tabs
        orientation="vertical"
        variant="settings"
        value={activeTab()}
        onChange={(value: string) => {
          setActiveTab(value)
          setMobileShowContent(true)
        }}
        class="h-full"
        classList={{
          "settings-dialog": true,
          "settings-mobile-menu": !mobileShowContent(),
          "settings-mobile-content": mobileShowContent(),
        }}
      >
        <Tabs.List>
          <div
            class="flex flex-col justify-between h-full w-full"
            onClick={(e) => {
              // On mobile, tapping an already-selected tab should still show content
              if ((e.target as HTMLElement).closest("[data-slot='tabs-trigger']")) {
                setMobileShowContent(true)
              }
            }}
          >
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
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
                    <Tabs.Trigger value="terminals">
                      <Icon name="console" />
                      Terminals
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
                    {/* Remote Access - only when tunnelEnabled */}
                    <Show when={tunnelEnabled()}>
                      <Tabs.Trigger value="remote-access">
                        <Icon name="server" />
                        Remote Access
                      </Tabs.Trigger>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.desktop")}</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        {/* Mobile: back button to return to tab list */}
        <div class="settings-mobile-back" onClick={() => setMobileShowContent(false)}>
          <Icon name="arrow-left" size="small" />
          <span>Settings</span>
        </div>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="terminals" class="no-scrollbar">
          <SettingsTerminals />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
        {/* Remote Access content - only when tunnelEnabled */}
        <Show when={tunnelEnabled()}>
          <Tabs.Content value="remote-access" class="no-scrollbar">
            <RemoteAccessSettingsContent />
          </Tabs.Content>
        </Show>
      </Tabs>
    </Dialog>
  )
}

/**
 * Remote Access settings content (without the config check since dialog already checks)
 */
function RemoteAccessSettingsContent() {
  const msg = (err: unknown) => {
    if (typeof err === "string") return err
    if (err instanceof Error) return err.message
    return String(err)
  }

  return (
    <ErrorBoundary
      fallback={(err) => (
        <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
          <div class="pt-6 pb-8">
            <h2 class="text-16-medium text-text-strong">Remote Access</h2>
          </div>
          <div class="bg-surface-raised-base px-4 py-4 rounded-lg">
            <div class="text-14-medium text-text-strong mb-2">Something went wrong</div>
            <pre class="text-12-regular text-text-weak whitespace-pre-wrap break-words">{msg(err)}</pre>
          </div>
        </div>
      )}
    >
      <RemoteAccessSettings />
    </ErrorBoundary>
  )
}
