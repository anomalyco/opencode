import { Button } from "@opencode/ui/button"
import { Tabs } from "@opencode/ui/tabs"
import { getFilename } from "@opencode/util/path"
import { createMemo, For } from "solid-js"
import { createStore } from "solid-js/store"
import { useEnvironment, useLanguage } from "../environment"
import { SessionFileBrowserTab } from "./session-file-browser-tab"
import type { Kind } from "./file-tree-v2"
import { SessionMobileFilePanel } from "@opencode/session-ui/v2/session-file-panel-v2"

export function SessionMobileFiles() {
  const environment = useEnvironment()
  const file = environment.services.files
  const tabs = environment.services.view.tabs
  const language = useLanguage()
  const opened = createMemo(() => tabs.all().filter((tab) => !!file.pathFromTab(tab)))
  const activeFileTab = () => (opened().includes(tabs.active() ?? "") ? tabs.active() : opened()[0])
  const [store, setStore] = createStore({ browsing: !activeFileTab() })
  const browsing = () => store.browsing || !activeFileTab()
  const active = createMemo(() => file.pathFromTab(activeFileTab() ?? ""))
  const kinds = new Map<string, Kind>()
  const open = (path: string) => {
    const tab = file.tab(path)
    void tabs.open(tab)
    tabs.setActive(tab)
    void file.load(path)
    setStore("browsing", false)
  }
  return (
    <SessionMobileFilePanel
      browsing={browsing()}
      header={
        <>
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
            value={browsing() ? "open-file" : activeFileTab()}
            onChange={(tab) => {
              if (browsing()) return
              const path = file.pathFromTab(tab)
              if (path) open(path)
            }}
            variant="line"
            class="min-w-0 flex-1 !h-auto"
          >
            <Tabs.List aria-label={language.t("session.files.openTabs")} class="!h-10 !px-0 overflow-x-auto">
              <For each={opened()}>
                {(tab) => (
                  <Tabs.Trigger
                    value={tab}
                    onClick={() => open(file.pathFromTab(tab)!)}
                    class="shrink-0 max-w-48"
                    classes={{ button: "min-w-0" }}
                    closeButton={
                      <Tabs.CloseButton aria-label={language.t("common.closeTab")} onClick={() => tabs.close(tab)} />
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
        </>
      }
    >
      <SessionFileBrowserTab
        mobile
        tab={activeFileTab() ?? "open-file"}
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
    </SessionMobileFilePanel>
  )
}
