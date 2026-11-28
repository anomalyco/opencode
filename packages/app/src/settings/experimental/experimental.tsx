import { Show, type Component } from "solid-js"
import { Switch } from "@opencode/ui/switch"
import { Select } from "@opencode/ui/select"
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
              title={language.t("settings.experimental.row.tabGroups.title")}
              description={language.t("settings.experimental.row.tabGroups.description")}
            >
              <div data-action="settings-tab-groups">
                <Switch
                  checked={settings.general.tabGroups()}
                  onChange={(checked) => settings.general.setTabGroups(checked)}
                  hideLabel
                >
                  {language.t("settings.experimental.row.tabGroups.title")}
                </Switch>
              </div>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.experimental.row.sidebarOrganize.title")}
              description={language.t("settings.experimental.row.sidebarOrganize.description")}
            >
              <Select
                data-action="settings-sidebar-organize"
                options={settings.general.sidebarOrganizeOptions}
                current={settings.general.sidebarOrganize()}
                label={(mode) => language.t(`settings.experimental.sidebarOrganize.${mode}`)}
                onSelect={(mode) => mode && settings.general.setSidebarOrganize(mode)}
                placement="bottom-end"
                gutter={6}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.experimental.row.newTimeline.title")}
              description={language.t("settings.experimental.row.newTimeline.description")}
            >
              <div data-action="settings-new-timeline">
                <Switch
                  checked={settings.general.newTimeline()}
                  onChange={(checked) => settings.general.setNewTimeline(checked)}
                  hideLabel
                >
                  {language.t("settings.experimental.row.newTimeline.title")}
                </Switch>
              </div>
            </SettingsRow>
            <Show when={settings.general.questionComposerAvailable}>
              <SettingsRow
                title={language.t("settings.experimental.row.questionComposer.title")}
                description={language.t("settings.experimental.row.questionComposer.description")}
              >
                <div data-action="settings-question-composer">
                  <Switch
                    checked={settings.general.questionComposer()}
                    onChange={(checked) => settings.general.setQuestionComposer(checked)}
                    hideLabel
                  >
                    {language.t("settings.experimental.row.questionComposer.title")}
                  </Switch>
                </div>
              </SettingsRow>
            </Show>
          </SettingsList>
        </div>
      </div>
    </>
  )
}
