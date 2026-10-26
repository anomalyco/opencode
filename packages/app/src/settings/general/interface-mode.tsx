import { For, Match, Show, Switch, createUniqueId } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { type TabLayout, useSettings } from "@/settings/model"
import "./interface-mode.css"

const modes = [
  { id: "top", layout: "horizontal" },
  { id: "side", layout: "vertical" },
  { id: "inbox", layout: "inbox" },
] as const satisfies { id: string; layout: TabLayout }[]

export function InterfaceModeSetting() {
  const language = useLanguage()
  const settings = useSettings()
  const id = createUniqueId()

  return (
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
              aria-labelledby={`${id}-${mode.id}-title`}
              aria-describedby={`${id}-${mode.id}`}
              onChange={() => settings.appearance.setTabLayout(mode.layout)}
            />
            <div data-slot="interface-mode-preview" data-mode={mode.id} aria-hidden="true">
              <Switch>
                <Match when={mode.id === "top"}>
                  <TopTabsPreview />
                </Match>
                <Match when={mode.id === "side"}>
                  <SideTabsPreview />
                </Match>
                <Match when={mode.id === "inbox"}>
                  <InboxPreview />
                </Match>
              </Switch>
            </div>
            <div data-slot="interface-mode-copy">
              <span data-slot="interface-mode-title">
                <span data-slot="interface-mode-radio" />
                <span id={`${id}-${mode.id}-title`}>{language.t(`settings.general.row.interfaceMode.${mode.id}`)}</span>
                <Show when={mode.id === "inbox"}>
                  <span data-slot="interface-mode-badge">
                    {language.t("settings.general.row.interfaceMode.experimental")}
                  </span>
                </Show>
              </span>
              <span id={`${id}-${mode.id}`} data-slot="interface-mode-description">
                {language.t(`settings.general.row.interfaceMode.${mode.id}.description`)}
              </span>
            </div>
          </label>
        )}
      </For>
    </fieldset>
  )
}

// The modes differ only in where sessions are listed, so every preview shares one workspace.
function TopTabsPreview() {
  return (
    <>
      <div data-slot="preview-tabs">
        <For each={[60, 44, 52]}>
          {(width, index) => (
            <span data-slot="preview-tab" data-active={index() === 0 ? "" : undefined}>
              <i />
              <span style={{ width: `${width}%` }} />
            </span>
          )}
        </For>
      </div>
      <PreviewWorkspace />
    </>
  )
}

function SideTabsPreview() {
  return (
    <div data-slot="preview-body">
      <div data-slot="preview-rail">
        <For each={[70, 52, 64, 44, 58, 36]}>
          {(width, index) => (
            <span data-slot="preview-tab" data-active={index() === 1 ? "" : undefined}>
              <i />
              <span style={{ width: `${width}%` }} />
            </span>
          )}
        </For>
      </div>
      <PreviewWorkspace />
    </div>
  )
}

// Mirrors the inbox: sessions that need you, then finished work, then sessions still running.
const inboxSections = [
  { rows: [{ width: 68, status: "approval" }] },
  {
    rows: [
      { width: 56, status: "done" },
      { width: 72, status: "done" },
    ],
  },
  {
    rows: [
      { width: 48, status: "working" },
      { width: 62, status: "working" },
    ],
  },
] as const

function InboxPreview() {
  return (
    <div data-slot="preview-body">
      <div data-slot="preview-rail">
        <For each={inboxSections}>
          {(section, sectionIndex) => (
            <>
              <span data-slot="preview-rail-heading" />
              <For each={section.rows}>
                {(row, index) => (
                  <span data-slot="preview-tab" data-active={sectionIndex() === 1 && index() === 0 ? "" : undefined}>
                    <i data-status={row.status} />
                    <span style={{ width: `${row.width}%` }} />
                  </span>
                )}
              </For>
            </>
          )}
        </For>
      </div>
      <PreviewWorkspace />
    </div>
  )
}

function PreviewWorkspace() {
  return (
    <div data-slot="preview-body">
      <div data-slot="preview-main">
        <div data-slot="preview-toolbar">
          <i />
          <i />
          <i />
          <i />
        </div>
        <For each={[92, 78, 84, 60, 88, 70, 40]}>
          {(width) => <span data-slot="preview-line" style={{ width: `${width}%` }} />}
        </For>
        <span data-slot="preview-composer">
          <i />
          <i />
        </span>
      </div>
      <div data-slot="preview-panel">
        <For each={[80, 64, 72, 50, 68]}>
          {(width) => <span data-slot="preview-line" style={{ width: `${width}%` }} />}
        </For>
      </div>
    </div>
  )
}
