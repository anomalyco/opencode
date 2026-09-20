import { DialogProvider } from "@opencode/ui/context/dialog"
import { Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider, UiI18nBridge } from "../src/runtime/i18n/language"
import { SESSION_EXECUTION_TAB, openSessionTab, closeSessionTab } from "../src/shell/state/session-tabs"
import { createOpenSessionFileTab, createSessionTabs } from "../src/session/helpers"
import { createExecutionModel } from "../src/superpowers/model"
import { ExecutionPanel, type ExecutionPresentation } from "../src/superpowers/panel"

export async function mountExecutionFixture(input: {
  surface?: ExecutionPresentation
  scenario?: string
} = {}): Promise<ReturnType<typeof render>> {
  const host = document.createElement("main")
  host.dataset.testid = "execution-fixture"
  host.style.cssText = "position:fixed;inset:0;z-index:1000;background:#181818;color:#eee;padding:24px"
  document.body.appendChild(host)

  function Fixture() {
    const [state, setState] = createStore({
      active: "file://a.ts" as string | undefined,
      all: ["file://a.ts"] as string[],
      preview: undefined as string | undefined,
      loaded: [] as string[],
      navigationTarget: "",
    })
    const pathFromTab = (tab: string) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined)
    const normalizeTab = (tab: string) => tab
    const current = () => ({ tabs: { all: state.all, active: state.active }, preview: state.preview })
    const apply = (next: ReturnType<typeof openSessionTab>) =>
      setState({ all: next.tabs.all, active: next.tabs.active, preview: next.preview })
    const tabs = createSessionTabs({
      tabs: () => ({ active: () => state.active, all: () => state.all }),
      pathFromTab,
      normalizeTab,
      fileBrowser: () => true,
      execution: () => true,
    })
    const openFileTab = createOpenSessionFileTab({
      normalizeTab,
      openTab: (tab) => apply(openSessionTab(current(), tab)),
      pathFromTab,
      loadFile: (path) => setState("loaded", (loaded) => [...loaded, path]),
      openReviewPanel: () => undefined,
      setActive: (tab) => setState("active", tab),
    })
    const model = createExecutionModel({
      mode: () => "observer",
      openSession: (sessionID) => setState("navigationTarget", sessionID),
    })
    const executionVisible = createMemo(() => tabs.activeTab() === SESSION_EXECUTION_TAB)

    return (
      <>
        <nav data-testid="execution-fixture-controls">
          <button type="button" onClick={() => openFileTab("file://a.ts")}>
            Open File A
          </button>
          <button type="button" onClick={() => openFileTab("file://b.ts")}>
            Open File B
          </button>
          <button type="button" onClick={() => apply(openSessionTab(current(), SESSION_EXECUTION_TAB))}>
            Open Execution
          </button>
          <button type="button" onClick={() => apply(closeSessionTab(current(), SESSION_EXECUTION_TAB))}>
            Close Execution
          </button>
        </nav>
        <div data-testid="execution-open-tabs">{state.all.join(",")}</div>
        <div data-testid="execution-file-tab">{tabs.activeFileTab() ?? ""}</div>
        <div data-testid="execution-load-log">{state.loaded.join(",")}</div>
        <div data-testid="navigation-target">{state.navigationTarget}</div>
        <Show when={executionVisible()}>
          <ExecutionPanel model={model} presentation={input.surface ?? "panel"} />
        </Show>
      </>
    )
  }

  return render(
    () => (
      <LanguageProvider locale="en">
        <UiI18nBridge>
          <DialogProvider>
            <Fixture />
          </DialogProvider>
        </UiI18nBridge>
      </LanguageProvider>
    ),
    host,
  )
}
