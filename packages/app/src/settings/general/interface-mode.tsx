import { For, Match, Show, Switch, createUniqueId } from "solid-js"
import { Select } from "@opencode/ui/select"
import { useLanguage } from "@/runtime/i18n/language"
import { type TabLayout, useSettings } from "@/settings/model"
import { SettingsRow } from "@/settings/row"
import "./interface-mode.css"

const modes = [
  { id: "top", layout: "horizontal" },
  { id: "side", layout: "vertical" },
  { id: "inbox", layout: "inbox" },
] as const satisfies { id: string; layout: TabLayout }[]

export function InterfaceModeSetting() {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <Show when={settings.appearance.navigationPrototype()} fallback={<TabLayoutSetting />}>
      <NavigationSetting />
      <Show when={settings.appearance.navigation() === "tabs"}>
        <SettingsRow title={language.t("settings.general.row.tabPosition.title")} description="">
          <Select
            data-action="settings-tab-position"
            options={["horizontal", "vertical"] as const}
            current={settings.appearance.tabPosition()}
            label={(value) =>
              language.t(
                value === "horizontal"
                  ? "settings.general.row.interfaceMode.top"
                  : "settings.general.row.interfaceMode.side",
              )
            }
            onSelect={(value) =>
              (value === "horizontal" || value === "vertical") && settings.appearance.setTabLayout(value)
            }
            placement="bottom-end"
            gutter={6}
          />
        </SettingsRow>
      </Show>
    </Show>
  )
}

function NavigationSetting() {
  const language = useLanguage()
  const settings = useSettings()
  const id = createUniqueId()

  return (
    <SettingsRow
      title={language.t("settings.general.row.navigation.title")}
      description={<span class="[text-wrap:balance]">{language.t("settings.general.row.navigation.description")}</span>}
      align="start"
    >
      <fieldset data-component="navigation-mode" data-action="settings-navigation">
        <legend class="sr-only">{language.t("settings.general.row.navigation.title")}</legend>
        <For each={["tabs", "list"] as const}>
          {(mode) => (
            <label
              data-slot="navigation-mode-option"
              data-checked={settings.appearance.navigation() === mode ? "" : undefined}
            >
              <input
                type="radio"
                name={id}
                value={mode}
                checked={settings.appearance.navigation() === mode}
                onChange={() => settings.appearance.setNavigation(mode)}
              />
              {/* A window that shows only its navigation: a row of tabs across the top, or a list down the side. */}
              <span data-slot="navigation-mode-sketch" data-mode={mode} aria-hidden="true">
                <Show
                  when={mode === "tabs"}
                  fallback={
                    <span data-slot="sketch-list">
                      <For each={[0, 1, 2, 3, 4]}>
                        {(index) => <span data-slot="sketch-row" data-active={index === 1 ? "" : undefined} />}
                      </For>
                    </span>
                  }
                >
                  <span data-slot="sketch-tabs">
                    <For each={[0, 1, 2]}>
                      {(index) => <span data-slot="sketch-tab" data-active={index === 0 ? "" : undefined} />}
                    </For>
                  </span>
                </Show>
              </span>
              <span data-slot="navigation-mode-name">{language.t(`settings.general.row.navigation.${mode}`)}</span>
            </label>
          )}
        </For>
      </fieldset>
    </SettingsRow>
  )
}

function TabLayoutSetting() {
  const language = useLanguage()
  const settings = useSettings()
  const id = createUniqueId()

  return (
    <SettingsRow
      title={language.t("settings.general.row.interfaceMode.title")}
      description={language.t("settings.general.row.interfaceMode.description")}
      align="start"
    >
      <fieldset data-component="interface-mode" data-action="settings-tab-layout">
        <legend class="sr-only">{language.t("settings.general.row.interfaceMode.title")}</legend>
        <For each={modes}>
          {(mode) => (
            <label
              data-slot="interface-mode-option"
              data-checked={settings.appearance.tabLayout() === mode.layout ? "" : undefined}
            >
              <input
                type="radio"
                name={id}
                value={mode.id}
                checked={settings.appearance.tabLayout() === mode.layout}
                onChange={() => settings.appearance.setTabLayout(mode.layout)}
              />
              <span data-slot="interface-mode-sketch" data-mode={mode.id} aria-hidden="true">
                <Switch>
                  <Match when={mode.id === "top"}>
                    <span data-slot="preview-strip">
                      <For each={[0, 1, 2]}>
                        {(index) => <span data-slot="preview-tab" data-active={index === 0 ? "" : undefined} />}
                      </For>
                    </span>
                  </Match>
                  <Match when={mode.id === "side"}>
                    <span data-slot="preview-rail">
                      <For each={[0, 1, 2, 3]}>
                        {(index) => <span data-slot="preview-tab" data-active={index === 0 ? "" : undefined} />}
                      </For>
                    </span>
                  </Match>
                  <Match when={mode.id === "inbox"}>
                    <span data-slot="preview-rail">
                      <For each={inboxRows}>
                        {(status, index) => (
                          <span data-slot="preview-tab" data-active={index() === 0 ? "" : undefined}>
                            <i data-status={status} />
                          </span>
                        )}
                      </For>
                    </span>
                  </Match>
                </Switch>
                <span data-slot="preview-page">
                  <span data-slot="preview-line" />
                  <span data-slot="preview-line" />
                  <span data-slot="preview-composer" />
                </span>
              </span>
              <span data-slot="interface-mode-name">{language.t(`settings.general.row.interfaceMode.${mode.id}`)}</span>
            </label>
          )}
        </For>
      </fieldset>
    </SettingsRow>
  )
}

// Mirrors the inbox: a session that needs you, then finished work, then sessions still running.
const inboxRows = ["approval", "done", "working", "working"] as const
