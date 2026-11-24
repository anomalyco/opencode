import { For, Show, createUniqueId } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Select } from "@opencode/ui/select"
import { useLanguage } from "@/runtime/i18n/language"
import { type TabLayout, useSettings } from "@/settings/model"
import { SettingsRow } from "@/settings/row"
import { useServers } from "@/runtime/server/registry"
import "./interface-mode.css"

const modes = [
  { id: "top", layout: "horizontal" },
  { id: "side", layout: "vertical" },
  { id: "inbox", layout: "inbox" },
] as const satisfies { id: string; layout: TabLayout }[]

export function InterfaceModeSetting() {
  const language = useLanguage()
  const settings = useSettings()
  const servers = useServers()

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
        <SettingsRow title={language.t("settings.general.row.tabGrouping.title")} description="">
          <Select
            data-action="settings-tab-grouping"
            options={
              servers.visible.length > 1 ? (["none", "project", "server"] as const) : (["none", "project"] as const)
            }
            current={settings.appearance.tabGrouping()}
            label={(value) => language.t(`settings.general.row.tabGrouping.${value}`)}
            onSelect={(value) =>
              (value === "none" || value === "project" || value === "server") &&
              settings.appearance.setTabGrouping(value)
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
              <ModeSketch
                slot="navigation-mode-sketch"
                mode={mode === "list" ? "list" : settings.appearance.tabPosition() === "vertical" ? "side" : "top"}
              />
              <span data-slot="navigation-mode-name">{language.t(`settings.general.row.navigation.${mode}`)}</span>
              <Show when={settings.appearance.navigation() === mode}>
                <ModeCheck />
              </Show>
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
              <ModeSketch slot="interface-mode-sketch" mode={mode.id} />
              <span data-slot="interface-mode-name">{language.t(`settings.general.row.interfaceMode.${mode.id}`)}</span>
              <Show when={settings.appearance.tabLayout() === mode.layout}>
                <ModeCheck />
              </Show>
            </label>
          )}
        </For>
      </fieldset>
    </SettingsRow>
  )
}

// A window that shows only its navigation: tabs across the top or down the side, or sessions grouped under headings.
function ModeSketch(props: {
  slot: "interface-mode-sketch" | "navigation-mode-sketch"
  mode: "top" | "side" | "inbox" | "list"
}) {
  return (
    <span data-slot={props.slot} data-mode={props.mode} aria-hidden="true">
      <Show
        when={props.mode === "top"}
        fallback={
          <span data-slot="sketch-list">
            <Show
              when={props.mode !== "side"}
              fallback={
                <For each={[0, 1, 2, 3, 4]}>
                  {(index) => <span data-slot="sketch-row" data-active={index === 1 ? "" : undefined} />}
                </For>
              }
            >
              <For each={props.mode === "inbox" ? inboxRows : listRows}>
                {(row) => (
                  <Show when={row !== "heading"} fallback={<span data-slot="sketch-heading" />}>
                    <span data-slot="sketch-row" data-detail="" data-status={row === "session" ? undefined : row} />
                  </Show>
                )}
              </For>
            </Show>
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
  )
}

function ModeCheck() {
  return (
    <span data-slot="mode-option-check" aria-hidden="true">
      <Icon name="check" size="small" />
    </span>
  )
}

// Mirrors the inbox: a session that needs you, then finished work, then sessions still running.
const inboxRows = ["heading", "approval", "done", "heading", "working", "working"] as const

const listRows = ["heading", "session", "session", "heading", "session", "session"] as const
