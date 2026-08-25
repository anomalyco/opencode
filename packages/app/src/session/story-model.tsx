import type { ModelSelection } from "@/providers/models/selection"
import { Composer } from "@/composer/composer"
import type { ComposerModel } from "@/composer/model"
import { SessionHeaderActions } from "@/session/header/session-header-actions"
import {
  SessionComposerRegion,
  type SessionComposerRegionViewController,
} from "@/session/composer/session-composer-region"
import { SessionPanelFrame, SessionRouteFrame } from "@/session/session-frame"
import type { FormInfo, PermissionRequest, SessionStatus } from "@opencode-ai/client/promise"
import type { SessionDocument } from "@opencode-ai/session-ui/document"
import { CurrentSessionProviders, STORY_MODEL } from "@opencode-ai/session-ui/storybook"
import { SessionTimeline } from "@opencode-ai/session-ui/timeline"
import { SessionReviewEmptyChangesV2 } from "@opencode-ai/session-ui/v2/session-review-empty-changes-v2"
import { createComposerEditor } from "@/composer/editor/interaction"
import type { ComposerPersistedState } from "@/composer/types"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { ReviewPanelView } from "@/session/review/panel"
import { createReviewPanelState } from "@/session/review/panel-state"
import { TerminalSurface } from "@/session/terminal/surface"

const modelReady = Object.assign(() => true, { promise: undefined }) satisfies ModelSelection["ready"]
const storyComposerModel = {
  id: STORY_MODEL.id,
  providerID: STORY_MODEL.providerID,
  api: { id: STORY_MODEL.id, url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
  name: "Claude Sonnet 4",
  family: "claude-sonnet",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: true },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: true,
  },
  cost: { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
  limit: { context: 200_000, output: 64_000 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2025-05-22",
  variants: { balanced: {} },
  provider: {
    id: STORY_MODEL.providerID,
    name: "Anthropic",
    source: "custom",
    env: [],
    options: {},
    models: {},
  },
  latest: true,
} satisfies NonNullable<ReturnType<ModelSelection["current"]>>

const modelSelection = {
  ready: modelReady,
  current: () => storyComposerModel,
  recent: () => [storyComposerModel],
  list: () => [storyComposerModel],
  cycle() {},
  set() {},
  visible: () => true,
  setVisibility() {},
  variant: {
    configured: () => STORY_MODEL.variant,
    selected: () => STORY_MODEL.variant,
    current: () => STORY_MODEL.variant,
    list: () => [STORY_MODEL.variant],
    set() {},
    cycle() {},
  },
} satisfies ModelSelection

export type SessionPreviewProps = {
  title: string
  description: string
  document: SessionDocument
  draft?: string
  request?: { type: "permission"; value: PermissionRequest } | { type: "question"; value: FormInfo }
  reviewOpened?: boolean
  child?: { parentID: string }
  terminal?: { title: string; lines: string[] }
}

export function SessionPreview(props: SessionPreviewProps) {
  const [state, setState] = createStore({ revision: 1 })
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <Show when={state.revision} keyed>
        {(revision) => (
          <div data-story-revision={revision}>
            <SessionSurfaceState
              {...props}
              request={
                props.request?.type === "question"
                  ? {
                      type: "question",
                      value: { ...props.request.value, id: `${props.request.value.id}:${revision}` },
                    }
                  : props.request
              }
              onReset={() => setState("revision", (value) => value + 1)}
            />
          </div>
        )}
      </Show>
    </QueryClientProvider>
  )
}

function createPromptController(input: {
  initial: string
  placeholder: string
  status: () => SessionStatus
  onActivity: (activity: string) => void
  onSubmit: (text: string) => void
  onStop: () => void
}) {
  const draft = createStore<ComposerPersistedState>({
    prompt: [{ type: "text", content: input.initial, start: 0, end: input.initial.length }],
    cursor: input.initial.length,
    model: { providerID: STORY_MODEL.providerID, modelID: STORY_MODEL.id, variant: STORY_MODEL.variant },
    context: { items: [] },
  })
  const interaction = createComposerEditor({
    store: draft,
    commands: () => [],
    context: () => [],
    searchContextFiles: () => [],
    view: {
      placeholder: () => input.placeholder,
      add: { onAttach: () => input.onActivity("Opened the local attachment picker") },
      submit: {
        stopping: () => false,
        working: () => input.status().type !== "idle",
        onSubmit: () => {
          const value = interaction.value().trim()
          if (!value) return
          input.onSubmit(value)
          draft[1]("prompt", [{ type: "text", content: "", start: 0, end: 0 }])
          draft[1]("cursor", 0)
        },
        onStop: input.onStop,
      },
      shell: {
        onOpen: () => input.onActivity("Changed the composer to shell mode"),
        onClose: () => input.onActivity("Changed the composer to prompt mode"),
      },
    },
  })
  return {
    controller: {
      ...interaction,
      model: { selection: modelSelection, paid: true, loading: false },
    } satisfies ComposerModel,
    setValue(value: string) {
      draft[1]("prompt", [{ type: "text", content: value, start: 0, end: value.length }])
      draft[1]("cursor", value.length)
    },
  }
}

function SessionSurfaceState(props: SessionPreviewProps & { onReset: () => void }) {
  const language = useLanguage()
  const [state, setState] = createStore<{
    activity: string
    reviewOpened: boolean
    request: SessionPreviewProps["request"]
  }>({
    activity: "Ready",
    reviewOpened: props.reviewOpened ?? false,
    request: props.request,
  })
  const prompt = createPromptController({
    initial: props.draft ?? "",
    placeholder: language.t("prompt.placeholder.normal"),
    status: () => props.document.status,
    onActivity: (activity) => setState("activity", activity),
    onSubmit: (text) => setState("activity", `Submitted locally: ${text}`),
    onStop: () => setState("activity", "Requested a local stop"),
  })
  const region = {
    state: {
      questionRequest: () => (state.request?.type === "question" ? state.request.value : undefined),
      permissionRequest: () => (state.request?.type === "permission" ? state.request.value : undefined),
      permissionResponding: () => false,
      decide: (response) => {
        setState("request", undefined)
        setState("activity", `Permission response: ${response}`)
      },
      blocked: () => state.request !== undefined,
    },
    centered: () => true,
    onResponseSubmit: () => {
      setState("request", undefined)
      setState("activity", "Submitted the answer locally")
    },
    openParent: () => setState("activity", "Opened the parent Session locally"),
    setPromptRef() {},
    setDockRef() {},
    parentID: () => props.child?.parentID,
    child: () => !!props.child,
    showComposer: () => true,
  } satisfies SessionComposerRegionViewController

  return (
    <div class="mx-auto h-screen min-h-[640px] w-full max-w-[1440px]">
      <SessionRouteFrame padded>
        <SessionPanelFrame raised>
          <main class="flex min-h-0 flex-1 flex-col">
            <SessionSurfaceHeader
              title={props.title}
              description={props.description}
              reviewVisible
              reviewOpened={state.reviewOpened}
              onReviewToggle={() => setState("reviewOpened", (value) => !value)}
              onReset={props.onReset}
            />
            <CurrentSessionProviders document={props.document}>
              <div class="flex min-h-0 flex-1">
                <section
                  classList={{
                    "min-w-0 flex-1 flex-col bg-background-base": true,
                    flex: !state.reviewOpened,
                    "hidden md:flex": state.reviewOpened,
                  }}
                >
                  <div class="min-h-0 flex-1 overflow-y-auto py-6">
                    <SessionTimeline
                      document={props.document}
                      editToolDefaultOpen
                      shellToolDefaultOpen
                      class="mx-auto w-full max-w-[840px]"
                    />
                  </div>
                  <SessionComposerRegion
                    controller={region}
                    composer={<Composer model={prompt.controller} borderUnderlay />}
                  />
                </section>
                <Show when={state.reviewOpened}>
                  <aside
                    id="review-panel"
                    class="min-w-0 flex-1 flex flex-col gap-2 border-l border-border-weak-base md:max-w-[52%]"
                  >
                    <div class="min-h-0 flex-1">
                      <SessionReviewPane diffs={props.document.diffs} />
                    </div>
                    <Show when={props.terminal}>{(terminal) => <SessionTerminalPreview terminal={terminal()} />}</Show>
                  </aside>
                </Show>
              </div>
            </CurrentSessionProviders>
            <output class="sr-only" aria-live="polite">
              {state.activity}
            </output>
          </main>
        </SessionPanelFrame>
      </SessionRouteFrame>
    </div>
  )
}

function SessionTerminalPreview(props: { terminal: NonNullable<SessionPreviewProps["terminal"]> }) {
  return (
    <TerminalSurface
      label={props.terminal.title}
      opened
      desktop
      stacked
      height="220px"
      contentHeight="220px"
      pane={220}
      max={360}
      resizing={false}
      onResizeStart={() => undefined}
      onResize={() => undefined}
      onCollapse={() => undefined}
    >
      <div class="h-10 shrink-0 flex items-center border-b border-border-weaker-base px-3 text-13-medium text-text-strong">
        {props.terminal.title}
      </div>
      <pre dir="ltr" class="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-12-regular text-text-base">
        {props.terminal.lines.join("\n")}
      </pre>
    </TerminalSurface>
  )
}

function SessionSurfaceHeader(props: {
  title: string
  description: string
  reviewVisible: boolean
  reviewOpened: boolean
  onReviewToggle: () => void
  onReset: () => void
}) {
  const language = useLanguage()
  return (
    <header class="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border-weak-base px-4 py-2">
      <div class="flex min-w-0 items-center gap-3">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-background-stronger text-icon-base">
          <Icon name="folder" />
        </span>
        <div class="min-w-0">
          <h1 class="truncate text-14-medium text-text-strong">{props.title}</h1>
          <p class="truncate text-12-regular text-text-weak">{props.description}</p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <SessionHeaderActions
          state={{
            reviewLabel: language.t("command.review.toggle"),
            reviewKeybind: [],
            reviewVisible: props.reviewVisible,
            reviewOpened: props.reviewOpened,
            onReviewToggle: props.onReviewToggle,
          }}
        />
        <Button size="small" variant="neutral" onClick={props.onReset}>
          Reset
        </Button>
      </div>
    </header>
  )
}

function SessionReviewPane(props: { diffs: SessionDocument["diffs"] }) {
  const language = useLanguage()
  const review = createReviewPanelState()
  const [state, setState] = createStore({
    active: props.diffs[0]?.file,
    diffStyle: "unified" as "unified" | "split",
  })
  return (
    <ReviewPanelView
      title={language.t("ui.sessionReview.title.lastTurn")}
      empty={<SessionReviewEmptyChangesV2 />}
      diffs={props.diffs}
      diffsReady
      activeFile={state.active}
      onSelectFile={(file) => setState("active", file)}
      diffStyle={state.diffStyle}
      onDiffStyleChange={(value) => setState("diffStyle", value)}
      state={review}
      fileList="flat"
    />
  )
}
