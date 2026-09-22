import { DialogProvider } from "@opencode/ui/context/dialog"
import { DataProvider } from "@opencode/session-ui/context"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { MemoryRouter, Route, createMemoryHistory, useParams } from "@solidjs/router"
import { Match, Show, Suspense, Switch, createEffect, createMemo, createSignal, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider, UiI18nBridge } from "../src/runtime/i18n/language"
import { ComposerEditor } from "../src/composer/editor/editor"
import { createComposerEditor } from "../src/composer/editor/interaction"
import type { ComposerPersistedState } from "../src/composer/types"
import { focusComposerEditor } from "../src/session/composer/dock-focus"
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
import { SessionExecutionOwner, SessionExecutionProvider } from "../src/superpowers/session-execution"
import { ExecutionTaskDetails } from "../src/superpowers/task-details"
import { ExecutionTaskList } from "../src/superpowers/task-list"
import { SessionReviewToggle } from "../src/session/header/session-header-actions"
import { ExecutionStatusBadge } from "../src/superpowers/status-badge"
import { HomeSessions } from "../src/home/sessions/region"
import { createHomeSessionsController } from "../src/home/sessions/controller"
import { createHomeSessionSearchController } from "../src/home/sessions/search"
import { createHomeScrollController } from "../src/home/scroll"
import type { HomeController } from "../src/home/model"
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
import { SessionScreen } from "../src/session/screen"
import { useSessionModel } from "../src/session/model"
import { BrowserAttachmentsProvider } from "../src/session/browser/attachments"
import { ComposerPersistenceProvider } from "../src/composer/persistence"
import { TerminalProvider } from "../src/session/terminal/context"

type PendingRequest = { type: "permission" | "question"; owner: string }

function pendingRequest(scenario: string): PendingRequest | undefined {
  if (scenario === "permission-pending" || scenario === "permission-compact" || scenario === "nested-permission") {
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

type LiveExecutionState = {
  connected: boolean
  resolutionAvailable: boolean
  running: boolean
  runningSessionID: string
  needsInput: boolean
  requestSessionID: string
  requestsLoaded: boolean
  descendantIDs: string[]
  sharedDescendantIDs: string[]
  visible: boolean
  ownerMounted: boolean
  messageFetches: number
  nativeReplies: number
}

function liveNativeSession(sessionID: string) {
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
  if (sessionID === "idle-child") {
    return { id: sessionID, parentID: "root", title: "Idle reviewer", location: { directory: "/root/git/demo" } }
  }
  return { id: sessionID, parentID: "root", title: sessionID, location: { directory: "/root/git/demo" } }
}

function livePermission(sessionID = "root") {
  return {
    id: "permission-1",
    sessionID,
    action: "shell",
    resources: ["bun test"],
    save: ["bun test"],
    source: { type: "tool" as const, messageID: "message-1", id: "tool-1" },
  }
}

function createLiveSession(state: LiveExecutionState) {
  return {
    identity: { sessionID: () => "root", sessionKey: () => "wsl::root", params: { id: "root" } },
    shared: {
      data: {
        session: {
          list: () => [liveNativeSession("root"), ...state.sharedDescendantIDs.map(liveNativeSession)],
          get: (id: string) =>
            id === "root" || state.sharedDescendantIDs.includes(id) ? liveNativeSession(id) : undefined,
          status: (id: string) => (id === state.runningSessionID && state.running ? "running" : "idle"),
          permission: {
            list: (id: string) =>
              state.requestsLoaded
                ? id === state.requestSessionID && state.needsInput
                  ? [{ id: "permission-1" }]
                  : []
                : undefined,
          },
          form: { list: () => (state.requestsLoaded ? [] : undefined) },
          message: {
            list: () => [],
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
    layout: { tabs: () => ({ active: () => "review", all: () => ["review"] }) },
  } as unknown as SessionModel
}

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

function installExecutionTransport(
  state: LiveExecutionState,
  incrementMessageFetches: () => void,
  incrementNativeReplies: () => void,
  snapshot = runFixture({ runID: "run-1", revision: 3, tasks: [failedTaskFixture()] }),
) {
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
  const pendingMessages: Array<(value: { data: never[] }) => void> = []
  ;(globalThis as { __opencodeExecutionTransport?: unknown }).__opencodeExecutionTransport = {
    rpc,
    pendingPermission: () => (state.needsInput ? [livePermission(state.requestSessionID)] : []),
    listen: (handler: (event: unknown) => void) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    status: () => (state.connected ? "connected" : "disconnected"),
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        if (!state.connected || !state.resolutionAvailable) throw new Error("native session unavailable")
        return liveNativeSession(sessionID)
      },
      list: async ({ parentID }: { parentID?: string }) =>
        parentID === "root"
          ? { data: state.descendantIDs.map(liveNativeSession), cursor: {} }
          : { data: [], cursor: {} },
      active: async () => (state.running ? { [state.runningSessionID]: { type: "running" } } : {}),
      form: { list: async () => [] },
    },
    permission: {
      list: async ({ sessionID }: { sessionID: string }) =>
        sessionID === state.requestSessionID && state.needsInput
          ? [livePermission(state.requestSessionID)]
          : [],
      reply: async () => {
        incrementNativeReplies()
        return { data: true }
      },
    },
    message: {
      list: async (_input: unknown, options?: { signal?: AbortSignal }) => {
        incrementMessageFetches()
        return new Promise<{ data: never[] }>((resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
          pendingMessages.push(resolve)
        })
      },
    },
  }
  return {
    releaseMessages() {
      pendingMessages.splice(0).forEach((resolve) => resolve({ data: [] }))
    },
    dispose() {
      listeners.clear()
      delete (globalThis as { __opencodeExecutionTransport?: unknown }).__opencodeExecutionTransport
    },
  }
}

function LiveExecutionHeader(props: { session: SessionModel }) {
  const [execution, setExecution] = createSignal<ExecutionModel>()
  return (
    <>
      <div data-testid="execution-tab-active">{props.session.layout.tabs().active()}</div>
      <SessionExecutionProvider
        session={props.session}
        attention={() => ({ stale: false, needsInput: 0, failed: 0, blocked: 0 })}
        onModel={setExecution}
      >
        <Show when={execution()}>{(model) => <SessionReviewToggle execution={model()} />}</Show>
      </SessionExecutionProvider>
    </>
  )
}

function LiveEvidenceComposition(props: { session: SessionModel }) {
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
        session={props.session}
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

function LiveAgentsComposition(props: {
  session: SessionModel
  state: LiveExecutionState
  setRunning: () => void
  showRequest: () => void
  loadEmptyRequests: () => void
  addDescendant: () => void
  reconnect: () => void
  recover: () => void
  hide: () => void
  dispose: () => void
  releaseMessages: () => void
}) {
  const [execution, setExecution] = createSignal<ExecutionModel>()
  return (
    <>
      <button type="button" onClick={props.setRunning}>Set agents idle</button>
      <button type="button" onClick={props.showRequest}>Show agent request</button>
      <button type="button" onClick={props.loadEmptyRequests}>Load empty agent requests</button>
      <button type="button" onClick={props.addDescendant}>Add descendant</button>
      <button type="button" onClick={() => execution()?.setExpanded(true)}>Expand execution state</button>
      <button type="button" onClick={props.reconnect}>Reconnect native transport</button>
      <button type="button" onClick={props.recover}>Recover native transport</button>
      <button type="button" onClick={() => execution()?.retryAgent("root")}>Retry native agents</button>
      <button type="button" onClick={props.hide}>Hide execution agents</button>
      <button type="button" onClick={props.dispose}>Dispose execution owner</button>
      <button type="button" onClick={props.releaseMessages}>Release transcript requests</button>
      <div data-testid="live-execution-expanded">{String(execution()?.expanded() ?? false)}</div>
      <div data-testid="live-execution-root">{execution()?.scope()?.rootSessionID ?? ""}</div>
      <div data-testid="live-message-fetches">{props.state.messageFetches}</div>
      <Show when={props.state.ownerMounted}>
        <SessionExecutionProvider
          session={props.session}
          attention={() => ({ stale: false, needsInput: 0, failed: 0, blocked: 0 })}
          visible={() => props.state.visible}
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
      </Show>
    </>
  )
}

function ProductionMobileSession(props: { state: LiveExecutionState; mode: string }) {
  const server = useServer()
  server.ctx.data.session.remember({
    id: "root",
    projectID: "demo",
    title: "Root controller",
    location: { directory: "/root/git/demo" },
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as SessionInfo)
  const session = useSessionModel()
  return (
    <>
      <div data-testid="production-native-replies">{props.state.nativeReplies}</div>
      <Show when={props.mode === "session-screen-header-terminal"}>
        <button type="button" onClick={() => session.layout.view().terminal.open()}>
          Open fixture terminal
        </button>
      </Show>
      <Show when={props.mode === "session-screen-header-compact"}>
        <button
          type="button"
          onClick={(event) => {
            const host = event.currentTarget.closest('[data-testid="execution-fixture"]') as HTMLElement
            host.style.width = host.style.width === "520px" ? "1100px" : "520px"
          }}
        >
          Resize fixture panel
        </button>
      </Show>
      <DataProvider
        data={{ session: [], session_status: {}, session_diff: {} }}
        directory="/root/git/demo"
        onSessionHref={(id) => `#${id}`}
      >
        <SessionScreen session={session} />
      </DataProvider>
    </>
  )
}

function mountLiveSessionHeader(mode: string) {
  const activity = mode === "session-execution-activity"
  const productionMobile = mode === "session-screen-mobile-pending"
  const productionScreen = productionMobile || mode.startsWith("session-screen-header")
  const uncachedDescendant = mode === "session-execution-uncached-descendant"
  const unloadedRequest = mode === "session-execution-unloaded-request"
  const [state, setState] = createStore<LiveExecutionState>({
    connected: mode !== "session-execution-offline",
    resolutionAvailable: mode !== "session-execution-resolution-retry",
    running: true,
    runningSessionID: uncachedDescendant ? "child" : "root",
    needsInput: productionMobile || unloadedRequest,
    requestSessionID: unloadedRequest ? "child" : "root",
    requestsLoaded: !unloadedRequest,
    descendantIDs: activity
      ? ["child", "idle-child", "activity-1", "activity-2", "activity-3", "activity-4"]
      : ["child", "idle-child"],
    sharedDescendantIDs: uncachedDescendant ? [] : ["child", "idle-child"],
    visible: true,
    ownerMounted: true,
    messageFetches: 0,
    nativeReplies: 0,
  })
  const session = createLiveSession(state)
  const history = createMemoryHistory()
  history.set({ value: sessionHref(ServerConnection.key(desktopServer), "root"), replace: true, scroll: false })
  const transport = installExecutionTransport(
    state,
    () => setState("messageFetches", (value) => value + 1),
    () => setState("nativeReplies", (value) => value + 1),
    mode === "evidence-production" ? halfVerifiedRun() : undefined,
  )
  const host = document.createElement("main")
  host.dataset.testid = "execution-fixture"
  host.dir = mode.endsWith("-rtl") ? "rtl" : "ltr"
  host.style.cssText = `position:fixed;inset:0;background:#181818;color:#eee;padding:24px;${mode.endsWith("-compact") ? "width:520px;right:auto" : ""}`
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
                    <WslServersProvider>
                      <SshProvider>
                        <TabsProvider>
                          <GlobalProvider>
                             <ServerProvider conn={desktopServer}>
                               <Switch>
                                 <Match when={productionScreen}>
                                   <MemoryRouter history={history}>
                                     <Route
                                       path="/server/:serverKey/session/:id"
                                       component={() => (
                                         <SettingsSurfaceProvider>
                                           <SeedProject />
                                          <BrowserAttachmentsProvider>
                                            <TerminalProvider>
                                              <ComposerPersistenceProvider>
                                                <ProductionMobileSession state={state} mode={mode} />
                                              </ComposerPersistenceProvider>
                                            </TerminalProvider>
                                           </BrowserAttachmentsProvider>
                                         </SettingsSurfaceProvider>
                                       )}
                                     />
                                   </MemoryRouter>
                                 </Match>
                                 <Match when={mode === "evidence-production"}>
                                   <LiveEvidenceComposition session={session} />
                                 </Match>
                                 <Match when={mode.startsWith("session-execution-") && mode !== "session-execution-live"}>
                                   <LiveAgentsComposition
                                     session={session}
                                     state={state}
                                     setRunning={() => setState("running", false)}
                                     showRequest={() => setState("needsInput", true)}
                                     loadEmptyRequests={() => {
                                       setState("needsInput", false)
                                       setState("requestsLoaded", true)
                                     }}
                                     addDescendant={() => {
                                       setState("descendantIDs", (ids) => [...ids, "new-descendant"])
                                       setState("sharedDescendantIDs", (ids) => [...ids, "new-descendant"])
                                     }}
                                     reconnect={() => setState("connected", true)}
                                     recover={() => setState("resolutionAvailable", true)}
                                     hide={() => setState("visible", false)}
                                     dispose={() => setState("ownerMounted", false)}
                                     releaseMessages={transport.releaseMessages}
                                   />
                                 </Match>
                                 <Match when={true}>
                                   <LiveExecutionHeader session={session} />
                                 </Match>
                               </Switch>
                            </ServerProvider>
                          </GlobalProvider>
                        </TabsProvider>
                      </SshProvider>
                    </WslServersProvider>
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
    transport.dispose()
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
  const [composerDraft, setComposerDraft] = createStore<ComposerPersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
    model: { providerID: "openai", modelID: "gpt-5-codex" },
    context: { items: [] },
  })
  const composerEditor = createComposerEditor({
    store: [composerDraft, setComposerDraft],
    commands: () => [],
    context: () => [],
    searchContextFiles: () => [],
    view: {
      submit: {
        stopping: () => false,
        onSubmit: () => undefined,
        onStop: () => undefined,
      },
    },
  })
  const selectMobileView = (view: SessionMobileView) => {
    setState("mobileTab", view)
    if (view === "session" && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => focusComposerEditor(() => undefined))
    }
  }
  trackedModelSequence += 1
  const modelInstance = trackedModelSequence
  const model = createExecutionModel({
    mode: () => (run() ? "ready" : "observer"),
    scope,
    narrow: () => !isDesktop(),
    snapshot: run,
    agents: () => agentFixture("agents"),
    attention: () => ({ stale: false, needsInput: state.pendingQuestion ? 1 : 0, failed: 0, blocked: 0 }),
    reviewRequest: () => {
      selectMobileView("session")
      if (typeof requestAnimationFrame !== "function") {
        requestRegion?.focus()
        return
      }
      requestAnimationFrame(() => requestRegion?.focus())
    },
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
        <button type="button" onClick={() => selectMobileView("session")}>
          Return to conversation
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
              onSelect={(view) => selectMobileView(view)}
            />
            <Show
              when={state.mobileTab === "execution"}
              fallback={
                <div data-testid="native-composer" data-component="session-composer-dock" class="w-full">
                  <ComposerEditor controller={composerEditor} />
                </div>
              }
            >
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
const homeFixtureSessions = [
  homeFixtureSession("root-tracked", "Tracked controller"),
  homeFixtureSession("root-ordinary", "Ordinary session"),
]

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

function homeFakeContext(input: {
  scenario: string
  connected: () => boolean
  verified: () => number
  failSummaries: () => boolean
  onFullRun: () => void
}) {
  const listeners = new Set<(event: OpenCodeEvent) => void>()
  const rpc = {
    getSummaries: async (request: { rootSessionIDs: string[] }) => {
      if (input.scenario === "home-missing-plugin" || input.failSummaries())
        throw { type: "rpc.method_not_found", message: "Unknown RPC method" }
      if (!request.rootSessionIDs.includes("root-tracked")) return { items: [] }
      return {
        items: [
          homeFixtureSummary({
            status: input.scenario === "home-cancelled" ? "cancelled" : "active",
            verified: input.verified(),
            total: 2,
          }),
        ],
      }
    },
    getRun: async () => {
      input.onFullRun()
      throw new Error("Home summaries must not load a full run")
    },
    listRuns: async () => ({ items: [] }),
    capabilities: async () => ({ schemaVersion: 1, pluginVersion: "0.1.0", maxTasks: 500, reporting: "controller" }),
    events: { subscribe: () => ({}) as never, on: () => () => undefined },
  } as unknown as RpcClient<typeof ExecutionRpc, RpcCallOptions>
  const ctx = {
    sdk: {
      api: {
        session: {
          list: async () => ({ data: [], cursor: {} }),
          get: async ({ sessionID }: { sessionID: string }) =>
            homeFixtureSessions.find((session) => session.id === sessionID),
          update: async () => ({}),
        },
        rpc: () => rpc,
      },
      event: {
        listen: (handler: (event: OpenCodeEvent) => void) => {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
        on: () => () => undefined,
      },
      connection: { status: () => (input.connected() ? "connected" : "disconnected") },
    },
    data: {
      session: {
        list: () => homeFixtureSessions,
        get: (id: string) => homeFixtureSessions.find((session) => session.id === id),
        apply: (value: SessionInfo[]) => value,
        remember: () => undefined,
        invalidate: () => undefined,
        sync: async () => undefined,
        message: { sync: async () => undefined },
      },
    },
    projects: { list: () => [homeFixtureProject], open: () => undefined, touch: () => undefined },
  }
  const emit = () => {
    const event = {
      id: "event-home",
      created: 1,
      type: "rpc.superpowers.execution.v1.changed",
      location: { directory: "/root/git/demo" },
      data: { rootSessionID: "root-tracked", runID: "run-home", revision: 3 },
    } as unknown as OpenCodeEvent
    for (const handler of [...listeners]) handler(event)
  }
  return { ctx, emit }
}

function homeFakeController(ctx: unknown): HomeController {
  return {
    selection: {
      value: () => ({ server: ServerConnection.key(desktopServer), directory: homeFixtureProject.worktree }),
      set: () => undefined,
      focusServer: () => undefined,
    },
    project: {
      list: () => [homeFixtureProject],
      recentlyClosed: () => [],
      homedir: () => "",
      selected: () => homeFixtureProject,
      newSession: () => homeFixtureProject,
      forServer: () => [homeFixtureProject],
      select: () => undefined,
      add: () => undefined,
      openNewSession: () => undefined,
      openProjectNewSession: () => undefined,
      openProjectSession: () => undefined,
    },
    server: {
      list: () => [desktopServer],
      health: () => undefined,
      context: () => ctx,
      focused: () => desktopServer,
      focusedContext: () => ctx,
      focusedSync: () => undefined,
    },
  } as unknown as HomeController
}

function HomeDirectRoute(props: { scenario: string }) {
  const [state, setState] = createStore({ fullRunFetches: 0, verified: 1, connection: true, failSummaries: false })
  const fake = homeFakeContext({
    scenario: props.scenario,
    connected: () => state.connection,
    verified: () => state.verified,
    failSummaries: () => state.failSummaries,
    onFullRun: () => setState("fullRunFetches", (count) => count + 1),
  })
  const home = homeFakeController(fake.ctx)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)
  let content: HTMLDivElement | undefined
  createEffect(() => {
    sessions.data.loading()
    sessions.data.groups()
    queueMicrotask(() => {
      content?.querySelector('[data-session-id="root-tracked"]')?.setAttribute("data-testid", "home-root-tracked")
      content?.querySelector('[data-session-id="root-ordinary"]')?.setAttribute("data-testid", "home-root-ordinary")
    })
  })
  return (
    <>
      <div data-testid="full-run-fetch-count">{state.fullRunFetches}</div>
      <button
        type="button"
        data-testid="advance-summary"
        onClick={() => {
          setState("verified", (value) => value + 1)
          fake.emit()
        }}
      >
        Advance summary
      </button>
      <button type="button" data-testid="lose-connection" onClick={() => setState("connection", false)}>
        Lose connection
      </button>
      <button
        type="button"
        data-testid="fail-summary"
        onClick={() => {
          setState("failSummaries", true)
          fake.emit()
        }}
      >
        Fail summary
      </button>
      <div ref={content}>
        <HomeSessions sessions={sessions} search={search} scroll={scroll} />
      </div>
    </>
  )
}

function destinationSession(input: {
  id: () => string
  narrow: () => boolean
  activeTab: () => string
  openTab: (tab: string) => void
}): SessionModel {
  return {
    identity: {
      sessionID: input.id,
      sessionKey: () => `${ServerConnection.key(desktopServer)}::${input.id()}`,
      params: { id: input.id() },
    },
    shared: {
      data: {
        session: {
          list: () => [],
          get: () => undefined,
          status: () => "idle",
          message: { list: () => [], get: () => undefined },
        },
      },
    },
    workspace: { directory: () => homeFixtureProject.worktree },
    isDesktop: () => !input.narrow(),
    layout: {
      view: () => ({ reviewPanel: { opened: () => false, open: () => undefined } }),
      tabs: () => ({
        active: input.activeTab,
        all: () => [input.activeTab()],
        open: async (tab: string) => input.openTab(tab),
      }),
    },
  } as unknown as SessionModel
}

function DestinationRoute(props: { scenario: string }) {
  const params = useParams<{ id: string }>()
  const narrow = () => props.scenario === "home-narrow"
  const [state, setState] = createStore({ activeTab: "review", mobileTab: "session" })
  const [execution, setExecution] = createSignal<ExecutionModel>()
  const session = destinationSession({
    id: () => params.id,
    narrow,
    activeTab: () => state.activeTab,
    openTab: (tab) => setState("activeTab", tab),
  })
  return (
    <>
      <div data-testid="destination-session">{params.id}</div>
      <div data-testid="destination-mobile-tab">{state.mobileTab}</div>
      <SessionExecutionOwner
        session={session}
        attention={() => ({ stale: false, needsInput: 0, failed: 0, blocked: 0 })}
        mobile={{ setTab: (tab) => setState("mobileTab", tab) }}
        onModel={setExecution}
      >
        <Show when={execution()}>
          {(model) => (
            <>
              <div data-testid="destination-subview">{model().subview()}</div>
              <Show when={state.activeTab === SESSION_EXECUTION_TAB}>
                <ExecutionPanel model={model()} presentation={narrow() ? "mobile" : "panel"} />
              </Show>
            </>
          )}
        </Show>
      </SessionExecutionOwner>
    </>
  )
}

function HomeFixtureRoot(props: ParentProps) {
  return (
    <LanguageProvider locale="en">
      <UiI18nBridge>
        <DialogProvider>
          <QueryClientProvider client={desktopQueryClient}>
            <SettingsProvider>
              <ServersProvider servers={[desktopServer]}>
                <TabsProvider>
                  <GlobalProvider>
                    <ServerProvider conn={desktopServer}>{props.children}</ServerProvider>
                  </GlobalProvider>
                </TabsProvider>
              </ServersProvider>
            </SettingsProvider>
          </QueryClientProvider>
        </DialogProvider>
      </UiI18nBridge>
    </LanguageProvider>
  )
}

function mountHomeFixture(scenario: string) {
  const host = document.createElement("main")
  host.dataset.testid = "execution-fixture"
  host.style.cssText = "position:fixed;inset:0;overflow:auto;background:#181818;color:#eee;padding:12px"
  document.body.appendChild(host)
  render(
    () => (
      <MemoryRouter root={HomeFixtureRoot}>
        <Route path="/" component={() => <HomeDirectRoute scenario={scenario} />} />
        <Route path="/server/:serverKey/session/:id" component={() => <DestinationRoute scenario={scenario} />} />
      </MemoryRouter>
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
    scenario.startsWith("session-screen-header") ||
    scenario === "session-screen-mobile-pending" ||
    scenario.startsWith("session-execution-")
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
          <ExecutionStatusBadge model={model} onOpen={openExecution} compact={scenario === "permission-compact"} />
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
