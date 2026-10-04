import { createMemo, For } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Tabs } from "@opencode/ui/tabs"
import { getFilename } from "@opencode/util/path"
import type { ChangeKind } from "../review/contract"
import { Layout, useExtension, usePanel, type SessionView } from "../sdk"
import { SessionFileBrowserTab } from "./browser"
import { useShared } from "./context"
import { fileTabPath, isFileTab } from "./path"

const OPEN_FILE_TAB = "open-file"

export default function SessionMobileFiles(props: { session: SessionView }) {
  const ctx = useExtension()
  const layout = ctx.use(Layout)
  const shared = useShared()
  const panel = usePanel()
  const file = props.session.file
  const opened = createMemo(() => panel.open().filter(isFileTab))
  // The selected side tab when it is a file tab. A gone selection falls back to the first file tab.
  const activeFileTab = createMemo(() => opened().find((id) => shared.active(props.session, id)))
  const [store, setStore] = createStore({ browsing: !activeFileTab() })
  const browsing = () => store.browsing || !activeFileTab()
  const active = createMemo(() => {
    const id = activeFileTab()
    return id ? fileTabPath(file, id) : undefined
  })
  const kinds = new Map<string, ChangeKind>()
  const open = (path: string) => {
    shared.open(props.session, path)
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
          {ctx.t("tree.all")}
        </Button>
        <Tabs
          value={browsing() ? OPEN_FILE_TAB : activeFileTab()}
          onChange={(id) => {
            // Kobalte falls back to a file tab when the browse view has no trigger.
            if (browsing()) return
            if (id === OPEN_FILE_TAB) return
            open(fileTabPath(file, id))
          }}
          variant="line"
          class="min-w-0 flex-1 !h-auto"
        >
          <Tabs.List aria-label={ctx.t("mobile.openTabs")} class="!h-10 !px-0 overflow-x-auto">
            <For each={opened()}>
              {(id) => (
                <Tabs.Trigger
                  value={id}
                  onClick={() => open(fileTabPath(file, id))}
                  class="shrink-0 max-w-48"
                  classes={{ button: "min-w-0" }}
                  closeButton={
                    <Tabs.CloseButton
                      aria-label={ctx.t("common.closeTab")}
                      onClick={() => layout.close(`file:${id}`, props.session)}
                    />
                  }
                >
                  <span dir="ltr" class="truncate">
                    {getFilename(fileTabPath(file, id))}
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
          session={props.session}
          id={activeFileTab()}
          placeholder={browsing()}
          active={active()}
          kinds={kinds}
          state={{
            opened: browsing,
            width: () => 240,
            transition: () => false,
            resize: () => undefined,
            toggle: () => setStore("browsing", !browsing()),
          }}
          onSelect={open}
          onSelectPermanent={open}
        />
      </div>
    </div>
  )
}
