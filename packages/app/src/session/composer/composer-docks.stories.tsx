import {
  activePermissionRequest,
  activeQuestionRequest,
  CurrentSessionProviders,
  editThenTestDocument,
} from "@opencode/session-ui/storybook"
import { SessionTimeline } from "@opencode/session-ui/timeline"
import { motionTuning } from "@opencode/ui/motion-tuning"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { FormInfo } from "@opencode/client/promise"
import { Composer } from "@/composer/composer"
import { createPromptController } from "@/session/story-model"
import type { WebSearchRequestModel } from "@/session/requests/websearch"
import type { SessionQueueView } from "./queue"
import { SessionQueuePanel } from "./queue-panel"
import { SessionComposerRegion, type SessionComposerRegionViewController } from "./session-composer-region"
import { SubagentBar } from "./subagent-bar"

type DockArgs = {
  question: boolean
  permission: boolean
  websearch: boolean
  queue: number
  subagent: boolean
}

const prompts = [
  "Rename the Alpha export",
  "Add a Beta regression test",
  "Summarize the Gamma changes",
  "Check the Delta fixture",
]

const websearchRequest: FormInfo = {
  id: "frm_docks_websearch",
  sessionID: activeQuestionRequest.sessionID,
  title: "Web Search",
  metadata: { kind: "websearch.provider" },
  fields: [{ key: "choice", type: "string", required: true, custom: false }],
}

// The real composer region with its docks, queue and subagent bar, driven by the story's args or by its replay
// buttons (the components lab shows them under Knobs → Composer → Docks). Answering, dismissing and Esc close docks the way they do in the app.
function ComposerDocksPreview(props: DockArgs) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })

  const [state, setState] = createStore({
    ...props,
    rows: prompts.slice(0, props.queue).map((_, index) => index),
    revision: 0,
    searchProvider: "exa",
  })

  // Grows or trims the queue to `count`, adding the prompts not queued yet.
  const queueTo = (count: number) =>
    setState("rows", (rows) =>
      [...rows, ...prompts.flatMap((_, index) => (rows.includes(index) ? [] : [index]))].slice(
        0,
        Math.max(0, Math.min(prompts.length, count)),
      ),
    )

  const dequeue = (id: string) => setState("rows", (rows) => rows.filter((index) => `queued_${index}` !== id))

  createEffect(
    on(
      () => [props.question, props.permission, props.websearch, props.queue, props.subagent] as const,
      ([question, permission, websearch, queue, subagent]) => {
        setState({ question, permission, websearch, subagent })
        queueTo(queue)
      },
      { defer: true },
    ),
  )

  const replay = (id: string, label: string, run: () => void) =>
    onCleanup(motionTuning.action({ id: `docks.${id}`, label, group: "Composer", subsection: "Docks", run }))

  replay("question", "Question", () => setState({ question: true, revision: state.revision + 1 }))
  replay("permission", "Permission", () => setState("permission", true))
  replay("websearch", "Web search", () => setState("websearch", true))
  replay("stacked", "Question + permission", () =>
    setState({ question: true, permission: true, revision: state.revision + 1 }),
  )
  replay("answer", "Answer", () => setState({ question: false, permission: false, websearch: false }))
  replay("esc", "Esc", () =>
    document
      .querySelector('[data-component="dock-prompt"][data-kind="question"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
  )
  replay("queue-add", "Queue +1", () => queueTo(state.rows.length + 1))
  replay("queue-remove", "Queue −1", () => queueTo(state.rows.length - 1))
  replay("subagent", "Subagent", () => setState("subagent", (value) => !value))
  replay("queue-reverse", "Reverse queue", () => setState("rows", (rows) => rows.toReversed()))

  const prompt = createPromptController({
    initial: "",
    placeholder: "Ask anything",
    status: () => ({ type: "busy" }),
    onActivity: () => undefined,
    onSubmit: () => queueTo(state.rows.length + 1),
    onStop: () => undefined,
  })

  const blocked = () => state.question || state.permission || state.websearch

  // A permission decision also reports a response submit, so only a submit without a decision answers the question.
  let deciding = false

  const region = {
    state: {
      questionRequest: () =>
        state.question ? { ...activeQuestionRequest, id: `${activeQuestionRequest.id}:${state.revision}` } : undefined,
      websearch: {
        request: () => (state.websearch ? websearchRequest : undefined),
        options: () => [
          { value: "exa", label: "Exa" },
          { value: "parallel", label: "Parallel" },
        ],
        selected: () => state.searchProvider,
        specific: () => false,
        loading: () => false,
        loadFailed: () => false,
        failed: () => false,
        sending: () => false,
        connected: () => true,
        select: (value) => setState("searchProvider", value),
        retry() {},
        submit: async () => void setState("websearch", false),
      } satisfies WebSearchRequestModel,
      elicitationRequest: () => undefined,
    permissionRequest: () => (state.permission ? activePermissionRequest : undefined),
      permissionResponding: () => false,
      decide: () => {
        deciding = true
        setState("permission", false)
      },
      blocked,
    },
    centered: () => true,
    onResponseSubmit: () =>
      queueMicrotask(() => {
        if (!deciding) setState("question", false)
        deciding = false
      }),
    setDockRef() {},
    child: () => state.subagent,
    showComposer: () => !blocked() || state.subagent,
  } satisfies SessionComposerRegionViewController

  const queue: SessionQueueView = {
    rows: () => state.rows.map((index) => ({ id: `queued_${index}`, text: prompts[index]!, attachments: 0 })),
    editing: () => undefined,
    working: () => true,
    busy: () => false,
    steer: async (id) => dequeue(id),
    remove: async (id) => dequeue(id),
    undo: dequeue,
    edit: () => false,
    reorder: async (ids) =>
      void setState(
        "rows",
        ids.map((id) => Number(id.replace("queued_", ""))),
      ),
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div class="flex h-screen min-h-[640px] w-full bg-v2-background-bg-base">
        <CurrentSessionProviders document={editThenTestDocument}>
          <section class="flex min-w-0 flex-1 flex-col">
            <div class="min-h-0 flex-1 overflow-y-auto py-6">
              <SessionTimeline document={editThenTestDocument} class="mx-auto w-full max-w-[840px]" />
            </div>
            <SessionComposerRegion
              controller={region}
              above={<SessionQueuePanel queue={queue} hidden={blocked()} />}
              subagent={
                <SubagentBar
                  agent="surveyor"
                  model={{ provider: "Anthropic", name: "Claude Opus 5.5", variant: "high" }}
                  status="running"
                  started={Date.now() - 65_000}
                  onBack={() => setState("subagent", false)}
                />
              }
              composer={
                <div class="relative z-10">
                  <Composer model={prompt.controller} borderUnderlay />
                </div>
              }
            />
          </section>
        </CurrentSessionProviders>
      </div>
    </QueryClientProvider>
  )
}

export default {
  title: "OpenCode/Session/Composer docks",
  id: "session-composer-docks",
  component: ComposerDocksPreview,
  parameters: {
    layout: "fullscreen",
    // The components lab shows these Knobs and their replay buttons in its inspector.
    motion: ["Docks"],
    docs: {
      description: {
        component:
          "Request docks, the queue and the subagent bar around the composer. Toggle the args, or use the Replay buttons under Knobs → Composer → Docks, to open and close each dock and tune its motion live.",
      },
    },
  },
  argTypes: {
    queue: { control: { type: "range", min: 0, max: 4, step: 1 } },
  },
  args: { question: false, permission: false, websearch: false, queue: 0, subagent: false } satisfies DockArgs,
  render: (args: DockArgs) => <ComposerDocksPreview {...args} />,
}

export const Empty = {}

export const QueueOne = { args: { queue: 1 } }

export const QueueThree = { args: { queue: 3 } }

export const Question = { args: { question: true } }

export const QuestionAndPermission = { args: { question: true, permission: true } }

export const WebSearch = { args: { websearch: true } }

export const Subagent = { args: { subagent: true } }

// Opens a question, then answers it and dismisses the next one: the closes a reviewer should watch.
export const AnsweredAndDismissed = {
  args: { question: true, queue: 2 },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const dock = () => canvasElement.querySelector('[data-component="dock-prompt"][data-kind="question"]')
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    await wait(800)
    dock()?.querySelector<HTMLElement>('[role="radio"]')?.click()
    ;[...(dock()?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.getAttribute("aria-keyshortcuts") === "Escape")
      ?.click()
  },
}
