import { Component, createMemo } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { TextInput } from "@opencode-ai/ui/text-input"
import { Switch } from "@opencode-ai/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { createAppearanceSettingsController, type AppearanceSettingsController } from "@/settings/general/controllers"
import "@/settings/settings.css"

const schemeOptions: ("system" | "light" | "dark")[] = ["system", "light", "dark"]
const tabLayoutOptions: ("horizontal" | "vertical")[] = ["horizontal", "vertical"]
const fontSettings = {
  ui: {
    action: "settings-ui-font",
    title: "settings.general.row.uiFont.title",
    description: "settings.general.row.uiFont.description",
    font: "ui",
    input: "setUI",
  },
  code: {
    action: "settings-code-font",
    title: "settings.general.row.font.title",
    description: "settings.general.row.font.description",
    font: "code",
    input: "setCode",
  },
  terminal: {
    action: "settings-terminal-font",
    title: "settings.general.row.terminalFont.title",
    description: "settings.general.row.terminalFont.description",
    font: "terminal",
    input: "setTerminal",
  },
} as const

const FontSetting: Component<{
  kind: "ui" | "code" | "terminal"
  fonts: AppearanceSettingsController["fonts"]
}> = (props) => {
  const language = useLanguage()
  const config = () => fontSettings[props.kind]
  return (
    <SettingsRow title={language.t(config().title)} description={language.t(config().description)}>
      <div class="w-full sm:w-[220px]">
        <TextInput
          data-action={config().action}
          type="text"
          appearance="base"
          value={props.fonts[config().font]().value}
          onInput={(event) => props.fonts[config().input](event.currentTarget.value)}
          placeholder={props.fonts[config().font]().placeholder}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          aria-label={language.t(config().title)}
          style={{ "font-family": props.fonts[config().font]().family }}
        />
      </div>
    </SettingsRow>
  )
}

export const SettingsAppearance: Component = () => {
  const language = useLanguage()
  const appearance = createAppearanceSettingsController()

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.general.section.appearance")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.appearance.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <div class="settings-section">
          <SettingsList>
            <SettingsRow
              title={language.t("settings.general.row.colorScheme.title")}
              description={language.t("settings.general.row.colorScheme.description")}
            >
              <Select
                data-action="settings-color-scheme"
                options={schemeOptions}
                current={schemeOptions.find((option) => option === appearance.scheme.current())}
                placement="bottom-end"
                gutter={6}
                label={(option) => {
                  if (option === "system") return language.t("theme.scheme.system")
                  if (option === "light") return language.t("theme.scheme.light")
                  return language.t("theme.scheme.dark")
                }}
                onSelect={(option) => option && appearance.scheme.select(option)}
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.row.theme.title")}
              description={
                <>
                  {language.t("settings.general.row.theme.description")}{" "}
                  <ExternalLink class="settings-link" href="https://opencode.ai/docs/themes/">
                    {language.t("common.learnMore")}
                  </ExternalLink>
                </>
              }
            >
              <Select
                data-action="settings-theme"
                options={appearance.theme.options()}
                current={appearance.theme.current()}
                placement="bottom-end"
                gutter={6}
                value={(option) => option.id}
                label={(option) => option.name}
                onSelect={appearance.theme.select}
              />
            </SettingsRow>

            <FontSetting kind="ui" fonts={appearance.fonts} />
            <FontSetting kind="code" fonts={appearance.fonts} />
            <FontSetting kind="terminal" fonts={appearance.fonts} />
          </SettingsList>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.appearance.section.experimental")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.appearance.row.tabs.title")}
              description={language.t("settings.appearance.row.tabs.description")}
            >
              <Select
                data-action="settings-tab-layout"
                options={tabLayoutOptions}
                current={tabLayoutOptions.find((option) => option === appearance.tabs.current())}
                placement="bottom-end"
                gutter={6}
                label={(option) =>
                  option === "horizontal"
                    ? language.t("settings.appearance.row.tabs.horizontal")
                    : language.t("settings.appearance.row.tabs.vertical")
                }
                onSelect={(option) => option && appearance.tabs.select(option)}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.appearance.row.projectName.title")}
              description={language.t("settings.appearance.row.projectName.description")}
            >
              <div data-action="settings-show-project-name">
                <Switch
                  checked={appearance.projectName.current()}
                  onChange={appearance.projectName.set}
                  hideLabel
                >
                  {language.t("settings.appearance.row.projectName.title")}
                </Switch>
              </div>
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </>
  )
}
