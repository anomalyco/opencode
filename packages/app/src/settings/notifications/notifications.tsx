import { Component, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { useGlobal } from "@/runtime/server/runtime"
import { serverName } from "@/runtime/server/registry"
import { usePlatform } from "@/runtime/platform/platform"
import { InlineServerSelect } from "@/settings/server-select"
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
  const global = useGlobal()
  const platform = usePlatform()
  const push = () => {
    const server = global.settings.server.selected()
    return server ? global.ensureServerCtx(server).notification.push : undefined
  }

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

      <div class="settings-tab-body">
        <Show when={platform.platform === "web" && push()} keyed>
          {(push) => (
            <div class="settings-section">
              <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h3 class="settings-section-title">{language.t("settings.notifications.push.title")}</h3>
                <InlineServerSelect />
              </div>
              <SettingsList>
                <SettingsRow
                  title={
                    <span class="break-all">
                      {language.t("settings.notifications.push.server", {
                        server: serverName(global.settings.server.selected()),
                      })}
                    </span>
                  }
                  description={language.t("settings.notifications.push.description")}
                >
                  <div class="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={push.state.busy || !push.ready()}
                      onClick={() => void (push.state.enabled ? push.disable() : push.enable())}
                    >
                      {language.t(
                        push.state.enabled
                          ? "settings.notifications.push.disable"
                          : "settings.notifications.push.enable",
                      )}
                    </Button>
                    <Show when={!push.state.enabled && (push.wanted() || push.state.issue === "subscription")}>
                      <Button
                        variant="outline"
                        disabled={push.state.busy || !push.ready()}
                        onClick={() => void push.disable()}
                      >
                        {language.t("settings.notifications.push.disable")}
                      </Button>
                    </Show>
                  </div>
                </SettingsRow>
              </SettingsList>
              <div role="status" class="text-12-regular text-v2-text-text-muted break-words">
                {push.state.busy
                  ? language.t("settings.notifications.push.updating")
                  : push.state.issue
                    ? language.t(`settings.notifications.push.${push.state.issue}`)
                    : language.t(
                        push.state.enabled
                          ? "settings.notifications.push.enabled"
                          : "settings.notifications.push.disabled",
                      )}
              </div>
            </div>
          )}
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
