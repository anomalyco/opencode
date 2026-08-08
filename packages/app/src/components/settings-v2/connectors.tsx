import { Component, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useGitHubConnector } from "@/connectors/use-connector"
import { ConnectorCard } from "./connector-card"
import { ConnectorModalGitHub } from "./connector-modal-github"
import "./settings-v2.css"

export const SettingsConnectorsV2: Component = () => {
  const language = useLanguage()
  const dialog = useDialog()
  const connector = useGitHubConnector()

  // Available on desktop (platform bridge) or on web (server connector proxy).
  const available = () => connector.available()

  const openModal = () => {
    if (!available()) return
    void dialog.show(() => <ConnectorModalGitHub controller={connector} />)
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">
          {language.t("settings.tab.connectors")}
        </h2>
      </div>

      <div class="settings-v2-tab-body">
        <Show
          when={available()}
          fallback={
            <div class="settings-v2-placeholder">
              <p class="settings-v2-placeholder-text">
                {language.t("settings.connectors.unavailable")}
              </p>
            </div>
          }
        >
          <div data-component="connector-list">
            <ConnectorCard
              status={connector.status()}
              onToggle={(enabled) => void connector.toggleEnabled(enabled)}
              onOpen={openModal}
            />
          </div>
        </Show>
      </div>
    </>
  )
}
