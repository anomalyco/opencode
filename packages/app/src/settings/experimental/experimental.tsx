import { Component, Show } from "solid-js"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsList } from "@/settings/list"
import { useSettings } from "@/settings/model"
import { SettingsRow } from "@/settings/row"
import { callVoice, voices, type CallVoice } from "@/voice/voices"
import "@/settings/settings.css"

export const experimentalSettingsAvailable = true

export const SettingsExperimental: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  // Voice names are proper names; a regional voice adds how it speaks.
  const voiceLabel = (voice: CallVoice) => {
    const name = voice.id[0].toUpperCase() + voice.id.slice(1)

    return "accent" in voice
      ? language.t("settings.experimental.row.voiceName.accent", {
          name,
          accent: language.t(`settings.experimental.row.voiceName.accent.${voice.accent}`),
        })
      : name
  }

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
            <SettingsRow
              title={language.t("settings.experimental.row.newQuestionUI.title")}
              description={language.t("settings.experimental.row.newQuestionUI.description")}
            >
              <div data-action="settings-new-question-ui">
                <Switch
                  checked={settings.general.newQuestionUI()}
                  onChange={(checked) => settings.general.setNewQuestionUI(checked)}
                  hideLabel
                >
                  {language.t("settings.experimental.row.newQuestionUI.title")}
                </Switch>
              </div>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.experimental.row.voice.title")}
              description={language.t("settings.experimental.row.voice.description")}
            >
              <div data-action="settings-voice">
                <Switch
                  checked={settings.general.voice()}
                  onChange={(checked) => settings.general.setVoice(checked)}
                  hideLabel
                >
                  {language.t("settings.experimental.row.voice.title")}
                </Switch>
              </div>
            </SettingsRow>
            <Show when={settings.general.voice()}>
              <SettingsRow
                title={language.t("settings.experimental.row.voiceName.title")}
                description={language.t("settings.experimental.row.voiceName.description")}
              >
                <Select
                  data-action="settings-voice-name"
                  options={[...voices]}
                  current={voices.find((voice) => voice.id === callVoice(settings.general.voiceName()))}
                  value={(voice) => voice.id}
                  label={voiceLabel}
                  onSelect={(voice) => voice && settings.general.setVoiceName(voice.id)}
                  placement="bottom-end"
                  gutter={6}
                />
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.experimental.row.voiceSounds.title")}
                description={language.t("settings.experimental.row.voiceSounds.description")}
              >
                <div data-action="settings-voice-sounds">
                  <Switch
                    checked={settings.general.voiceSounds()}
                    onChange={(checked) => settings.general.setVoiceSounds(checked)}
                    hideLabel
                  >
                    {language.t("settings.experimental.row.voiceSounds.title")}
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
