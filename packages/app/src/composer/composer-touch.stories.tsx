import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { ModelSelection } from "@/providers/models/selection"
import { STORY_MODEL } from "@opencode/session-ui/storybook"
import { Composer } from "./composer"
import type { ComposerModel } from "./model"
import { createComposerEditor, createComposerEditorState } from "./editor/interaction"
import type { ComposerPersistedState, ComposerSuggestion } from "./types"
import { promptLength } from "./prompt-parts"

// Every state of the real composer on a phone. On a touch device the composer shows its touch bar and Return only
// adds a line; anywhere else the same page shows the desktop toolbar, which is the point.

const states = [
  { id: "new-empty", name: "New session, empty" },
  { id: "new-draft", name: "New session, draft" },
  { id: "idle-draft", name: "Idle session, draft" },
  { id: "working", name: "Working, empty (Stop)" },
  { id: "steer", name: "Working + draft, steer first" },
  { id: "queue", name: "Working + draft, queue first" },
  { id: "editing", name: "Editing a queued prompt" },
  { id: "shell", name: "Shell command" },
  { id: "sending", name: "Sending" },
  { id: "suggestions", name: "Slash suggestions open" },
] as const

type State = (typeof states)[number]["id"]

const drafts: Record<State, string> = {
  "new-empty": "",
  "new-draft": "Add a touch bar to the composer",
  "idle-draft": "Now run the focused tests",
  working: "",
  steer: "Also post the PR link in the thread",
  queue: "After that, update the changelog",
  editing: "Rename the flag before merging",
  shell: "bun test composer",
  sending: "Ship it",
  suggestions: "",
}

const selectedModel = {
  id: STORY_MODEL.id,
  providerID: STORY_MODEL.providerID,
  api: { id: STORY_MODEL.id, url: "https://opencode.ai", npm: "@ai-sdk/anthropic" },
  name: "Claude Opus 5.5",
  family: "claude-opus",
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
  release_date: "2026-05-22",
  variants: { medium: {}, high: {} },
  provider: { id: STORY_MODEL.providerID, name: "OpenCode", source: "custom", env: [], options: {}, models: {} },
  latest: true,
} satisfies NonNullable<ReturnType<ModelSelection["current"]>>

const commands: ComposerSuggestion[] = [
  { id: "command.review", kind: "command", label: "/review", trigger: "review", title: "Review changes" },
  { id: "command.test", kind: "command", label: "/test", trigger: "test", title: "Run tests" },
  { id: "command.compact", kind: "command", label: "/compact", trigger: "compact", title: "Compact the session" },
]

const context: ComposerSuggestion[] = [
  {
    id: "file:src/composer/editor/editor.tsx",
    kind: "file",
    label: "src/composer/editor/editor.tsx",
    path: "src/composer/editor/editor.tsx",
    mention: {
      type: "file",
      path: "src/composer/editor/editor.tsx",
      content: "@src/composer/editor/editor.tsx",
      start: 0,
      end: 0,
    },
  },
]

const text = (content: string): ComposerPersistedState["prompt"] => [
  { type: "text", content, start: 0, end: content.length },
]

function TouchComposer(props: { state: State }) {
  const working = ["working", "steer", "queue", "editing"].includes(props.state)
  const [session, setSession] = createStore({
    working,
    fresh: props.state.startsWith("new"),
    log: [] as string[],
    variant: "high",
  })
  const prompt = text(drafts[props.state])
  const [draft, setDraft] = createStore<ComposerPersistedState>({
    prompt,
    cursor: promptLength(prompt),
    model: { providerID: STORY_MODEL.providerID, modelID: STORY_MODEL.id, variant: "high" },
    context: { items: [] },
  })
  const blank = () => !draft.prompt.some((part) => "content" in part && part.content.trim())
  const record = (entry: string) => setSession("log", (log) => [...log, entry])

  const queue = {
    count: () => (props.state === "editing" ? 1 : 0),
    undoing: () => false,
    delivery: () => (props.state === "queue" ? ("queue" as const) : ("steer" as const)),
    alternate: () => (props.state === "queue" ? ("steer" as const) : ("queue" as const)),
    editing: () => (props.state === "editing" ? "inb_story_editing" : undefined),
    confirmEdit: (delivery: "steer" | "queue") => record(`Edited queued prompt, ${delivery}`),
    cancelEdit: () => record("Cancelled the edit"),
    editFirst: () => false,
  }

  const editor = createComposerEditor({
    store: [draft, setDraft],
    state: createComposerEditorState(props.state === "shell" ? "shell" : "normal"),
    commands: () => commands,
    context: () => context,
    searchContextFiles: () => context,
    view: {
      placeholder: () =>
        session.working
          ? "Add follow-up, / for commands, @ for context…"
          : "Ask anything, / for commands, @ for context…",
      variant: {
        options: () => [
          { id: "default", label: "default" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
        ],
        current: () => session.variant,
        onSelect: (variant) => setSession("variant", variant),
      },
      submit: {
        stopping: () => session.working && blank(),
        working: () => session.working,
        busy: () => props.state === "sending",
        get queue() {
          return session.working ? queue : undefined
        },
        onSubmit: (options) => {
          const value = draft.prompt.map((part) => ("content" in part ? part.content : "")).join("")
          const delivery = session.working ? (options?.alternate ? queue.alternate() : queue.delivery()) : "send"

          record(`${delivery}: ${value}`)
          setDraft({ prompt: text(""), cursor: 0 })
          setSession({ fresh: false, working: true })
        },
        onStop: () => {
          record("Stop: interrupted the session")
          setSession("working", false)
        },
      },
    },
  })

  const selection = {
    ready: Object.assign(() => true, { promise: undefined }),
    key: () => ({ providerID: selectedModel.provider.id, modelID: selectedModel.id }),
    current: () => selectedModel,
    recent: () => [selectedModel],
    favorite: { list: () => [], toggle() {} },
    list: () => [selectedModel],
    cycle() {},
    set() {},
    visible: () => true,
    setVisibility() {},
    variant: {
      configured: () => "high",
      selected: () => session.variant,
      current: () => session.variant,
      list: () => ["medium", "high"],
      set: (variant: string | undefined) => setSession("variant", variant ?? "high"),
      cycle() {},
    },
  } satisfies ModelSelection

  const model = { ...editor, model: { selection, paid: true, loading: false } } satisfies ComposerModel

  onMount(() => props.state === "suggestions" && editor.openCommands())

  return (
    <>
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3" data-scrollable>
        <Show
          when={!session.fresh}
          fallback={<p class="m-auto text-14-regular text-v2-text-text-faint">New session · opencode / dev</p>}
        >
          <p class="text-14-regular text-v2-text-text-base">
            Recorded the session-layer split as deferred, so it won't come up again as an open question.
          </p>
          <div class="self-end max-w-[80%] rounded-2xl bg-v2-background-bg-layer-02 px-3.5 py-2.5 text-14-regular">
            Keep that slack thread updated as PRs are merged
          </div>
        </Show>
        <For each={session.log}>
          {(entry) => (
            <output class="self-end max-w-[80%] whitespace-pre-wrap rounded-2xl border border-v2-border-border-base px-3.5 py-2.5 text-13-regular text-v2-text-text-muted">
              {entry}
            </output>
          )}
        </For>
        <Show when={session.working}>
          <span class="text-13-regular text-v2-text-text-faint">Working…</span>
        </Show>
      </div>
      <div class="shrink-0 px-2 pb-2">
        <Composer model={model} borderUnderlay />
      </div>
    </>
  )
}

function TouchStates(props: { state: State }) {
  const [view, setView] = createStore({ state: props.state, generation: 0 })
  const touch = matchMedia("(hover: none) and (pointer: coarse)")
  const [device, setDevice] = createStore({ touch: touch.matches })
  const sync = () => setDevice("touch", touch.matches)
  touch.addEventListener("change", sync)
  onCleanup(() => touch.removeEventListener("change", sync))
  const key = createMemo(() => `${view.state}:${view.generation}`)

  return (
    <div
      data-component="composer-touch-states"
      class="flex h-dvh flex-col bg-v2-background-bg-deep text-v2-text-text-base"
      style={{ "max-width": "430px", margin: "0 auto" }}
    >
      <header class="flex shrink-0 items-center gap-2 border-b border-v2-border-border-base px-3 py-2">
        <select
          aria-label="Composer state"
          class="h-9 min-w-0 flex-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 text-14-regular"
          value={view.state}
          onChange={(event) => setView({ state: event.currentTarget.value as State, generation: view.generation + 1 })}
        >
          <For each={states}>{(state) => <option value={state.id}>{state.name}</option>}</For>
        </select>
        <button
          type="button"
          class="h-9 rounded-md border border-v2-border-border-base px-3 text-14-regular"
          onClick={() => setView("generation", view.generation + 1)}
        >
          Reset
        </button>
        <span data-slot="touch-device" class="font-mono text-12-regular text-v2-text-text-faint">
          {device.touch ? "touch" : "mouse"}
        </span>
      </header>
      <Show keyed when={key()}>
        <TouchComposer state={view.state} />
      </Show>
      {/* Stands in for the shell's slot, so the touch bar docks to the bottom as it does in the app. */}
      <div data-slot="composer-touch-bar-mount" class="shrink-0" />
    </div>
  )
}

export default {
  title: "OpenCode/Composer/Touch",
  parameters: { layout: "fullscreen" },
  args: { state: "steer" },
  argTypes: { state: { control: "select", options: states.map((state) => state.id) } },
  render: (args: { state: State }) => <TouchStates state={args.state} />,
}

export const States = {}
