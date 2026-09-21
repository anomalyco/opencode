import { DialogProvider } from "@opencode/ui/context/dialog"
import { DataProvider } from "@opencode/session-ui/context"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Match, Show, Suspense, Switch, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider, UiI18nBridge, useLanguage } from "../src/runtime/i18n/language"
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
import { createMediaQuery } from "@solid-primitives/media"
import { createSessionTimelineInteraction } from "../src/session/timeline/interaction"
import { SessionMobileViewTabs, type SessionMobileView } from "../src/session/review/view"
import { sessionBrowserPaneVisible } from "../src/session/files/session-side-panel"
import { ExecutionPanel } from "../src/superpowers/panel"
import { ExpandedExecution, createExecutionExpansion } from "../src/superpowers/expanded"
import { PlatformProvider } from "../src/runtime/platform/platform"
import { createWebPlatform } from "../src/runtime/platform/web"
import { MessageTimeline } from "../src/session/timeline/message-timeline"
import type { TimelineSessionSource } from "../src/session/timeline/controller"
import { createExecutionModel, type ExecutionAttention, type ExecutionModel, type ExecutionProgress } from "../src/superpowers/model"
import { ExecutionActivityFeed } from "../src/superpowers/activity-feed"
import { ExecutionAgentList } from "../src/superpowers/agent-list"
import { SessionExecutionProvider } from "../src/superpowers/session-execution"
import { ExecutionTaskDetails } from "../src/superpowers/task-details"
import { ExecutionTaskList } from "../src/superpowers/task-list"
import { SessionReviewToggle } from "../src/session/header/session-header-actions"
import { ExecutionStatusBadge } from "../src/superpowers/status-badge"
import { createHomeExecutionSummaries, requestExecutionOverview } from "../src/superpowers/home-summary"
import type { ExecutionEventSource } from "../src/superpowers/bridge-client"
import { HomeSessionsView } from "../src/home/sessions/view"
import { buildHomeSessionRecords } from "../src/home/sessions/records"
import type { HomeSessionGroup } from "../src/home/sessions/controller"
import type { LocalProject } from "../src/shell/state/layout"
import {
  agentFixture,
  failedTaskFixture,
  halfVerifiedRun,
  increasedScopeRun,
  runFixture,
  taskRunFixture,
  trackedRun,
} from "../src/superpowers/fixtures"
import { requestEvidenceReveal, revealPendingEvidence } from "../src/superpowers/evidence-reveal"
import type { ExecutionScope } from "../src/superpowers/identity"
import type { ExecutionPresentation } from "../src/superpowers/panel"
import type { SessionModel } from "../src/session/model"
import type { Project } from "../src/runtime/server/types"
import type { SessionInfo } from "@opencode/client/promise"
import type { OpenCodeEvent, RpcCallOptions, RpcClient } from "@opencode/client/promise"
import type { RunSnapshot, RunSummary } from "@bearmanser/opencode-superpowers-execution/contract"
import { ExecutionRpc } from "@bearmanser/opencode-superpowers-execution/contract"

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

const [liveTabs, setLiveTabs] = createStore({ active: "review", all: ["review"] })

const liveSession = {
  identity: { sessionID: () => "root", sessionKey: () => "wsl::root", params: { id: "root" } },
  shared: {
    data: {
      session: {
        get: (id: string) =>
          id === "root" ? { parentID: undefined, location: { directory: "/root/git/demo" } } : undefined,
        message: {
          get: (sessionID: string, messageID: string) =>
            sessionID === "child" && messageID === "msg-api-1"
              ? { type: "assistant", content: [{ type: "tool", id: "part-api-1" }] }
              : undefined,
        },
      },
    },
  },
  workspace: { directory: () => "/root/git/demo" },
  isDesktop: () => true,
  layout: {
    tabs: () => ({
      active: () => liveTabs.active,
      all: () => liveTabs.all,
      open: async (tab: string) => {
        setLiveTabs("active", tab)
        if (!liveTabs.all.includes(tab)) setLiveTabs("all", (all) => [...all, tab])
      },
    }),
  },
} as unknown as SessionModel

const evidenceTimelineSession = {
  identity: { sessionID: () => undefined, sessionKey: () => "wsl::child", params: { id: "child" } },
  history: { messages: () => [], visibleUserMessages: () => [], lastUserMessage: () => undefined },
  ownership: {
    key: () => "wsl::child",
    capture: () => ({ key: "wsl::child", current: () => true, run: (run: () => void) => run() }),
  },
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

function installExecutionTransport(snapshot = runFixture({ runID: "run-1", revision: 3, tasks: [failedTaskFixture()] })) {
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
  const nativeSession = (sessionID: string) => {
    if (sessionID === "root") {
      return {
        id: "root",
        title: "Root controller",
        location: { directory: "/root/git/demo" },
        model: { id: "gpt-5-codex", providerID: "openai" },
        cost: 1.5,
        tokens: { input: 1000, output: 250, reasoning: 0, cache: { read: 500, write: 0 } },
      }
    }
    if (sessionID === "child") {
      return {
        id: "child",
        parentID: "root",
        title: "Child implementer",
        location: { directory: "/root/git/demo/.worktrees/feature" },
        cost: 0.5,
        tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
      }
    }
    return { id: sessionID, parentID: "root", title: "Idle reviewer", location: { directory: "/root/git/demo" } }
  }
  ;(globalThis as { __opencodeExecutionTransport?: unknown }).__opencodeExecutionTransport = {
    rpc,
    listen: (handler: (event: unknown) => void) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    status: () => "connected",
    session: {
      get: async ({ sessionID }: { sessionID: string }) => nativeSession(sessionID),
      list: async ({ parentID }: { parentID?: string }) =>
        parentID === "root"
          ? { data: [nativeSession("child"), nativeSession("idle-child")], cursor: {} }
          : { data: [], cursor: {} },
      active: async () => ({ root: { type: "running" } }),
      form: { list: async () => [] },
    },
    permission: { list: async () => [] },
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
        <Show when={execution()}>
          {(model) => (
            <>
              <div data-testid="execution-subview">{model().subview()}</div>
              <SessionReviewToggle execution={model()} />
            </>
          )}
        </Show>
      </SessionExecutionProvider>
    </>
  )
}

function LiveEvidenceComposition() {
  const [execution, setExecution] = createSignal<ExecutionModel>()
  const [state, setState] = createStore({ target: "", reveals: 0 })
  const timeline = createSessionTimelineInteraction(evidenceTimelineSession)
  timeline.view.setRevealMessage((messageID, partID) => {
    setState("target", `${messageID}#${partID ?? ""}`)
    setState("reveals", (count) => count + 1)
  })
  return (
    <>
      <SessionExecutionProvider
        session={liveSession}
        attention={() => ({ stale: false, needsInput: 0, failed: 0, blocked: 0 })}
        onModel={setExecution}
      >
        <Show when={execution()}>
          {(model) => (
            <>
              <ExecutionTaskList model={model()} />
              <ExecutionTaskDetails model={model()} />
            </>
          )}
        </Show>
      </SessionExecutionProvider>
      <div data-testid="production-timeline-ready">{String(timeline.ready())}</div>
      <div data-testid="production-revealed-target">{state.target}</div>
      <div data-testid="production-reveal-count">{state.reveals}</div>
    </>
  )
}

function LiveAgentsComposition() {
  const [execution, setExecution] = createSignal<ExecutionModel>()
  return (
    <SessionExecutionProvider
      session={liveSession}
      attention={() => ({ stale: false, needsInput: 0, failed: 0, blocked: 0 })}
      onModel={setExecution}
    >
      <Show when={execution()}>
        {(model) => (
          <>
            <ExecutionAgentList model={model()} />
            <ExecutionActivityFeed model={model()} />
          </>
        )}
      </Show>
    </SessionExecutionProvider>
  )
}

function mountLiveSessionHeader(mode: string) {
  const restore = installExecutionTransport(mode === "evidence-production" ? halfVerifiedRun() : undefined)
  if (mode === "session-execution-handoff") requestExecutionOverview("root")
  const host = document.createElement("main")
  host.dataset.testid = "execution-fixture"
  host.style.cssText = "position:fixed;inset:0;background:#181818;color:#eee;padding:24px"
  document.body.appendChild(host)
  const dispose = render(
    () => (
      <PlatformProvider value={createWebPlatform("test").platform}>
        <LanguageProvider locale="en">
          <UiI18nBridge>
            <DialogProvider>
              <QueryClientProvider client={desktopQueryClient}>
                <SettingsProvider>
                  <ServersProvider servers={[desktopServer]}>
                    <TabsProvider>
                      <GlobalProvider>
                        <ServerProvider conn={desktopServer}>
                          <Switch>
                            <Match when={mode === "evidence-production"}>
                              <LiveEvidenceComposition />
                            </Match>
                            <Match when={mode === "session-execution-agents"}>
                              <LiveAgentsComposition />
                            </Match>
                            <Match when={true}>
                              <LiveExecutionHeader />
                            </Match>
                          </Switch>
                        </ServerProvider>
                      </GlobalProvider>
                    </TabsProvider>
                  </ServersProvider>
                </SettingsProvider>
              </QueryClientProvider>
            </DialogProvider>
          </UiI18nBridge>
        </LanguageProvider>
      </PlatformProvider>
    ),
    host,
  )
  return () => {
    dispose()
    restore()
  }
}

let trackedModelSequence = 0

function TrackedFixture(props: { host: HTMLElement; lateRun: boolean }) {
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const [root, setRoot] = createSignal<"root" | "other-root">("root")
  const [runAvailable, setRunAvailable] = createSignal(!props.lateRun)
  const [state, setState] = createStore({
    activeTab: "file://a.ts" as string | undefined,
    panelWidth: 600,
    mobileTab: "session" as SessionMobileView,
    pendingQuestion: false,
    replies: 0,
  })
  const scope = (): ExecutionScope => ({ serverKey: "wsl", ownerDirectory: "/root/git/demo", rootSessionID: root() })
  const run = () => (root() === "root" && runAvailable() ? trackedRun() : undefined)
  let requestRegion: HTMLDivElement | undefined
  trackedModelSequence += 1
  const modelInstance = trackedModelSequence
  const model = createExecutionModel({
    mode: () => (run() ? "ready" : "observer"),
    scope,
    narrow: () => !isDesktop(),
    snapshot: run,
    agents: () => agentFixture("agents"),
    attention: () => ({ stale: false, needsInput: state.pendingQuestion ? 1 : 0, failed: 0, blocked: 0 }),
    reviewRequest: () => requestRegion?.focus(),
  })
  const expansion = createExecutionExpansion({
    model: () => model,
    key: () => scope().rootSessionID,
    activeTab: () => state.activeTab,
    selectTab: (tab) => setState("activeTab", tab),
    panelWidth: () => state.panelWidth,
    resizePanel: (width) => setState("panelWidth", width),
  })
  const nativeHidden = () =>
    !sessionBrowserPaneVisible({
      reviewOpen: true,
      activeTab: "browser:tab-fixture",
      executionExpanded: model.expanded(),
    })

  return (
    <>
      <div
        data-testid="execution-fixture-controls"
        style={{
          position: "relative",
          "z-index": 50,
          display: "flex",
          "flex-wrap": "wrap",
          gap: "4px",
          width: "fit-content",
          "max-width": "60%",
        }}
      >
        <button type="button" onClick={() => model.selectTask("api")}>
          Select API task
        </button>
        <button type="button" onClick={() => setState("pendingQuestion", (pending) => !pending)}>
          Show pending question
        </button>
        <button type="button" onClick={() => setState("activeTab", "file://b.ts")}>
          Switch tab while expanded
        </button>
        <button type="button" onClick={() => setState("panelWidth", 900)}>
          Resize panel while expanded
        </button>
        <button type="button" onClick={() => setRoot((current) => (current === "root" ? "other-root" : "root"))}>
          Switch root
        </button>
        <button type="button" onClick={() => setRunAvailable(true)}>
          Register run
        </button>
        <button
          type="button"
          onClick={() => {
            const temporary = document.createElement("button")
            temporary.dataset.testid = "temporary-focus"
            temporary.textContent = "temporary focus target"
            props.host.appendChild(temporary)
            temporary.focus()
            expansion.expand()
            temporary.remove()
          }}
        >
          Expand from a disposed target
        </button>
      </div>
      <div data-testid="selected-task">{model.selectedTaskID() ?? ""}</div>
      <div data-testid="execution-scope-root">{model.scope()?.rootSessionID ?? ""}</div>
      <div data-testid="execution-model-count">{modelInstance}</div>
      <div data-testid="active-tab">{state.activeTab ?? ""}</div>
      <div data-testid="panel-width">{state.panelWidth}</div>
      <div data-testid="native-pane-hidden">{String(nativeHidden())}</div>
      <div data-testid="native-pane-overlay" hidden={nativeHidden()}>
        native browser surface
      </div>
      <div data-testid="retained-terminal">terminal</div>
      <div data-testid="inner-menu" role="menu" tabIndex={0}>
        inner menu
      </div>
      <div data-testid="question-reply-count">{state.replies}</div>
      <Show when={state.pendingQuestion}>
        <div
          data-testid="native-request-region"
          tabIndex={-1}
          ref={(element) => (requestRegion = element)}
          onClick={() => setState("replies", (count) => count + 1)}
        >
          <span>Question requested</span>
        </div>
      </Show>
      <Show
        when={isDesktop()}
        fallback={
          <div data-testid="execution-mobile-composition">
            <SessionMobileViewTabs
              current={state.mobileTab}
              executionAvailable={true}
              onSelect={(view) => setState("mobileTab", view)}
            />
            <Show when={state.mobileTab === "execution"}>
              <ExecutionPanel model={model} presentation="mobile" />
            </Show>
          </div>
        }
      >
        <div data-testid="execution-desktop-composition">
          <Show when={!model.expanded()} fallback={<ExpandedExecution model={model} onClose={expansion.collapse} />}>
            <ExecutionPanel model={model} presentation="panel" onExpand={expansion.expand} />
          </Show>
        </div>
      </Show>
    </>
  )
}

function mountTrackedFixture(input: { rtl: boolean; lateRun: boolean }) {
  const host = document.createElement("main")
  host.dataset.testid = "execution-fixture"
  host.dir = input.rtl ? "rtl" : "ltr"
  host.style.cssText = "position:fixed;inset:0;overflow:auto;background:#181818;color:#eee;padding:12px"
  document.body.appendChild(host)
  render(
    () => (
      <LanguageProvider locale="en">
        <UiI18nBridge>
          <DialogProvider>
            <TrackedFixture host={host} lateRun={input.lateRun} />
          </DialogProvider>
        </UiI18nBridge>
      </LanguageProvider>
    ),
    host,
  )
}

const homeFixtureProject: LocalProject = { id: "demo", worktree: "/root/git/demo", expanded: false }

function homeFixtureSession(id: string, title: string): SessionInfo {
  return {
    id,
    projectID: "demo",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    title,
    location: { directory: "/root/git/demo" },
  } as unknown as SessionInfo
}

function homeFixtureSummary(input: { status: RunSummary["status"]; verified: number; total: number }): RunSummary {
  return {
    runID: "run-home",
    rootSessionID: "root-tracked",
    ownerDirectory: "/root/git/demo",
    title: "Home fixture run",
    status: input.status,
    revision: 2,
    updatedAt: 1_700_000_000_000,
    planRevision: 1,
    progress: {
      verified: input.verified,
      total: input.total,
      skipped: 0,
      failed: 0,
      blocked: 0,
      awaitingReview: 0,
      percent: null,
      source: "controller_report",
    },
  }
}

function HomeExecutionFixture(props: { scenario: string }) {
  const language = useLanguage()
  const [state, setState] = createStore({
    navigationTarget: "",
    fullRunFetches: 0,
    verified: 1,
    connection: true,
  })
  const sessions = [homeFixtureSession("root-tracked", "Tracked controller"), homeFixtureSession("root-ordinary", "Ordinary session")]
  const records = buildHomeSessionRecords({
    sessions: () => sessions,
    projectDirectories: () => undefined,
    projects: () => [homeFixtureProject],
  })
  const groups: HomeSessionGroup[] = [{ id: "today", title: "Today", sessions: records }]
  const roots = records.map((record) => ({
    serverKey: "wsl",
    ownerDirectory: record.session.location.directory,
    rootSessionID: record.session.id,
  }))
  const listeners = new Set<(event: OpenCodeEvent) => void>()
  const api = {
    getSummaries: async (input: { rootSessionIDs: string[] }) => {
      if (props.scenario === "home-missing-plugin") throw { type: "rpc.method_not_found", message: "Unknown RPC method" }
      if (!input.rootSessionIDs.includes("root-tracked")) return { items: [] }
      return {
        items: [
          homeFixtureSummary({
            status: props.scenario === "home-cancelled" ? "cancelled" : "active",
            verified: state.verified,
            total: 2,
          }),
        ],
      }
    },
    getRun: async () => {
      setState("fullRunFetches", (count) => count + 1)
      throw new Error("Home summaries must not load a full run")
    },
    listRuns: async () => ({ items: [] }),
    capabilities: async () => ({ schemaVersion: 1, pluginVersion: "0.1.0", maxTasks: 500, reporting: "controller" }),
    events: { subscribe: () => ({}) as never, on: () => () => undefined },
  } as unknown as RpcClient<typeof ExecutionRpc, RpcCallOptions>
  const events: ExecutionEventSource = {
    listen: (handler) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  const summaries = createHomeExecutionSummaries({
    serverKey: () => "wsl",
    roots: () => roots,
    api: () => api,
    events: () => events,
    connection: () => state.connection,
  })
  let homeRoot: HTMLDivElement | undefined
  onMount(() => annotateHomeRows())
  function annotateHomeRows() {
    homeRoot?.querySelector('[data-session-id="root-tracked"]')?.setAttribute("data-testid", "home-root-tracked")
    homeRoot?.querySelector('[data-session-id="root-ordinary"]')?.setAttribute("data-testid", "home-root-ordinary")
  }
  const emitChanged = () => {
    const event = {
      id: "event-home",
      created: 1,
      type: "rpc.superpowers.execution.v1.changed",
      location: { directory: "/root/git/demo" },
      data: { rootSessionID: "root-tracked", runID: "run-home", revision: 3 },
    } as unknown as OpenCodeEvent
    for (const handler of [...listeners]) handler(event)
  }
  return (
    <>
      <div data-testid="navigation-target">{state.navigationTarget}</div>
      <div data-testid="full-run-fetch-count">{state.fullRunFetches}</div>
      <button
        type="button"
        data-testid="advance-summary"
        onClick={() => {
          setState("verified", (value) => value + 1)
          emitChanged()
        }}
      >
        Advance summary
      </button>
      <button type="button" data-testid="lose-connection" onClick={() => setState("connection", false)}>
        Lose connection
      </button>
      <div ref={homeRoot}>
        <HomeSessionsView
          language={language}
          groups={groups}
          loading={false}
          showProjectName={false}
          server={ServerConnection.Key.make("wsl")}
          canCreateSession={false}
          searchValue=""
          searchPlaceholder="Search sessions"
          searchOpen={false}
          searchLoading={false}
          searchResults={[]}
          searchActive=""
          searchNoResultsLabel="No results"
          titleOpacity={() => 1}
          isOpenTab={() => false}
          onCreateSession={() => undefined}
          onOpenSession={() => undefined}
          onArchiveSession={async () => undefined}
          onRenameSession={async () => true}
          onExportSession={async () => undefined}
          onDeleteSession={() => undefined}
          onSetHoverTarget={() => undefined}
          onSetThumbTrack={() => undefined}
          onSetContent={() => undefined}
          onSetHeader={() => undefined}
          onWheel={() => undefined}
          onSetSearchRoot={() => undefined}
          onSetSearchInput={() => undefined}
          onSetSearchList={() => undefined}
          onSearchFocus={() => undefined}
          onSearchInput={() => undefined}
          onSearchClose={() => undefined}
          onSearchMove={() => undefined}
          onSearchSelectActive={() => undefined}
          onSearchHighlight={() => undefined}
          onSearchSelect={() => undefined}
          executionSummary={(record) => summaries.summary(record.session.id)}
          executionSummaryStale={summaries.stale()}
          onOpenExecution={(record) => setState("navigationTarget", `wsl/${record.session.id}/execution`)}
        />
      </div>
    </>
  )
}

function mountHomeFixture(scenario: string) {
  const host = document.createElement("main")
  host.dataset.testid = "execution-fixture"
  host.style.cssText = "position:fixed;inset:0;overflow:auto;background:#181818;color:#eee;padding:12px"
  document.body.appendChild(host)
  render(
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
                        <HomeExecutionFixture scenario={scenario} />
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
}

export async function mountExecutionFixture(input: {
  surface?: ExecutionPresentation
  scenario?: string
} = {}): Promise<ReturnType<typeof render>> {
  const scenario = input.scenario ?? "observer"
  if (scenario.startsWith("home-")) {
    mountHomeFixture(scenario)
    return undefined as unknown as ReturnType<typeof render>
  }
  if (scenario === "tracked" || scenario === "tracked-rtl" || scenario === "tracked-late") {
    mountTrackedFixture({ rtl: scenario === "tracked-rtl", lateRun: scenario === "tracked-late" })
    return undefined as unknown as ReturnType<typeof render>
  }
  if (
    scenario === "session-execution-live" ||
    scenario === "evidence-production" ||
    scenario === "session-execution-agents" ||
    scenario === "session-execution-handoff"
  ) {
    mountLiveSessionHeader(scenario)
    return undefined as unknown as ReturnType<typeof render>
  }
  const host = document.createElement("main")
  host.dataset.testid = "execution-fixture"
  host.dir = scenario === "rtl" ? "rtl" : "ltr"
  host.style.cssText = "position:fixed;inset:0;background:#181818;color:#eee;padding:24px"
  document.body.appendChild(host)

  function Fixture() {
    const taskScenario = scenario.startsWith("tasks") || scenario === "half-verified"
    const graphScenario = scenario === "map" || scenario === "map-large"
    const activityScenario = scenario === "activity" || scenario === "activity-empty"
    const executionInitiallyOpen = scenario.startsWith("agents") || taskScenario || graphScenario || activityScenario
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
      evidenceTarget: "",
      revealedTarget: "",
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
    const resolvableEvidence = new Set([
      "msg-api-1",
      "msg-api-2",
      "msg-v-1",
      "msg-v-2",
      "msg-f-1",
      "msg-f-2",
      "msg-gate-1",
      "msg-gate-2",
    ])
    const model = createExecutionModel({
      mode: () => (run() ? "ready" : "observer"),
      scope,
      initialSubview: taskScenario ? "tasks" : activityScenario ? "activity" : undefined,
      snapshot: () => run(),
      agents: () => agentFixture(scenario),
      attention: () => fixtureAttention(scenario),
      progress: () => fixtureProgress(scenario),
      resolveEvidence: async ({ messageID }) => resolvableEvidence.has(messageID),
      navigateEvidence: (reference) => {
        requestEvidenceReveal(reference)
        setState("evidenceTarget", `${reference.sessionID}#${reference.messageID}#${reference.partID ?? ""}`)
      },
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
          <button
            type="button"
            onClick={() =>
              setRun((current) =>
                current
                  ? {
                      ...current,
                      revision: current.revision + 1,
                      updatedAt: current.updatedAt + 1,
                      tasks: current.tasks.map((task, index) =>
                        index === 0
                          ? { ...task, state: task.state === "verified" ? ("running" as const) : ("verified" as const) }
                          : task,
                      ),
                    }
                  : current,
              )
            }
          >
            Advance task status
          </button>
          <button
            type="button"
            onClick={() => {
              revealPendingEvidence({
                sessionID: "child",
                ready: true,
                reveal: (messageID, partID) => setState("revealedTarget", `${messageID}#${partID ?? ""}`),
              })
            }}
          >
            Activate evidence destination
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
        <div data-testid="evidence-target">{state.evidenceTarget}</div>
        <div data-testid="revealed-target">{state.revealedTarget}</div>
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
