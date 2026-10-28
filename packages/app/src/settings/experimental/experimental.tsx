import { Component } from "solid-js"
import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsList } from "@/settings/list"
import { useSettings } from "@/settings/model"
import { SettingsRow } from "@/settings/row"
import "@/settings/settings.css"

export const experimentalSettingsAvailable = true

export const SettingsExperimental: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.experimental")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              {language.t("settings.experimental.description")}
            </span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <div class="settings-section">
          <SettingsList>
            <SettingsRow
              title={language.t("settings.experimental.row.newIcons.title")}
              description={language.t("settings.experimental.row.newIcons.description")}
            >
              <div data-action="settings-new-icons">
                <Switch
                  checked={settings.general.newIcons()}
                  onChange={(checked) => settings.general.setNewIcons(checked)}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.experimental.row.newModelPicker.title")}
              description={language.t("settings.experimental.row.newModelPicker.description")}
            >
              <div data-action="settings-new-model-picker">
                <Switch
                  checked={settings.general.newModelPicker()}
                  onChange={(checked) => settings.general.setNewModelPicker(checked)}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.experimental.row.foldUserMessages.title")}
              description={language.t("settings.experimental.row.foldUserMessages.description")}
            >
              <div data-action="settings-fold-user-messages">
                <Switch
                  checked={settings.general.foldUserMessages()}
                  onChange={(checked) => settings.general.setFoldUserMessages(checked)}
                />
              </div>
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </>
  )
}
