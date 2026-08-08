import { Component, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useLanguage } from "@/context/language"
import type { GitHubConnectorStatus } from "@/connectors/types"
import "./settings-v2.css"

export const ConnectorCard: Component<{
  status: GitHubConnectorStatus
  onToggle: (enabled: boolean) => void
  onOpen: () => void
}> = (props) => {
  const language = useLanguage()

  return (
    <div
      data-component="connector-card"
      classList={{ "is-enabled": props.status.enabled, "is-connected": props.status.connected }}
      onClick={props.onOpen}
      role="button"
      tabindex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          props.onOpen()
        }
      }}
    >
      <div data-slot="connector-card-icon">
        <Icon name="github" />
      </div>

      <div data-slot="connector-card-copy">
        <div data-slot="connector-card-title">
          {language.t("settings.connectors.github.name")}
          <span
            data-slot="connector-card-badge"
            classList={{
              "is-connected": props.status.connected,
              "is-disabled": !props.status.enabled,
            }}
          >
            {props.status.connected
              ? language.t("settings.connectors.badge.connected")
              : props.status.enabled
                ? language.t("settings.connectors.badge.notConnected")
                : language.t("settings.connectors.badge.disabled")}
          </span>
        </div>
        <div data-slot="connector-card-description">
          <Show when={props.status.connected && props.status.user} fallback={language.t("settings.connectors.github.summary")}>
            {(user) => (
              <span data-slot="connector-card-user">
                <img src={user().avatar} alt="" width={16} height={16} />
                @{user().login}
              </span>
            )}
          </Show>
        </div>
      </div>

      <div
        data-slot="connector-card-control"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Switch
          checked={props.status.enabled}
          onChange={(checked) => props.onToggle(checked)}
          aria-label={language.t("settings.connectors.github.name")}
          hideLabel
        >
          {language.t("settings.connectors.github.name")}
        </Switch>
      </div>
    </div>
  )
}
