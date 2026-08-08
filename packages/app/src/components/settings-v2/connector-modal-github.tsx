import { Component, Show, createMemo } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { GitHubConnectorController } from "@/connectors/use-connector"
import "./settings-v2.css"

export const ConnectorModalGitHub: Component<{
  controller: GitHubConnectorController
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const connector = props.controller

  const status = connector.status
  const device = connector.device
  const polling = connector.polling
  const error = connector.error

  const connectedUser = createMemo(() => (status().connected && !device() ? status().user : undefined))

  const errorMessage = createMemo(() => {
    const code = error()
    if (!code) return null
    if (code === "expired") return language.t("settings.connectors.github.error.expired")
    if (code === "denied") return language.t("settings.connectors.github.error.denied")
    if (code === "generic") return language.t("settings.connectors.github.error.generic")
    return code
  })

  const openVerification = () => {
    const d = device()
    if (!d) return
    platform.openExternal(d.verificationUri)
  }

  return (
    <Dialog size="normal" variant="settings" class="settings-v2-dialog">
      <DialogHeader>
        <DialogTitle>
          <span data-slot="connector-modal-title">
            <Icon name="github" />
            {language.t("settings.connectors.github.name")}
          </span>
        </DialogTitle>
      </DialogHeader>

      <DialogBody>
        <div data-component="connector-modal">
          {/* Connected state */}
          <Show when={connectedUser()}>
            {(user) => (
              <div data-slot="connector-modal-connected">
                <img src={user().avatar} alt="" width={48} height={48} data-slot="connector-modal-avatar" />
                <div>
                  <div data-slot="connector-modal-user">@{user().login}</div>
                  <div data-slot="connector-modal-connected-text">
                    {language.t("settings.connectors.github.connected.text")}
                  </div>
                </div>
              </div>
            )}
          </Show>

          {/* Device flow in progress */}
          <Show when={device()}>
            {(flow) => (
              <div data-slot="connector-modal-flow">
                <p data-slot="connector-modal-instructions">
                  {language.t("settings.connectors.github.code.instructions")}{" "}
                  <a
                    href={flow().verificationUri}
                    onClick={(e) => {
                      e.preventDefault()
                      openVerification()
                    }}
                  >
                    {flow().verificationUri}
                  </a>
                </p>
                <div data-slot="connector-modal-code">{flow().userCode}</div>
                <Show when={polling()}>
                  <div data-slot="connector-modal-waiting">
                    <span data-slot="connector-modal-spinner" />
                    {language.t("settings.connectors.github.waiting")}
                  </div>
                </Show>
              </div>
            )}
          </Show>

          {/* Error */}
          <Show when={errorMessage()}>
            {(message) => <div data-slot="connector-modal-error">{message()}</div>}
          </Show>

          {/* Not connected, no flow in progress */}
          <Show when={!status().connected && !device()}>
            <p data-slot="connector-modal-detail">{language.t("settings.connectors.github.detail")}</p>
            <ul data-slot="connector-modal-permissions">
              <li>{language.t("settings.connectors.github.permission.repos")}</li>
              <li>{language.t("settings.connectors.github.permission.profile")}</li>
            </ul>
          </Show>
        </div>
      </DialogBody>

      <DialogFooter>
        <Show
          when={device()}
          fallback={
            <Show
              when={status().connected}
              fallback={
                <ButtonV2 variant="contrast" icon="github" onClick={() => void connector.startConnect()}>
                  {language.t("settings.connectors.github.connect")}
                </ButtonV2>
              }
            >
              <ButtonV2 variant="danger" onClick={() => void connector.disconnect()}>
                {language.t("settings.connectors.github.disconnect")}
              </ButtonV2>
            </Show>
          }
        >
          <div data-slot="connector-modal-flow-actions">
            <ButtonV2 variant="neutral" onClick={connector.cancelConnect}>
              {language.t("settings.connectors.github.cancel")}
            </ButtonV2>
            <ButtonV2 variant="contrast" icon="open-file" onClick={openVerification}>
              {language.t("settings.connectors.github.openBrowser")}
            </ButtonV2>
          </div>
        </Show>

        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
