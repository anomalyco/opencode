import { Component, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { useGlobal } from "@/runtime/server/runtime"
import { usePlatform } from "@/runtime/platform/platform"
import { useSettingsServers } from "@/settings/servers/inventory"
import type { PushIssue } from "@/shell/notifications/push"
import {
  createSoundSettingsController,
  soundOptions,
  type SoundSettingsController,
} from "@/settings/general/controllers"
import "@/settings/settings.css"

const soundSettings = {
  agent: {
    action: "settings-sounds-agent",
    title: "settings.general.sounds.agent.title",
    description: "settings.general.sounds.agent.description",
  },
  permissions: {
    action: "settings-sounds-permissions",
    title: "settings.general.sounds.permissions.title",
    description: "settings.general.sounds.permissions.description",
  },
  errors: {
    action: "settings-sounds-errors",
    title: "settings.general.sounds.errors.title",
    description: "settings.general.sounds.errors.description",
  },
} as const

const SoundSetting: Component<{
  kind: "agent" | "permissions" | "errors"
  channel: SoundSettingsController["agent"]
}> = (props) => {
  const language = useLanguage()
  const config = () => soundSettings[props.kind]

  return (
    <SettingsRow title={language.t(config().title)} description={language.t(config().description)}>
      <Select
        data-action={config().action}
        options={soundOptions}
        current={props.channel.current()}
        value={(option) => option.id}
        label={(option) => language.t(option.label)}
        onHighlight={props.channel.highlight}
        onSelect={props.channel.select}
        placement="bottom-end"
        gutter={6}
      />
    </SettingsRow>
  )
}

export const SettingsNotifications: Component = () => {
  const language = useLanguage()
  const settings = useSettings()
  const sounds = createSoundSettingsController()
  const platform = usePlatform()
  const global = useGlobal()
  const servers = useSettingsServers()
  const [pushState, setPushState] = createStore<{ key?: string }>({ key: undefined })

  const connected = createMemo(() => servers().filter((server) => server.connection))
  const selected = createMemo(() => connected().find((server) => server.key === pushState.key) ?? connected()[0])

  const push = createMemo(() => {
    const server = selected()

    if (!server) return

    return global.serverCtx(server.key)?.notification.push
  })

  const issueKey = {
    insecure: "settings.notifications.push.insecure",
    install: "settings.notifications.push.install",
    unsupported: "settings.notifications.push.unsupported",
    denied: "settings.notifications.push.denied",
    serverUnsupported: "settings.notifications.push.serverUnsupported",
    subscription: "settings.notifications.push.subscription",
    failed: "settings.notifications.push.failed",
  } as const satisfies Record<PushIssue, string>

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.notifications")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              {language.t("settings.notifications.description")}
            </span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <Show when={platform.platform === "web" && connected().length > 0}>
          <div class="settings-section">
            <h3 class="settings-section-title">{language.t("settings.notifications.push.title")}</h3>
            <SettingsList>
              <SettingsRow
                title={language.t("settings.notifications.push.server")}
                description={language.t("settings.notifications.push.serverDescription")}
              >
                <Select
                  data-action="settings-notifications-push-server"
                  options={connected()}
                  current={selected()}
                  value={(server) => server.key}
                  label={(server) => server.name}
                  onSelect={(server) => server && setPushState("key", server.key)}
                  placement="bottom-end"
                  gutter={6}
                />
              </SettingsRow>
              <Show when={push()} keyed>
                {(controller) => (
                  <SettingsRow
                    title={language.t("settings.notifications.push.toggle")}
                    description={language.t("settings.notifications.push.toggleDescription")}
                  >
                    <div data-action="settings-notifications-push-toggle">
                      <Switch
                        checked={controller.state.enabled}
                        disabled={controller.state.busy || !controller.ready()}
                        hideLabel
                        onChange={(checked) => void (checked ? controller.enable() : controller.disable())}
                      >
                        {language.t("settings.notifications.push.toggle")}
                      </Switch>
                    </div>
                  </SettingsRow>
                )}
              </Show>
            </SettingsList>
            <p class="text-12-regular text-v2-text-text-muted break-words">
              {language.t("settings.notifications.push.hint")}
            </p>
            <Show when={push()} keyed>
              {(controller) => (
                <div role="status" class="text-12-regular text-v2-text-text-muted break-words">
                  {controller.state.busy
                    ? language.t("settings.notifications.push.updating")
                    : controller.state.issue
                      ? language.t(issueKey[controller.state.issue])
                      : language.t(
                          controller.state.enabled
                            ? "settings.notifications.push.enabled"
                            : "settings.notifications.push.disabled",
                        )}
                </div>
              )}
            </Show>
          </div>
        </Show>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.general.section.notifications")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.general.notifications.agent.title")}
              description={language.t("settings.general.notifications.agent.description")}
            >
              <div data-action="settings-notifications-agent">
                <Switch
                  checked={settings.notifications.agent()}
                  onChange={(checked) => settings.notifications.setAgent(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.notifications.permissions.title")}
              description={language.t("settings.general.notifications.permissions.description")}
            >
              <div data-action="settings-notifications-permissions">
                <Switch
                  checked={settings.notifications.permissions()}
                  onChange={(checked) => settings.notifications.setPermissions(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.notifications.questions.title")}
              description={language.t("settings.general.notifications.questions.description")}
            >
              <div data-action="settings-notifications-questions">
                <Switch
                  checked={settings.notifications.questions()}
                  onChange={(checked) => settings.notifications.setQuestions(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.notifications.errors.title")}
              description={language.t("settings.general.notifications.errors.description")}
            >
              <div data-action="settings-notifications-errors">
                <Switch
                  checked={settings.notifications.errors()}
                  onChange={(checked) => settings.notifications.setErrors(checked)}
                />
              </div>
            </SettingsRow>
          </SettingsList>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.general.section.sounds")}</h3>
          <SettingsList>
            <SoundSetting kind="agent" channel={sounds.agent} />
            <SoundSetting kind="permissions" channel={sounds.permissions} />
            <SoundSetting kind="errors" channel={sounds.errors} />
          </SettingsList>
        </div>
      </div>
    </>
  )
}
