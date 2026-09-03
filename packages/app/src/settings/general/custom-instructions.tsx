import type { Component } from "solid-js"
import { Textarea } from "@opencode-ai/ui/textarea"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import type { CustomInstructionsSettingsController } from "./controllers"

export const CustomInstructionsSetting: Component<{ controller: CustomInstructionsSettingsController }> = (props) => {
  const language = useLanguage()
  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{language.t("settings.customInstructions.title")}</h3>
      <SettingsList>
        <SettingsRow
          title={language.t("settings.customInstructions.title")}
          description={language.t("settings.customInstructions.description")}
        >
          <div class="w-full">
            <Textarea
              data-action="settings-custom-instructions"
              rows={5}
              value={props.controller.draft()}
              placeholder={language.t("settings.customInstructions.placeholder")}
              aria-label={language.t("settings.customInstructions.title")}
              spellcheck={false}
              onInput={(event) => props.controller.update(event.currentTarget.value)}
            />
            <span class="text-11-regular text-v2-text-text-muted">
              {language.t("settings.customInstructions.hint")}
            </span>
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )
}
