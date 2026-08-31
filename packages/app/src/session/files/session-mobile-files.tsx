import { Button } from "@opencode-ai/ui/button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { getFilename } from "@opencode-ai/util/path"
import { createMemo, For } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useSessionLayout } from "@/session/session-layout"
import { createSessionTabs, SESSION_OPEN_FILE_TAB } from "@/session/helpers"
import { useFile } from "@/workspaces/files/model"
import { SessionFileBrowserTab } from "./session-file-browser-tab"
import type { Kind } from "./file-tree-v2"
import "./session-mobile-files.css"

export function SessionMobileFiles() {
  const file = useFile()
  const language = useLanguage()
  const layout = useSessionLayout()
  const tabs = createSessionTabs({
    tabs: layout.tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: file.tab,
  })
  const [store, setStore] = createStore({ browsing: !tabs.activeFileTab() })
  const browsing = () => store.browsing || !tabs.activeFileTab()
  const active = createMemo(() => file.pathFromTab(tabs.activeFileTab() ?? ""))
  const kinds = new Map<string, Kind>()
  const open = (path: string) => {
    layout.tabs().open(file.tab(path))
    void file.load(path)
    setStore("browsing", false)
  }

  return (
    <div data-slot="session-mobile-files" data-browsing={browsing()} class="flex h-full min-h-0 flex-col">
      <div data-slot="session-mobile-files-header" class="relative flex h-10 shrink-0 items-center">
        <Button
          size="small"
          variant="ghost"
          class="shrink-0 mx-2"
          onClick={() => setStore("browsing", true)}
          aria-pressed={browsing()}
        >
          {language.t("session.files.all")}
        </Button>
        <Tabs
          value={browsing() ? SESSION_OPEN_FILE_TAB : tabs.activeFileTab()}
          onChange={(tab) => {
            // Kobalte falls back to a file tab when the browse view has no trigger.
            if (browsing()) return
            const path = file.pathFromTab(tab)
            if (path) open(path)
          }}
          variant="line"
          class="min-w-0 flex-1 !h-auto"
        >
          <Tabs.List aria-label={language.t("session.files.openTabs")} class="!h-10 !px-0 overflow-x-auto">
            <For each={tabs.openedTabs()}>
              {(tab) => (
                <Tabs.Trigger
                  value={tab}
                  onClick={() => open(file.pathFromTab(tab)!)}
                  class="shrink-0 max-w-48"
                  classes={{ button: "min-w-0" }}
                  closeButton={
                    <Tabs.CloseButton
                      aria-label={language.t("common.closeTab")}
                      onClick={() => layout.tabs().close(tab)}
                    />
                  }
                >
                  <span dir="ltr" class="truncate">
                    {getFilename(file.pathFromTab(tab) ?? tab)}
                  </span>
                </Tabs.Trigger>
              )}
            </For>
          </Tabs.List>
        </Tabs>
      </div>
      <div class="min-h-0 flex-1">
        <SessionFileBrowserTab
          mobile
          tab={tabs.activeFileTab() ?? SESSION_OPEN_FILE_TAB}
          placeholder={browsing()}
          active={active()}
          kinds={kinds}
          state={{
            sidebarOpened: browsing,
            sidebarWidth: () => 240,
            sidebarTransition: () => false,
            resizeSidebar: () => undefined,
            toggleSidebar: () => setStore("browsing", !browsing()),
          }}
          onSelect={open}
          onSelectPermanent={open}
        />
      </div>
    </div>
  )
}
