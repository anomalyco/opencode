import { DialogProvider } from "@opencode/ui/context/dialog"
import { DataProvider } from "@opencode/session-ui/context"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Show, Suspense, createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider, UiI18nBridge } from "../src/runtime/i18n/language"
import { ServerConnection, ServersProvider } from "../src/runtime/server/registry"
import { GlobalProvider } from "../src/runtime/server/runtime"
import { ServerProvider, useServer } from "../src/runtime/server/current"
import { SettingsProvider } from "../src/settings/model"
import { SettingsSurfaceProvider } from "../src/settings/surface"
import { WslServersProvider } from "../src/servers/wsl/context"
import { SshProvider } from "../src/servers/ssh/context"
import { sessionHref } from "../src/shell/routes/session"
import { SESSION_EXECUTION_TAB, closeSessionTab, openSessionTab } from "../src/shell/state/session-tabs"
import { TabsProvider } from "../src/shell/tabs/tabs"
import { createOpenSessionFileTab, createSessionTabs } from "../src/session/helpers"
import { LazyExecutionPanel, SessionTabAddControl } from "../src/session/files/session-side-panel"
import { BackgroundWorkSummary, type BackgroundTask } from "../src/session/summary/background"
import { SessionSummaryPanel } from "../src/session/summary/panel"
import { MessageTimeline } from "../src/session/timeline/message-timeline"
import type { TimelineSessionSource } from "../src/session/timeline/controller"
import { createExecutionModel, type ExecutionAttention, type ExecutionModel, type ExecutionProgress } from "../src/superpowers/model"
import { SessionExecutionProvider } from "../src/superpowers/session-execution"
import { SessionReviewToggle } from "../src/session/header/session-header-actions"
import { ExecutionStatusBadge } from "../src/superpowers/status-badge"
import { agentFixture, failedTaskFixture, increasedScopeRun, runFixture, taskRunFixture } from "../src/superpowers/fixtures"
import type { ExecutionScope } from "../src/superpowers/identity"
import type { ExecutionPresentation } from "../src/superpowers/panel"
import type { SessionModel } from "../src/session/model"
import type { Project } from "../src/runtime/server/types"
import type { SessionInfo } from "@opencode/client/promise"
import type { RunSnapshot, RunSummary } from "@bearmanser/opencode-superpowers-execution/contract"

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
    stale: scenario === "offline-pending" || scenario === "tasks-stale",
    needsInput: pendingRequest(scenario) ? 1 : 0,
    failed: scenario === "failed-pending" ? 1 : 0,
    blocked: scenario === "blocked-pending" ? 1 : 0,
  }
}

function fixtureProgress(scenario: string): ExecutionProgress | undefined {
  if (scenario !== "tracked-progress") return undefined
  return {
    verified: 3,
    total: 5,
    skipped: 0,
    failed: 0,
    blocked: 0,
    awaitingReview: 0,
    percent: 60,
    source: "controller_report",
  }
}

const backgroundTasks: BackgroundTask[] = [
  { id: "task_shell", type: "shell", label: "bun run test:components" },
  { id: "task_subagent", type: "subagent", agent: "explore", label: "Reviewing execution UI" },
]

const desktopServer = { type: "http" as const, http: { url: "http://storybook.local" } }
const desktopQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const desktopProject: Project = {
  id: "demo",
  name: "Demo",
  time: { created: 0, updated: 0 },
  sandboxes: [],
  worktree: "/root/git/demo",
  worktrees: [],
}

const timelineSessionInfo = {
  id: "root",
  projectID: "demo",
  title: "Root controller",
  location: { directory: "/root/git/demo" },
  time: { created: 0, updated: 0 },
} as unknown as SessionInfo

const timelineSource = {
  identity: { params: { id: "root" }, sessionID: () => "root", sessionKey: () => "wsl::root" },
  data: {
    info: () => timelineSessionInfo,
    parent: () => undefined,
    parentID: () => undefined,
    status: () => ({ type: "idle" as const }),
  },
  history: { messages: () => [] },
} as unknown as TimelineSessionSource

function SeedProject() {
  const server = useServer()
  createEffect(() => server.ctx.sync.set("project", [desktopProject]))
  return null
}

const liveSession = {
  identity: { sessionID: () => "root", sessionKey: () => "wsl::root", params: { id: "root" } },
  shared: {
    data: {
      session: {
        get: (id: string) =>
          id === "root" ? { parentID: undefined, location: { directory: "/root/git/demo" } } : undefined,
      },
    },
  },
  workspace: { directory: () => "/root/git/demo" },
  layout: { tabs: () => ({ active: () => "review", all: () => ["review"] }) },
} as unknown as SessionModel

const liveRunSummary: RunSummary = {
  runID: "run-1",
  rootSessionID: "root",
  ownerDirectory: "/root/git/demo",
  title: "Failed fixture run",
  status: "active",
  revision: 3,
  updatedAt: 1_700_000_000_000,
  planRevision: 1,
  progress: {
    verified: 0,
    total: 1,
    skipped: 0,
    failed: 1,
    blocked: 0,
    awaitingReview: 0,
    percent: 0,
    source: "controller_report",
  },
}

function installExecutionTransport() {
  const snapshot = runFixture({ runID: "run-1", revision: 3, tasks: [failedTaskFixture()] })
  const rpc = () => ({
    capabilities: async () => ({ schemaVersion: 1, pluginVersion: "0.1.0", maxTasks: 500, reporting: "controller" }),
    getSummaries: async () => ({ items: [liveRunSummary] }),
    getRun: async () => snapshot,
    listRuns: async () => ({ items: [] }),
    events: {
      subscribe: () => {
        throw new Error("events.subscribe is not used by the bridge")
      },
      on: () => () => undefined,
    },
  })
  const listeners = new Set<(event: unknown) => void>()
  ;(globalThis as { __opencodeExecutionTransport?: unknown }).__opencodeExecutionTransport = {
    rpc,
    listen: (handler: (event: unknown) => void) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    status: () => "connected",
  }
  return () => {
    listeners.clear()
    delete (globalThis as { __opencodeExecutionTransport?: unknown }).__opencodeExecutionTransport
  }
}

function LiveExecutionHeader() {
  const [execution, setExecution] = createSignal<ExecutionModel>()
  return (
    <>
      <div data-testid="execution-tab-active">{liveSession.layout.tabs().active()}</div>
      <SessionExecutionProvider
        session={liveSession}
        attention={() => ({ stale: false, needsInput: 0, failed: 0, blocked: 0 })}
        onModel={setExecution}
      >
        <Show when={execution()}>{(model) => <SessionReviewToggle execution={model()} />}</Show>
      </SessionExecutionProvider>
    </>
  )
}

function mountLiveSessionHeader() {
  const restore = installExecutionTransport()
  const host = document.createElement("main")
  host.dataset.testid = "execution-fixture"
  host.style.cssText = "position:fixed;inset:0;background:#181818;color:#eee;padding:24px"
  document.body.appendChild(host)
  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <UiI18nBridge>
          <DialogProvider>
            <QueryClientProvider client={desktopQueryClient}>
              <SettingsProvider>
                <ServersProvider servers={[desktopServer]}>
                  <TabsProvider>
                    <GlobalProvider>
                      <ServerProvider conn={desktopServer}>
                        <LiveExecutionHeader />
                      </ServerProvider>
                    </GlobalProvider>
                  </TabsProvider>
                </ServersProvider>
              </SettingsProvider>
            </QueryClientProvider>
          </DialogProvider>
        </UiI18nBridge>
      </LanguageProvider>
    ),
    host,
  )
  return () => {
    dispose()
    restore()
  }
}

export async function mountExecutionFixture(input: {
  surface?: ExecutionPresentation
  scenario?: string
} = {}): Promise<ReturnType<typeof render>> {
  const scenario = input.scenario ?? "observer"
  if (scenario === "session-execution-live") {
    mountLiveSessionHeader()
    return undefined as unknown as ReturnType<typeof render>
  }
  const host = document.createElement("main")
  host.dataset.testid = "execution-fixture"
  host.dir = scenario === "rtl" ? "rtl" : "ltr"
  host.style.cssText = "position:fixed;inset:0;background:#181818;color:#eee;padding:24px"
  document.body.appendChild(host)

  function Fixture() {
    const taskScenario = scenario.startsWith("tasks") || scenario === "half-verified"
    const executionInitiallyOpen = scenario.startsWith("agents") || taskScenario
    const [run, setRun] = createSignal<RunSnapshot | undefined>(taskRunFixture(scenario))
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
      mode: () => (run() ? "ready" : "observer"),
      scope,
      initialSubview: taskScenario ? "tasks" : undefined,
      snapshot: () => run(),
      agents: () => agentFixture(scenario),
      attention: () => fixtureAttention(scenario),
      progress: () => fixtureProgress(scenario),
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
          <button
            type="button"
            onClick={() => setRun((current) => (current ? { ...current, status: "cancelled" } : current))}
          >
            Show cancelled fixture
          </button>
          <button type="button" onClick={() => setRun(increasedScopeRun())}>
            Show increased scope fixture
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
        <Show when={tasks().length > 0 && scenario !== "desktop-summary" && scenario !== "timeline-desktop"}>
          <BackgroundWorkSummary tasks={tasks()} onViewAgents={openExecution} />
        </Show>
        <Show when={scenario === "desktop-summary"}>
          <QueryClientProvider client={desktopQueryClient}>
            <SettingsProvider>
              <ServersProvider servers={[desktopServer]}>
                <TabsProvider>
                  <GlobalProvider>
                    <ServerProvider conn={desktopServer}>
                      <SessionSummaryPanel
                        shown={false}
                        project={desktopProject}
                        directory="/root/git/demo"
                        local
                        branch="main"
                        diffs={[]}
                        sessionID="root"
                        moveEligible={false}
                        moveDismissed
                        onMoveDismiss={() => undefined}
                        onReview={() => undefined}
                        backgroundTasks={tasks()}
                        onViewAgents={openExecution}
                      />
                    </ServerProvider>
                  </GlobalProvider>
                </TabsProvider>
              </ServersProvider>
            </SettingsProvider>
          </QueryClientProvider>
        </Show>
        <Show when={scenario === "timeline-desktop"}>
          <QueryClientProvider client={desktopQueryClient}>
            <SettingsProvider>
              <ServersProvider servers={[desktopServer]}>
                <WslServersProvider>
                  <SshProvider>
                    <TabsProvider>
                      <GlobalProvider>
                        <ServerProvider conn={desktopServer}>
                          <SettingsSurfaceProvider>
                            <SeedProject />
                            <MessageTimeline
                              active
                              session={timelineSource}
                              background={{ blocking: () => [], tasks: () => tasks(), move: async () => undefined }}
                              scroll={{ overflow: false, jump: false }}
                              onResumeScroll={() => undefined}
                              setScrollRef={() => undefined}
                              onScheduleScrollState={() => undefined}
                              onPin={() => undefined}
                              onUnpin={() => undefined}
                              onUserScroll={() => undefined}
                              onHistoryScroll={() => undefined}
                              onSelectionInteraction={() => undefined}
                              pinned={false}
                              centered={false}
                              reserveReviewToggle={false}
                              setContentRef={() => undefined}
                              diffs={() => []}
                              onReview={() => undefined}
                              onViewAgents={openExecution}
                              workspaceMoveEligible={false}
                              onSummaryOpenChange={() => undefined}
                              anchor={(id) => id}
                            />
                          </SettingsSurfaceProvider>
                        </ServerProvider>
                      </GlobalProvider>
                    </TabsProvider>
                  </SshProvider>
                </WslServersProvider>
              </ServersProvider>
            </SettingsProvider>
          </QueryClientProvider>
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
