import { createSignal, For, Show, onMount, onCleanup } from "solid-js"
import type { TabInfo, GroupedTabs } from "../../utils/browser-context"

interface TabPickerProps {
  onSelect: (tab: TabInfo) => void
  onClose: () => void
  currentTabId?: number
}

export function TabPicker(props: TabPickerProps) {
  const [search, setSearch] = createSignal("")
  const [tabs, setTabs] = createSignal<GroupedTabs>({ groups: [], ungrouped: [] })
  const [loading, setLoading] = createSignal(true)

  let containerRef: HTMLDivElement | undefined

  onMount(async () => {
    const response = await chrome.runtime.sendMessage({ type: "GET_TABS_WITH_GROUPS" })
    if (response?.tabs) {
      setTabs(response.tabs)
    }
    setLoading(false)

    document.addEventListener("click", handleClickOutside)
  })

  onCleanup(() => {
    document.removeEventListener("click", handleClickOutside)
  })

  function handleClickOutside(e: MouseEvent) {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      props.onClose()
    }
  }

  function filterTabs(tabList: TabInfo[]): TabInfo[] {
    const query = search().toLowerCase()
    if (!query) return tabList
    return tabList.filter((t) => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query))
  }

  function getAllFilteredTabs(): {
    groups: Array<{ title: string; color: string; tabs: TabInfo[] }>
    ungrouped: TabInfo[]
  } {
    const data = tabs()
    return {
      groups: data.groups.map((g) => ({ ...g, tabs: filterTabs(g.tabs) })).filter((g) => g.tabs.length > 0),
      ungrouped: filterTabs(data.ungrouped),
    }
  }

  return (
    <div class="tab-picker" ref={containerRef}>
      <div class="tab-picker-search">
        <input
          type="text"
          placeholder="Search tabs..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          autofocus
        />
      </div>

      <div class="tab-picker-list">
        <Show when={loading()}>
          <div class="tab-picker-loading">Loading tabs...</div>
        </Show>

        <Show when={!loading()}>
          <For each={getAllFilteredTabs().groups}>
            {(group) => (
              <div class="tab-group">
                <div class="tab-group-header">
                  <span class="tab-group-color" style={{ background: group.color }} />
                  <span class="tab-group-title">{group.title || "Group"}</span>
                </div>
                <For each={group.tabs}>
                  {(tab) => (
                    <button
                      class={`tab-picker-item ${tab.id === props.currentTabId ? "active" : ""}`}
                      onClick={() => props.onSelect(tab)}
                    >
                      <Show when={tab.favIconUrl} fallback={<span class="tab-item-icon" innerHTML={ICONS.globe} />}>
                        <img src={tab.favIconUrl} alt="" class="tab-item-favicon" />
                      </Show>
                      <span class="tab-item-title">{tab.title}</span>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>

          <Show when={getAllFilteredTabs().ungrouped.length > 0}>
            <div class="tab-group ungrouped">
              <For each={getAllFilteredTabs().ungrouped}>
                {(tab) => (
                  <button
                    class={`tab-picker-item ${tab.id === props.currentTabId ? "active" : ""}`}
                    onClick={() => props.onSelect(tab)}
                  >
                    <Show when={tab.favIconUrl} fallback={<span class="tab-item-icon" innerHTML={ICONS.globe} />}>
                      <img src={tab.favIconUrl} alt="" class="tab-item-favicon" />
                    </Show>
                    <span class="tab-item-title">{tab.title}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>

          <Show when={getAllFilteredTabs().groups.length === 0 && getAllFilteredTabs().ungrouped.length === 0}>
            <div class="tab-picker-empty">No matching tabs</div>
          </Show>
        </Show>
      </div>
    </div>
  )
}

const ICONS = {
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`,
}
