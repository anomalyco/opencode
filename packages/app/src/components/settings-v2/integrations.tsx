import { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import "./settings-v2.css"

export const SettingsIntegrationsV2: Component = () => {
  const language = useLanguage()

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">
          {language.t("settings.tab.integrations")}
        </h2>
      </div>

      <div class="settings-v2-tab-body">
        <div class="settings-v2-placeholder">
          <div class="settings-v2-placeholder-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="6" y="6" width="15" height="15" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.3" />
              <rect x="27" y="6" width="15" height="15" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.3" />
              <rect x="6" y="27" width="15" height="15" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.3" />
              <rect x="27" y="27" width="15" height="15" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.3" />
              <path d="M21 13.5H27" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.15" />
              <path d="M34.5 21V27" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.15" />
            </svg>
          </div>
          <p class="settings-v2-placeholder-text">
            {language.t("settings.integrations.placeholder")}
          </p>
        </div>
      </div>
    </>
  )
}
