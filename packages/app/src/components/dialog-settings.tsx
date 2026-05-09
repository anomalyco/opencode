import { Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
// FORK: 飞书桥接 Settings Tab(C1.4)[feat: feishu-bridge] 2026-05-08
import { SettingsFeishu } from "./settings-feishu"
// FORK: 设置页脚显示 DeskFox <Platform> + installer 版本号(YYYY.M.D.N), 2026-05-06
// installer-versions.json 由 bump-installer-version.{ps1,sh} 在每次 bump 时同步更新对应平台 key
import installerVersions from "@opencode-ai/branding/installer-versions.json"

export const DialogSettings: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()

  // FORK: 设置页脚 — DeskFox <Platform> + installer 版本号
  const platformLabel =
    platform.os === "macos" ? "macOS"
    : platform.os === "windows" ? "Windows"
    : platform.os === "linux" ? "Linux"
    : ""
  const installerVer =
    platform.os === "macos" ? installerVersions.macos
    : platform.os === "windows" ? installerVersions.windows
    : platform.version

  return (
    <Dialog size="x-large" transition class="h-full">
      <Tabs orientation="vertical" variant="settings" defaultValue="general" class="h-full settings-dialog">
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
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
                    {/* FORK: 飞书桥接 Tab(C1.4)[feat: feishu-bridge] 2026-05-08 */}
                    <Tabs.Trigger value="feishu">
                      <Icon name="comment" />
                      {language.t("settings.tab.feishu")}
                    </Tabs.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{platformLabel ? `DeskFox for ${platformLabel}` : "DeskFox"}</span>
              <span class="text-11-regular">v{installerVer}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
        {/* FORK: 飞书桥接 Tab Content(C1.4)[feat: feishu-bridge] 2026-05-08 */}
        <Tabs.Content value="feishu" class="no-scrollbar">
          <SettingsFeishu />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
