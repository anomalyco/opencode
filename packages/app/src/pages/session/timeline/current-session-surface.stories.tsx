import type { ModelSelection } from "@/context/local"
import { PromptInputV2Composer, type PromptInputV2ComposerController } from "@/components/prompt-input-v2"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionRevertDock } from "@/pages/session/composer/session-revert-dock"
import { SessionHeaderV2Actions } from "@/components/session/session-header"
import type { PermissionRequest, SessionMessageInfo } from "@opencode-ai/client/promise"
import type { SessionDocument } from "@opencode-ai/session-ui/document"
import { DataProvider } from "@opencode-ai/session-ui/context"
import { File } from "@opencode-ai/session-ui/file"
import { SessionTimeline } from "@opencode-ai/session-ui/timeline"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { createPromptInputV2Controller } from "@opencode-ai/session-ui/v2/prompt-input/interaction"
import type { PromptInputV2PersistedState } from "@opencode-ai/session-ui/v2/prompt-input/types"
import { Button } from "@opencode-ai/ui/button"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Show, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

const SESSION_ID = "session_app_surface_story"
const TIME = 1_735_689_600_000
const model = { id: "claude-sonnet-4", providerID: "anthropic", variant: "balanced" }

const appSurfaceMessages: SessionMessageInfo[] = [
  {
    id: "msg_app_user",
    type: "user",
    text: "Update the command label, run the test, and show the execution result.",
    metadata: { agent: "build", model },
    time: { created: TIME + 1_000 },
  },
  {
    id: "msg_app_assistant",
    type: "assistant",
    agent: "build",
    model,
    time: { created: TIME + 2_000, completed: TIME + 9_000 },
    content: [
      {
        type: "tool",
        id: "tool_app_edit",
        name: "edit",
        state: {
          status: "completed",
          input: {
            path: "src/commands.ts",
            oldString: 'label: "Run"',
            newString: 'label: "Run checks"',
          },
          content: [{ type: "text", text: "Updated src/commands.ts" }],
          metadata: {
            files: [
              {
                file: "src/commands.ts",
                before: 'export const command = { label: "Run" }\n',
                after: 'export const command = { label: "Run checks" }\n',
                additions: 1,
                deletions: 1,
              },
            ],
          },
        },
        time: { created: TIME + 3_000, ran: TIME + 3_100, completed: TIME + 4_000 },
      },
      {
        type: "tool",
        id: "tool_app_shell",
        name: "bash",
        state: {
          status: "completed",
          input: { command: "bun test src/commands.test.ts" },
          content: [{ type: "text", text: "2 pass\n0 fail\nCompleted in 184ms" }],
          metadata: { exit: 0 },
        },
        time: { created: TIME + 5_000, ran: TIME + 5_100, completed: TIME + 7_000 },
      },
      {
        type: "text",
        text: "## Execution result\n\nThe label is now **Run checks** and both command tests pass.",
      },
    ],
  },
] satisfies SessionMessageInfo[]

const appSurfaceDocument = {
  sessionID: SESSION_ID,
  status: { type: "idle" },
  diffs: [],
  messages: appSurfaceMessages,
} satisfies SessionDocument

const pendingAndQueuedMessages: SessionMessageInfo[] = [
  {
    id: "msg_pending_done_user",
    type: "user",
    text: "Inspect the current timeline.",
    time: { created: TIME + 20_000 },
  },
  {
    id: "msg_pending_done_assistant",
    type: "assistant",
    agent: "build",
    model,
    content: [{ type: "text", text: "The current timeline uses stable projected rows." }],
    time: { created: TIME + 21_000, completed: TIME + 23_000 },
  },
  {
    id: "msg_pending_active_user",
    type: "user",
    text: "Add deterministic Storybook coverage.",
    time: { created: TIME + 24_000 },
  },
] satisfies SessionMessageInfo[]

const pendingAndQueuedDocument = {
  sessionID: SESSION_ID,
  status: { type: "busy" },
  diffs: [],
  messages: pendingAndQueuedMessages,
} satisfies SessionDocument

const requestHistoryMessages: SessionMessageInfo[] = [
  {
    id: "msg_request_user",
    type: "user",
    text: "Ask before publishing the canary release.",
    time: { created: TIME + 30_000 },
  },
  {
    id: "msg_request_assistant",
    type: "assistant",
    agent: "build",
    model,
    time: { created: TIME + 31_000, completed: TIME + 35_000 },
    content: [
      {
        type: "tool",
        id: "tool_request_question",
        name: "question",
        state: {
          status: "completed",
          input: {
            questions: [
              {
                question: "Which release target should I use?",
                header: "Target",
                options: [{ label: "Canary" }, { label: "Stable" }],
              },
            ],
          },
          content: [{ type: "text", text: "Canary" }],
          metadata: { answers: [["Canary"]] },
        },
        time: { created: TIME + 32_000, ran: TIME + 32_100, completed: TIME + 33_000 },
      },
      {
        type: "tool",
        id: "tool_request_permission",
        name: "bash",
        state: {
          status: "error",
          input: { command: "npm publish --tag canary" },
          error: { type: "ToolExecutionError", message: "Permission was denied for canary publishing" },
        },
        time: { created: TIME + 34_000, ran: TIME + 34_100, completed: TIME + 34_500 },
      },
    ],
  },
] satisfies SessionMessageInfo[]

const requestHistoryDocument = {
  sessionID: SESSION_ID,
  status: { type: "idle" },
  diffs: [],
  messages: requestHistoryMessages,
} satisfies SessionDocument

const queuedPrompts = [
  { id: "inbox_app_queue_1", text: "Cover the compact terminal width." },
  { id: "inbox_app_queue_2", text: "Then verify the full Storybook build." },
] satisfies { id: string; text: string }[]

const activePermissionRequest = {
  id: "permission_publish_canary",
  sessionID: SESSION_ID,
  action: "bash",
  resources: ["npm publish --tag canary"],
  save: ["npm publish *"],
  source: { type: "tool", messageID: "msg_request_assistant", id: "tool_request_permission" },
} satisfies PermissionRequest

const activeQuestion = {
  header: "Release target",
  question: "Which release target should the next execution use?",
  options: ["Canary", "Stable"],
}

function CurrentSessionProviders(props: { document: SessionDocument; children: JSX.Element }) {
  return (
    <DataProvider
      directory="C:/workspaces/opencode"
      sessionID={props.document.sessionID}
      data={{
        agent: [{ name: "build", color: "blue" }],
        provider: {
          all: new Map([["anthropic", { models: { "claude-sonnet-4": { name: "Claude Sonnet 4" } } }]]),
          connected: ["anthropic"],
          default: { anthropic: "claude-sonnet-4" },
        },
        session: [
          {
            id: SESSION_ID,
            title: "Current Session App surface",
            time: { created: TIME, updated: TIME + 60_000 },
          },
        ],
        session_status: { [SESSION_ID]: props.document.status },
        session_diff: { [SESSION_ID]: props.document.diffs },
      }}
    >
      <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
    </DataProvider>
  )
}

const modelReady = Object.assign(() => true, { promise: undefined }) satisfies ModelSelection["ready"]

const modelSelection = {
  ready: modelReady,
  current: () => undefined,
  recent: () => [],
  list: () => [],
  cycle() {},
  set() {},
  visible: () => true,
  setVisibility() {},
  variant: {
    configured: () => undefined,
    selected: () => undefined,
    current: () => undefined,
    list: () => [],
    set() {},
    cycle() {},
  },
} satisfies ModelSelection

function StoryHeader(props: { title: string; description: string; onReset: () => void }) {
  const [reviewOpened, setReviewOpened] = createSignal(false)
  return (
    <header class="flex min-h-14 items-center justify-between gap-4 border-b border-border-weak-base px-4 py-3">
      <div class="flex min-w-0 items-center gap-3">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-background-stronger text-icon-base">
          <Icon name="message" />
        </span>
        <div class="min-w-0">
          <h1 class="truncate text-14-medium text-text-strong">{props.title}</h1>
          <p class="truncate text-12-regular text-text-weak">{props.description}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <SessionHeaderV2Actions
          state={{
            statusVisible: false,
            statusLabel: "Session status",
            reviewLabel: "Toggle review",
            reviewKeybind: [],
            reviewVisible: true,
            reviewOpened: reviewOpened(),
            onReviewToggle: () => setReviewOpened((value) => !value),
          }}
        />
        <Button size="small" variant="neutral" onClick={props.onReset}>
          Reset
        </Button>
      </div>
    </header>
  )
}

function SurfaceState(props: { onReset: () => void }) {
  const [activity, setActivity] = createSignal("Ready")
  const [revert, setRevert] = createStore({
    items: [
      { id: "revert_surface_1", text: "Replace the command label with an icon only" },
      { id: "revert_surface_2", text: "Remove the focused command test" },
    ],
  })
  const initialDraft = {
    prompt: [{ type: "text", content: "Add a keyboard test for the new command label", start: 0, end: 49 }],
    cursor: 49,
    model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "balanced" },
    context: { items: [] },
  } satisfies PromptInputV2PersistedState
  const draft = createStore<PromptInputV2PersistedState>(initialDraft)
  const interaction = createPromptInputV2Controller({
    store: draft,
    commands: () => [],
    context: () => [],
    searchContextFiles: () => [],
    view: {
      placeholder: () => "Ask a follow-up about this execution",
      add: { onAttach: () => setActivity("Attachment picker requested locally") },
      submit: {
        stopping: () => false,
        working: () => false,
        onSubmit: () => {
          setActivity(`Submitted locally: ${interaction.value()}`)
          draft[1]("prompt", [{ type: "text", content: "", start: 0, end: 0 }])
          draft[1]("cursor", 0)
        },
        onStop: () => setActivity("Stop requested locally"),
      },
      shell: {
        onOpen: () => setActivity("Composer changed to shell mode"),
        onClose: () => setActivity("Composer changed to prompt mode"),
      },
    },
  })
  const controller = {
    ...interaction,
    model: { selection: modelSelection, paid: true, loading: false },
  } satisfies PromptInputV2ComposerController

  return (
    <main class="mx-auto flex h-[900px] w-full max-w-[1000px] flex-col overflow-hidden rounded-xl border border-border-weak-base bg-background-base shadow-sm">
      <StoryHeader
        title="Command label verification"
        description="Local App Session composition with fixed current messages"
        onReset={props.onReset}
      />
      <div class="min-h-0 flex-1 overflow-y-auto py-5">
        <CurrentSessionProviders document={appSurfaceDocument}>
          <SessionTimeline
            document={appSurfaceDocument}
            editToolDefaultOpen
            shellToolDefaultOpen
            class="mx-auto w-full max-w-[840px]"
          />
        </CurrentSessionProviders>
      </div>
      <div class="mx-auto w-full max-w-[840px] px-3 pb-3">
        <Show when={revert.items.length > 0}>
          <SessionRevertDock
            items={revert.items}
            onRestore={(id) => {
              setRevert("items", (items) => items.filter((item) => item.id !== id))
              setActivity(`Restored ${id} locally`)
            }}
          />
        </Show>
        <div class="relative z-[70] -mt-[18px]">
          <PromptInputV2Composer controller={controller} borderUnderlay />
        </div>
        <output class="mt-2 block text-12-regular text-text-weak">{activity()}</output>
      </div>
    </main>
  )
}

function CurrentSessionSurface() {
  const [revision, setRevision] = createSignal(1)
  return (
    <Show when={revision()} keyed>
      {(revision) => (
        <div data-story-revision={revision}>
          <SurfaceState onReset={() => setRevision((value) => value + 1)} />
        </div>
      )}
    </Show>
  )
}

function PendingQueueState(props: { onReset: () => void }) {
  const [state, setState] = createStore({ items: queuedPrompts.map((item) => ({ ...item })) })
  const [activity, setActivity] = createSignal("Two prompts are queued")
  const remove = (id: string, action: string) => {
    setState("items", (items) => items.filter((item) => item.id !== id))
    setActivity(`${action}: ${id}`)
  }

  return (
    <main class="mx-auto flex h-[760px] w-full max-w-[860px] flex-col overflow-hidden rounded-xl border border-border-weak-base bg-background-base">
      <StoryHeader
        title="Pending and queued prompts"
        description="The active prompt is in the timeline; queued prompts stay in the App dock"
        onReset={props.onReset}
      />
      <div class="min-h-0 flex-1 overflow-y-auto py-5">
        <CurrentSessionProviders document={pendingAndQueuedDocument}>
          <SessionTimeline document={pendingAndQueuedDocument} />
        </CurrentSessionProviders>
      </div>
      <div class="mx-auto w-full max-w-[760px] px-3 pb-3">
        <Show when={state.items.length > 0}>
          <SessionFollowupDock
            items={state.items}
            onSend={(id) => remove(id, "Sent now")}
            onEdit={(id) => remove(id, "Moved to editor")}
          />
        </Show>
        <output class="mt-2 block text-12-regular text-text-weak">{activity()}</output>
      </div>
    </main>
  )
}

function PendingQueueSurface() {
  const [revision, setRevision] = createSignal(1)
  return (
    <Show when={revision()} keyed>
      {(revision) => (
        <div data-story-revision={revision}>
          <PendingQueueState onReset={() => setRevision((value) => value + 1)} />
        </div>
      )}
    </Show>
  )
}

function RequestState(props: { onReset: () => void }) {
  const [activity, setActivity] = createSignal("Requests are waiting for a local response")
  const [answer, setAnswer] = createSignal<string>()

  return (
    <main class="mx-auto flex w-full max-w-[900px] flex-col overflow-hidden rounded-xl border border-border-weak-base bg-background-base">
      <StoryHeader
        title="Permission and question requests"
        description="Current request docks above the related production timeline history"
        onReset={props.onReset}
      />
      <div class="grid gap-4 p-4 md:grid-cols-2">
        <section class="min-w-0">
          <h2 class="mb-2 text-12-medium text-text-strong">Production permission dock</h2>
          <SessionPermissionDock
            request={activePermissionRequest}
            responding={false}
            onDecide={(decision) => setActivity(`Permission response kept local: ${decision}`)}
          />
        </section>
        <section class="min-w-0">
          <h2 class="mb-2 text-12-medium text-text-strong">Production question prompt shell</h2>
          <DockPrompt
            kind="question"
            header={<div class="text-13-medium text-text-strong">{activeQuestion.header}</div>}
            footer={
              <>
                <Button size="normal" variant="ghost" onClick={() => setActivity("Question dismissed locally")}>
                  Dismiss
                </Button>
                <Button
                  size="normal"
                  variant="contrast"
                  disabled={!answer()}
                  onClick={() => setActivity(`Question response kept local: ${answer()}`)}
                >
                  Submit
                </Button>
              </>
            }
          >
            <div class="text-13-regular text-text-base">{activeQuestion.question}</div>
            <div class="mt-3 flex flex-col gap-2">
              <For each={activeQuestion.options}>
                {(option) => (
                  <Button
                    size="normal"
                    variant={answer() === option ? "contrast" : "neutral"}
                    onClick={() => setAnswer(option)}
                  >
                    {option}
                  </Button>
                )}
              </For>
            </div>
          </DockPrompt>
        </section>
      </div>
      <output class="px-4 pb-2 text-12-regular text-text-weak">{activity()}</output>
      <div class="max-h-[420px] overflow-y-auto border-t border-border-weak-base py-5">
        <CurrentSessionProviders document={requestHistoryDocument}>
          <SessionTimeline document={requestHistoryDocument} shellToolDefaultOpen />
        </CurrentSessionProviders>
      </div>
    </main>
  )
}

function RequestSurface() {
  const [revision, setRevision] = createSignal(1)
  return (
    <Show when={revision()} keyed>
      {(revision) => (
        <div data-story-revision={revision}>
          <RequestState onReset={() => setRevision((value) => value + 1)} />
        </div>
      )}
    </Show>
  )
}

export default {
  title: "App/Current Session Surface",
  id: "app-current-session-surface",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A network-free App composition using the real current `SessionTimeline`, production Session header actions, App `PromptInputV2Composer`, revert, follow-up, and permission docks. The full App `MessageTimeline` starts workspace VCS sync and `SessionHeader` portals into the global titlebar, so the story mounts its production action surface inside local title chrome. `SessionQuestionDock` submits through the server SDK, so the request story stops at its real `DockPrompt` production boundary.",
      },
    },
  },
}

export const SessionSurface = {
  render: () => <CurrentSessionSurface />,
}

export const PendingAndQueued = {
  render: () => <PendingQueueSurface />,
}

export const PermissionAndQuestionRequests = {
  render: () => <RequestSurface />,
}
