/** @jsxImportSource solid-js */
import { Icon } from "@opencode-ai/ui/icon"
import { For } from "solid-js"

export type BrowserTab = {
  id: string
  title: string
  url: string
}

type BrowserPanelTabsProps = {
  tabs: BrowserTab[]
  activeTabId: string | null
  onSelectTab: (id: string) => void
  onNewTab: () => void
  onCloseTab: (id: string) => void
}

function getTabTitle(tab: BrowserTab) {
  return tab.title || tab.url || "New tab"
}

export function BrowserPanelTabs(props: BrowserPanelTabsProps) {
  return (
    <ul class="browser-tabs" role="list" aria-label="Browser tabs">
      <For each={props.tabs}>
        {(tab) => (
          <li
            class="browser-tab"
            classList={{ "browser-tab--active": props.activeTabId === tab.id }}
          >
            <button
              type="button"
              class="browser-tab-button"
              aria-label={`Select ${getTabTitle(tab)}`}
              aria-current={props.activeTabId === tab.id ? "page" : undefined}
              title={tab.url || tab.title || "New tab"}
              onClick={() => props.onSelectTab(tab.id)}
            >
              <Icon size="small" name="browser" />
              <span class="browser-tab-title">{getTabTitle(tab)}</span>
            </button>
            {tab.id !== "default" && (
              <button
                type="button"
                class="browser-tab-close"
                onClick={(event) => {
                  event.stopPropagation()
                  props.onCloseTab(tab.id)
                }}
                aria-label="Close tab"
                title="Close tab"
              >
                <Icon size="small" name="close" />
              </button>
            )}
          </li>
        )}
      </For>
      <li class="browser-tab-new">
        <button type="button" class="browser-tab-add" onClick={props.onNewTab} aria-label="New browser tab" title="New tab">
          <Icon size="small" name="plus" />
        </button>
      </li>
    </ul>
  )
}
