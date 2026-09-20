import { DialogProvider } from "@opencode/ui/context/dialog"
import { DataProvider } from "@opencode/session-ui/context"
import { Show, Suspense, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider, UiI18nBridge } from "../src/runtime/i18n/language"
import { ServerConnection } from "../src/runtime/server/registry"
import { sessionHref } from "../src/shell/routes/session"
import { SESSION_EXECUTION_TAB, closeSessionTab, openSessionTab } from "../src/shell/state/session-tabs"
import { createOpenSessionFileTab, createSessionTabs } from "../src/session/helpers"
import { LazyExecutionPanel, SessionTabAddControl } from "../src/session/files/session-side-panel"
import { BackgroundWorkSummary, type BackgroundTask } from "../src/session/summary/background"
import { createExecutionModel, type ExecutionAttention } from "../src/superpowers/model"
import { ExecutionStatusBadge } from "../src/superpowers/status-badge"
import { agentFixture } from "../src/superpowers/fixtures"
import type { ExecutionScope } from "../src/superpowers/identity"
import type { ExecutionPresentation } from "../src/superpowers/panel"

type PendingRequest = { type: "permission" | "question"; owner: string }

function pendingRequest(scenario: string): PendingRequest | undefined {
  if (scenario === "permission-pending" || scenario === "nested-permission") {
    return { type: "permission", owner: "grandchild" }
  }
  if (scenario === "question-pending") return { type: "question", owner: "child" }
  if (scenario === "offline-pending") return { type: "permission", owner: "child" }
  return undefined
}

function fixtureAttention(scenario: string): ExecutionAttention {
  return {
    stale: scenario === "offline-pending",
    needsInput: pendingRequest(scenario) ? 1 : 0,
    failed: scenario === "failed-pending" ? 1 : 0,
    blocked: scenario === "blocked-pending" ? 1 : 0,
  }
}

const backgroundTasks: BackgroundTask[] = [
  { id: "task_shell", type: "shell", label: "bun run test:components" },
  { id: "task_subagent", type: "subagent", agent: "explore", label: "Reviewing execution UI" },
]

export async function mountExecutionFixture(input: {
  surface?: ExecutionPresentation
  scenario?: string
} = {}): Promise<ReturnType<typeof render>> {
  const scenario = input.scenario ?? "observer"
  const host = document.createElement("main")
  host.dataset.testid = "execution-fixture"
  host.dir = scenario === "rtl" ? "rtl" : "ltr"
  host.style.cssText = "position:fixed;inset:0;background:#181818;color:#eee;padding:24px"
  document.body.appendChild(host)

  function Fixture() {
    const executionInitiallyOpen = scenario.startsWith("agents")
    const [state, setState] = createStore({
      active: executionInitiallyOpen ? (SESSION_EXECUTION_TAB as string | undefined) : undefined,
      all: executionInitiallyOpen ? [SESSION_EXECUTION_TAB] : ([] as string[]),
      preview: undefined as string | undefined,
      loaded: [] as string[],
      browserAvailable: false,
      reviewOpen: false,
      navigationTarget: "",
      navigationHref: "",
      retryTarget: "",
      permissionReplies: 0,
      questionReplies: 0,
      prompts: 0,
      subagents: 0,
      interrupts: 0,
    })
    let requestRegion: HTMLDivElement | undefined
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
    const openFile = createOpenSessionFileTab({
      normalizeTab,
      openTab: (tab) => apply(openSessionTab(current(), tab)),
      pathFromTab,
      loadFile: (path) => setState("loaded", (loaded) => [...loaded, path]),
      openReviewPanel: () => undefined,
      setActive: (tab) => setState("active", tab),
    })
    const scope = (): ExecutionScope => ({ serverKey: "wsl", ownerDirectory: "/root/git/demo", rootSessionID: "root" })
    const model = createExecutionModel({
      mode: () => "observer",
      scope,
      agents: () => agentFixture(scenario),
      attention: () => fixtureAttention(scenario),
      reviewRequest: () => requestRegion?.focus(),
      openSession: (sessionID) => {
        setState("navigationTarget", `${scope().serverKey}/${sessionID}`)
        setState("navigationHref", sessionHref(ServerConnection.Key.make(scope().serverKey), sessionID))
      },
      retry: (sessionID) => setState("retryTarget", sessionID),
    })
    const openExecution = () => {
      model.selectSubview("agents")
      apply(openSessionTab(current(), SESSION_EXECUTION_TAB))
    }
    const executionVisible = createMemo(() => tabs.activeTab() === SESSION_EXECUTION_TAB)
    const request = () => pendingRequest(scenario)
    const tasks = () => (scenario === "background-empty" ? [] : backgroundTasks)

    return (
      <>
        <div data-testid="execution-fixture-controls">
          <button type="button" onClick={() => setState("browserAvailable", (available) => !available)}>
            Toggle browser support
          </button>
          <button type="button" onClick={() => setState("reviewOpen", (open) => !open)}>
            Toggle review
          </button>
          <button type="button" onClick={() => apply(closeSessionTab(current(), SESSION_EXECUTION_TAB))}>
            Close Execution
          </button>
        </div>
        <div
          data-testid="execution-header"
          style={{ position: "relative", height: "48px", display: "flex", "align-items": "center", gap: "8px" }}
        >
          <ExecutionStatusBadge model={model} onOpen={openExecution} />
          <SessionTabAddControl
            browserAvailable={state.browserAvailable}
            executionOpen={tabs.executionOpen()}
            fileKeybind={["Ctrl", "O"]}
            browserKeybind={["Ctrl", "Shift", "B"]}
            onOpenFile={() => openFile("file://a.ts")}
            onOpenBrowser={() => undefined}
            onOpenExecution={openExecution}
          />
        </div>
        <div data-testid="review-state">{String(state.reviewOpen)}</div>
        <div data-testid="execution-browser-available">{String(state.browserAvailable)}</div>
        <div data-testid="execution-open-tabs">{state.all.join(",")}</div>
        <div data-testid="execution-file-tab">{tabs.activeFileTab() ?? ""}</div>
        <div data-testid="execution-load-log">{state.loaded.join(",")}</div>
        <div data-testid="navigation-target">{state.navigationTarget}</div>
        <div data-testid="navigation-href">{state.navigationHref}</div>
        <div data-testid="retry-target">{state.retryTarget}</div>
        <div data-testid="execution-scope-root">{model.scope()?.rootSessionID ?? ""}</div>
        <Show when={request()}>
          {(pending) => (
            <div
              data-testid="native-request-region"
              data-request-type={pending().type}
              tabindex="-1"
              ref={(element) => (requestRegion = element)}
            >
              <span data-testid="native-request-owner">{pending().owner}</span>
              <span>{pending().type === "permission" ? "Permission requested" : "Question requested"}</span>
              <button type="button" onClick={() => setState("permissionReplies", (count) => count + 1)}>
                Allow once
              </button>
              <button type="button" onClick={() => setState("questionReplies", (count) => count + 1)}>
                Submit answer
              </button>
              <button type="button" onClick={() => setState("prompts", (count) => count + 1)}>
                Send prompt
              </button>
              <button type="button" onClick={() => setState("subagents", (count) => count + 1)}>
                Start subagent
              </button>
              <button type="button" onClick={() => setState("interrupts", (count) => count + 1)}>
                Interrupt
              </button>
            </div>
          )}
        </Show>
        <div data-testid="permission-reply-count">{state.permissionReplies}</div>
        <div data-testid="question-reply-count">{state.questionReplies}</div>
        <div data-testid="prompt-count">{state.prompts}</div>
        <div data-testid="subagent-count">{state.subagents}</div>
        <div data-testid="interrupt-count">{state.interrupts}</div>
        <Show when={tasks().length > 0}>
          <BackgroundWorkSummary tasks={tasks()} onViewAgents={openExecution} />
        </Show>
        <Show when={executionVisible()}>
          <Suspense>
            <LazyExecutionPanel model={model} presentation={input.surface ?? "panel"} />
          </Suspense>
        </Show>
      </>
    )
  }

  return render(
    () => (
      <LanguageProvider locale="en">
        <UiI18nBridge>
          <DataProvider
            data={{ session: [], session_status: {}, session_diff: {} }}
            directory="/root/git/demo"
            onSessionHref={(id) => `#${id}`}
          >
            <DialogProvider>
              <Fixture />
            </DialogProvider>
          </DataProvider>
        </UiI18nBridge>
      </LanguageProvider>
    ),
    host,
  )
}
