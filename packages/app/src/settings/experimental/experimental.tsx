import { Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import "@/settings/settings.css"

export const experimentalSettingsAvailable = false

export const SettingsExperimental: Component = () => {
  const language = useLanguage()

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
    </>
  )
}
