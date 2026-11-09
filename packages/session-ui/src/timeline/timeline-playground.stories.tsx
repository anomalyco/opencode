import type {
  JsonValue,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client/promise"
import { For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../document"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { CURRENT_SESSION_ID, STORY_MODEL } from "../storybook/current-session-fixtures"
import { timelinePresets } from "./detail"
import { timelineStatus } from "./status"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Timeline/Playground",
  id: "timeline-playground",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
}

/**
 * A scripted session is a list of beats. Each beat takes one or more steps of the playhead: a tool call starts and then
 * finishes, a thought starts empty, streams, and then finishes. Dragging the playhead replays the session up to that step
 * with the same message shapes the server streams, so the timeline shows its live and finished states.
 */
type Beat =
  | { kind: "user"; text: string }
  | { kind: "shell"; command: string; output: string; exit: number }
  | { kind: "goal"; objective: string }
  | { kind: "model"; id: string }
  | { kind: "step" }
  | { kind: "think"; text: string }
  | { kind: "say"; text: string }
  | {
      kind: "tool"
      name: string
      input: Record<string, JsonValue>
      output?: string
      metadata?: Record<string, JsonValue>
      error?: string
      /** Still running when the next beat arrives, such as a command the user interrupts. */
      hold?: boolean
    }
  | { kind: "interrupt" }
  | { kind: "idle" }

const steps: Record<Beat["kind"], number> = {
  user: 1,
  shell: 2,
  goal: 1,
  model: 1,
  step: 0,
  think: 3,
  say: 2,
  tool: 2,
  interrupt: 1,
  idle: 1,
}

function ticks(beat: Beat) {
  return beat.kind === "tool" && beat.hold ? 1 : steps[beat.kind]
}

function diff(file: string, additions: number, deletions: number, status: "modified" | "added" = "modified") {
  const removed = Array.from({ length: deletions }, (_, index) => `-const before${index} = true`)
  const added = Array.from({ length: additions }, (_, index) => `+const after${index} = true`)

  return {
    file,
    status,
    additions,
    deletions,
    patch: `@@ -1,${deletions} +1,${additions} @@\n${[...removed, ...added].join("\n")}\n`,
  }
}

const featureWork: Beat[] = [
  { kind: "user", text: "Add a dark mode toggle to the settings page and make sure the tests pass." },
  {
    kind: "think",
    text: "## Finding the settings page\n\nI need to find where the settings rows render and how the theme is stored before adding a toggle.",
  },
  {
    kind: "tool",
    name: "glob",
    input: { pattern: "src/settings/**/*.tsx", path: "/workspace" },
    metadata: { count: 6 },
  },
  {
    kind: "tool",
    name: "grep",
    input: { pattern: "colorScheme", path: "/workspace/src", include: "*.tsx" },
    metadata: { matches: 4 },
  },
  { kind: "tool", name: "read", input: { path: "/workspace/src/settings/general.tsx" } },
  { kind: "tool", name: "read", input: { path: "/workspace/src/theme/scheme.ts" } },
  { kind: "step" },
  {
    kind: "say",
    text: "The settings page renders its rows from `general.tsx`, and the theme keeps the scheme in `scheme.ts`. I'll add a toggle row that writes the scheme.",
  },
  {
    kind: "think",
    text: "## Adding the toggle\n\nA new component keeps the row small. The scheme store needs a setter the row can call.",
  },
  {
    kind: "tool",
    name: "write",
    input: { path: "/workspace/src/settings/theme-toggle.tsx", content: "export function ThemeToggle() {}\n" },
    metadata: { files: [diff("/workspace/src/settings/theme-toggle.tsx", 24, 0, "added")] },
  },
  {
    kind: "tool",
    name: "edit",
    input: { path: "/workspace/src/settings/general.tsx", oldString: "before", newString: "after" },
    metadata: { files: [diff("/workspace/src/settings/general.tsx", 6, 2)] },
  },
  {
    kind: "tool",
    name: "patch",
    input: { patchText: "*** Begin Patch" },
    metadata: { files: [diff("/workspace/src/theme/scheme.ts", 9, 3), diff("/workspace/src/theme/index.ts", 1, 0)] },
  },
  { kind: "step" },
  {
    kind: "tool",
    name: "shell",
    input: { command: "bun test src/settings", description: "Run the settings tests" },
    output: 'settings.test.tsx:\n✗ toggles the scheme\n  Expected: "dark"\n  Received: "light"\n\n1 fail, 11 pass',
    metadata: { exit: 1 },
  },
  {
    kind: "think",
    text: "The toggle writes the scheme before the store subscribes. Reading it in an effect fixes it.",
  },
  {
    kind: "tool",
    name: "edit",
    input: { path: "/workspace/src/settings/theme-toggle.tsx", oldString: "before", newString: "after" },
    metadata: { files: [diff("/workspace/src/settings/theme-toggle.tsx", 3, 1)] },
  },
  {
    kind: "tool",
    name: "shell",
    input: { command: "bun test src/settings", description: "Run the settings tests" },
    output: "12 pass, 0 fail",
    metadata: { exit: 0 },
  },
  { kind: "step" },
  {
    kind: "say",
    text: "Added a **Dark mode** toggle to General settings. It writes the color scheme through the theme store, and the settings tests pass.",
  },
  { kind: "idle" },
  {
    kind: "shell",
    command: "git status --short",
    output: " M src/settings/general.tsx\n M src/theme/scheme.ts\n?? src/settings/theme-toggle.tsx",
    exit: 0,
  },
  { kind: "goal", objective: "Ship dark mode with docs and a changelog entry" },
  {
    kind: "think",
    text: "## Checking conventions\n\nI should match how other apps document a color scheme preference.",
  },
  { kind: "tool", name: "websearch", input: { query: "prefers-color-scheme settings toggle best practices" } },
  {
    kind: "tool",
    name: "webfetch",
    input: { url: "https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme" },
  },
  { kind: "tool", name: "skill", input: { name: "docs-style" }, metadata: { name: "docs-style" } },
  { kind: "step" },
  {
    kind: "tool",
    name: "write",
    input: { path: "/workspace/docs/settings.md", content: "# Settings\n" },
    metadata: { files: [diff("/workspace/docs/settings.md", 14, 0)] },
  },
  {
    kind: "tool",
    name: "execute",
    input: {
      code: 'const issue = await tools.linear.create_issue({ title: "Announce dark mode", team: "Desktop" })\nawait tools.slack.post_message({ channel: "#desktop", text: issue.url })\nreturn issue.id',
    },
    output: "DES-412",
    metadata: {
      toolCalls: [
        { tool: "search", status: "completed", input: { query: "linear" } },
        { tool: "linear.create_issue", status: "completed", input: { title: "Announce dark mode", team: "Desktop" } },
        { tool: "slack.post_message", status: "completed", input: { channel: "#desktop" } },
      ],
    },
  },
  {
    kind: "tool",
    name: "subagent",
    input: { agent: "review", description: "Review the dark mode change", prompt: "Review the diff." },
    output: "Looks good. One nit: name the store setter `setScheme`.",
    metadata: { sessionID: "session_child_review", status: "completed" },
  },
  { kind: "tool", name: "shell", input: { command: "bun run build", description: "Build the app" }, hold: true },
  { kind: "interrupt" },
  { kind: "model", id: "fast-nano" },
  { kind: "user", text: "Skip the build, just add the changelog entry." },
  {
    kind: "think",
    text: "## Writing the changelog\n\nThe entry goes under the next release. I'll keep it to one line that names the setting.",
  },
  {
    kind: "tool",
    name: "edit",
    input: { path: "/workspace/CHANGELOG.md", oldString: "before", newString: "after" },
    metadata: { files: [diff("/workspace/CHANGELOG.md", 1, 0)] },
  },
  { kind: "step" },
  { kind: "say", text: "Added the changelog entry under the next release." },
  { kind: "idle" },
]

const thinkingOnly: Beat[] = [
  { kind: "user", text: "Why does the timeline jump when a turn finishes?" },
  { kind: "think", text: "" },
  {
    kind: "think",
    text: "## Tracing row identity\n\nRows are keyed by group type, so a group that changes type remounts and loses its measured height.",
  },
  { kind: "step" },
  {
    kind: "say",
    text: "Rows are keyed by their group type. When a tool fails, its group changes type and the row remounts, which loses its measured height.",
  },
  { kind: "idle" },
]

const scenarios = { "Feature work": featureWork, "Thinking only": thinkingOnly } as const

type ScenarioName = keyof typeof scenarios

type PresetID = (typeof timelinePresets)[number]["id"]

// The status line the app shows below a working turn, in the Activity timeline.
const statusLabels = {
  waitingApproval: "Waiting for approval",
  waitingAnswer: "Waiting for your answer",
  waitingCommand: "Waiting for a command",
  waitingAgent: "Waiting for a subagent",
  thinking: "Thinking",
  exploring: "Exploring",
  editing: "Editing",
  running: "Running",
  working: "Working",
} as const

// Another page can drive an embedded playground, such as one comparing it with the released timeline step by step.
type PlaygroundMessage = {
  type: "timeline-playground"
  scenario?: ScenarioName
  preset?: PresetID
  activity?: boolean
  tick?: number
  width?: number
  turnDiffs?: boolean
}

export const Playground = {
  args: { embedded: false },
  render: (args: { embedded: boolean }) => {
    const [state, setState] = createStore({
      scenario: "Feature work" as ScenarioName,
      preset: "compact" as PresetID,
      activity: true,
      tick: Number.MAX_SAFE_INTEGER,
      playing: false,
      width: 720,
      turnDiffs: false,
    })

    const script = createMemo(() => scenarios[state.scenario])
    const detail = createMemo(() => timelinePresets.find((preset) => preset.id === state.preset)!.value)
    const total = createMemo(() => script().reduce((sum, beat) => sum + ticks(beat), 0))
    const tick = createMemo(() => Math.min(state.tick, total()))
    // The playhead is now, so live durations read like a session happening as you watch.
    const replay = createMemo(() => replayScript(script(), tick(), Date.now() - tick() * 1_500))

    const status = createMemo(() => {
      const last = replay().document.messages.findLast((message) => message.type === "assistant")

      return timelineStatus({ detail: detail(), content: last?.type === "assistant" ? last.content : [] })
    })

    const receive = (event: MessageEvent<PlaygroundMessage>) => {
      if (event.data?.type !== "timeline-playground") return
      const { type: _, ...next } = event.data
      setState({ ...next, playing: false })
    }

    window.addEventListener("message", receive)
    onCleanup(() => window.removeEventListener("message", receive))
    createEffect(() => window.parent.postMessage({ type: "timeline-playground:total", total: total() }, "*"))

    createEffect(() => {
      if (!state.playing) return
      const timer = setInterval(() => {
        if (tick() >= total()) return setState("playing", false)
        setState("tick", tick() + 1)
      }, 700)
      onCleanup(() => clearInterval(timer))
    })

    return (
      <div class="flex h-screen min-h-0 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        <div
          classList={{ hidden: args.embedded }}
          class="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-v2-border-border-base px-6 py-3 text-13-regular"
        >
          <Segmented
            label="Preset"
            options={timelinePresets.map((preset) => preset.id)}
            value={state.preset}
            onChange={(preset) => setState("preset", preset)}
          />
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={state.activity}
              onChange={(event) => setState("activity", event.currentTarget.checked)}
            />
            Activity timeline
          </label>
          <Segmented
            label="Session"
            options={Object.keys(scenarios) as ScenarioName[]}
            value={state.scenario}
            onChange={(scenario) => setState({ scenario, tick: Number.MAX_SAFE_INTEGER, playing: false })}
          />
          <Segmented
            label="Width"
            options={[480, 720, 960] as const}
            value={state.width}
            onChange={(width) => setState("width", width)}
          />
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={state.turnDiffs}
              onChange={(event) => setState("turnDiffs", event.currentTarget.checked)}
            />
            Changed files
          </label>
        </div>
        <div
          classList={{ hidden: args.embedded }}
          class="flex items-center gap-3 border-b border-v2-border-border-base px-6 py-3 text-13-regular"
        >
          <button
            type="button"
            class="w-16 rounded-md border border-v2-border-border-base px-2 py-1"
            onClick={() => {
              if (tick() >= total()) setState("tick", 0)
              setState("playing", !state.playing)
            }}
          >
            {state.playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            class="rounded-md border border-v2-border-border-base px-2 py-1"
            onClick={() => setState({ tick: Math.max(0, tick() - 1), playing: false })}
          >
            ‹
          </button>
          <button
            type="button"
            class="rounded-md border border-v2-border-border-base px-2 py-1"
            onClick={() => setState({ tick: Math.min(total(), tick() + 1), playing: false })}
          >
            ›
          </button>
          <input
            type="range"
            aria-label="Point in the session"
            class="min-w-0 flex-1"
            min="0"
            max={total()}
            value={tick()}
            onInput={(event) => setState({ tick: event.currentTarget.valueAsNumber, playing: false })}
          />
          <span class="w-72 shrink-0 truncate text-v2-text-text-muted tabular-nums">
            {tick()}/{total()} · {replay().caption}
          </span>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto" data-scrollable>
          <div class="mx-auto py-6" style={{ "max-width": `${state.width}px` }}>
            <CurrentSessionProviders document={replay().document}>
              <SessionTimeline
                document={replay().document}
                timelineDetail={detail()}
                activity={state.activity}
                turnDiffs={state.turnDiffs}
              />
            </CurrentSessionProviders>
            <Show when={replay().document.status.type === "busy"}>
              <div class="px-6 pt-3 text-13-medium text-v2-text-text-muted" role="status">
                {state.activity ? statusLabels[status()] : "Working"}
              </div>
            </Show>
          </div>
        </div>
      </div>
    )
  },
}

function Segmented<T extends string | number>(props: {
  label: string
  options: readonly T[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div class="flex items-center gap-2">
      <span class="text-v2-text-text-muted">{props.label}</span>
      <div class="flex rounded-md border border-v2-border-border-base p-0.5">
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              class="rounded px-2 py-0.5 capitalize"
              classList={{ "bg-v2-background-bg-layer-03": option === props.value }}
              aria-pressed={option === props.value}
              onClick={() => props.onChange(option)}
            >
              {option}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function replayScript(script: Beat[], limit: number, start: number): { document: SessionDocument; caption: string } {
  const messages: SessionMessageInfo[] = []
  const state = { used: 0, busy: false, caption: "Start", assistant: undefined as SessionMessageAssistant | undefined }
  const at = () => start + state.used * 1_500
  const id = (prefix: string) => `${prefix}_${messages.length}_${state.used}`

  const closeStep = () => {
    if (state.assistant) state.assistant.time.completed = at()
    state.assistant = undefined
  }

  const assistant = () => {
    if (state.assistant) return state.assistant
    const message: SessionMessageAssistant = {
      id: id("msg_assistant"),
      type: "assistant",
      agent: "build",
      model: STORY_MODEL,
      content: [],
      time: { created: at() },
    }
    messages.push(message)
    state.assistant = message

    return message
  }

  for (const beat of script) {
    const available = limit - state.used

    if (available <= 0) break
    const progress = Math.min(available, ticks(beat))
    const done = progress === ticks(beat) && !(beat.kind === "tool" && beat.hold)
    state.caption = caption(beat, done)

    if (beat.kind === "user") {
      closeStep()
      messages.push({
        id: id("msg_user"),
        type: "user",
        text: beat.text,
        time: { created: at() },
        metadata: { agent: "build", model: STORY_MODEL },
      })
      state.busy = true
    }

    if (beat.kind === "shell") {
      closeStep()
      messages.push({
        id: id("msg_shell"),
        type: "shell",
        shellID: id("shell"),
        command: beat.command,
        status: done ? "exited" : "running",
        exit: done ? beat.exit : undefined,
        output: done
          ? { output: beat.output, cursor: beat.output.length, size: beat.output.length, truncated: false }
          : undefined,
        time: { created: at(), completed: done ? at() + 800 : undefined },
      })
    }

    if (beat.kind === "goal") {
      closeStep()
      messages.push({
        id: id("msg_goal"),
        type: "synthetic",
        text: `Keep working until this objective is met: ${beat.objective}`,
        description: `Goal: ${beat.objective}`,
        metadata: { source: "goal" },
        time: { created: at() },
      })
      state.busy = true
    }

    if (beat.kind === "model") {
      closeStep()
      messages.push({
        id: id("msg_model"),
        type: "model-switched",
        model: { id: beat.id, providerID: "company-gateway" },
        previous: STORY_MODEL,
        time: { created: at() },
      })
    }

    if (beat.kind === "step") closeStep()

    if (beat.kind === "think")
      assistant().content.push({
        type: "reasoning",
        // An empty thought shows that the model is thinking before its first words arrive.
        text: progress === 1 ? "" : progress === 2 ? beat.text.slice(0, Math.ceil(beat.text.length / 2)) : beat.text,
        time: { created: at(), completed: done ? at() + 1_000 : undefined },
      })

    if (beat.kind === "say")
      assistant().content.push({ type: "text", text: done ? beat.text : beat.text.slice(0, beat.text.length / 2) })

    if (beat.kind === "tool") assistant().content.push(tool(id("tool"), beat, done, at()))

    if (beat.kind === "interrupt" && state.assistant) {
      state.assistant.content = state.assistant.content.map((content) =>
        content.type === "tool" && content.state.status === "running"
          ? tool(
              content.id,
              { kind: "tool", name: content.name, input: content.state.input, error: "Tool execution interrupted" },
              true,
              at(),
            )
          : content,
      )
      state.assistant.error = { type: "aborted", message: "The user interrupted the turn" }
      closeStep()
      messages.push({ id: id("msg_idle"), type: "idle", outcome: "interrupted", time: { created: at() } })
      state.busy = false
    }

    if (beat.kind === "idle") {
      closeStep()
      messages.push({ id: id("msg_idle"), type: "idle", outcome: "succeeded", time: { created: at() } })
      state.busy = false
    }

    state.used += progress
  }

  return {
    document: {
      sessionID: CURRENT_SESSION_ID,
      // New arrays and objects on every step, as a streamed update would deliver them.
      messages: structuredClone(messages),
      status: { type: state.busy ? "busy" : "idle" },
      diffs: [],
    },
    caption: state.caption,
  }
}

function tool(
  id: string,
  beat: Extract<Beat, { kind: "tool" }>,
  done: boolean,
  time: number,
): SessionMessageAssistantTool {
  if (!done)
    return {
      type: "tool",
      id,
      name: beat.name,
      state: { status: "running", input: beat.input, metadata: running(beat.metadata ?? {}) },
      time: { created: time, ran: time + 100 },
    }

  if (beat.error)
    return {
      type: "tool",
      id,
      name: beat.name,
      state: {
        status: "error",
        input: beat.input,
        error: {
          type: beat.error === "Tool execution interrupted" ? "aborted" : "ToolExecutionError",
          message: beat.error,
        },
        metadata: beat.metadata,
      },
      time: { created: time, ran: time + 100, completed: time + 700 },
    }

  return {
    type: "tool",
    id,
    name: beat.name,
    state: {
      status: "completed",
      input: beat.input,
      content: [{ type: "text", text: beat.output ?? "Done" }],
      metadata: beat.metadata,
    },
    time: { created: time, ran: time + 100, completed: time + 900 },
  }
}

// A running Code Mode script is still inside its last call.
function running(metadata: Record<string, JsonValue>) {
  const calls = metadata.toolCalls

  if (!Array.isArray(calls) || calls.length === 0) return metadata

  return { ...metadata, toolCalls: [...calls.slice(0, -1), { ...(calls.at(-1) as object), status: "running" }] }
}

function caption(beat: Beat, done: boolean) {
  if (beat.kind === "user") return "You sent a message"
  if (beat.kind === "shell") return done ? `You ran ${beat.command}` : `Running ${beat.command}`
  if (beat.kind === "goal") return "You set a goal"
  if (beat.kind === "model") return "You switched models"
  if (beat.kind === "think") return done ? "Finished thinking" : "Thinking"
  if (beat.kind === "say") return done ? "Answered" : "Writing"
  if (beat.kind === "tool") return done ? `${beat.name} finished` : `${beat.name} running`
  if (beat.kind === "interrupt") return "You interrupted the turn"
  if (beat.kind === "idle") return "Turn finished"

  return "Next step"
}
