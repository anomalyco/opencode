import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionStatus,
} from "@opencode/client/promise"
import { Match, Predicate } from "effect"
import { For, Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import type { SessionDocument } from "../src/document"
import { CurrentSessionProviders } from "../src/storybook/current-session-story"
import { timelinePresets } from "../src/timeline/detail"
import type { TimelineDetail } from "../src/timeline/detail"
import { createReactiveTimelineProjection, type ReasoningMode } from "../src/timeline/projection"
import { createSessionTimelineRowRenderer } from "../src/timeline/session-timeline-row"
import type { WorkSteps } from "../src/timeline/work-steps"
import { createNextTimelineProjection } from "../src/timeline-next/projection"
import { createNextTimelineRowRenderer } from "../src/timeline-next/row"

const sessionID = "session_work_steps_fixture"

const model = { id: "model", providerID: "provider" }

const compact = timelinePresets.find((preset) => preset.id === "compact")!.value

const tool = (
  id: string,
  name: string,
  status: "completed" | "running" = "completed",
): SessionMessageAssistantTool => ({
  id,
  type: "tool",
  name,
  state:
    status === "completed"
      ? { status, input: { path: `${id}.ts` }, content: [{ type: "text", text: id }], metadata: {} }
      : { status, input: { path: `${id}.ts` }, metadata: {} },
  time: { created: 2 },
})

const assistant = (id: string, content: SessionMessageAssistant["content"]): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "build",
  model,
  content,
  time: { created: 2, completed: 3 },
})

const initialMessages: SessionMessageInfo[] = [
  { id: "user-1", type: "user", text: "Run the checks", time: { created: 0 } },
  assistant("assistant-1", [
    {
      type: "reasoning",
      text: "## Project inspection\n\nInspect the project first.",
      time: { created: 2, completed: 3 },
    },
    tool("read-1", "read", "running"),
    { type: "text", text: "Intermediate update" },
    tool("grep-1", "grep"),
    tool("read-2", "read"),
    { type: "text", text: "Final answer" },
  ]),
]

const nextInput: SessionMessageInfo = { id: "user-2", type: "user", text: "Continue", time: { created: 10 } }

const replyOnlyMessages: SessionMessageInfo[] = [
  { id: "user-1", type: "user", text: "Reply without tools", time: { created: 0 } },
  assistant("assistant-1", [{ type: "text", text: "Intermediate reply only" }]),
  assistant("assistant-2", [{ type: "text", text: "Final reply only" }]),
]

const nativeDetailMessages: SessionMessageInfo[] = [
  { id: "user-1", type: "user", text: "Inspect native details", time: { created: 0 } },
  assistant("assistant-1", [
    {
      type: "reasoning",
      text: "## Native reasoning\n\nNATIVE_REASONING_BODY",
      time: { created: 2, completed: 3 },
    },
    {
      type: "tool",
      id: "tool-native-shell",
      name: "shell",
      state: {
        status: "completed",
        input: { command: "echo native" },
        content: [{ type: "text", text: "NATIVE_SHELL_OUTPUT" }],
        metadata: { exit: 0 },
      },
      time: { created: 4, completed: 5 },
    },
    {
      type: "tool",
      id: "tool-native-edit",
      name: "edit",
      state: {
        status: "completed",
        input: {
          path: "src/native.ts",
          oldString: 'const value = "old"',
          newString: 'const value = "NATIVE_EDIT_LINE"',
        },
        content: [{ type: "text", text: "Updated src/native.ts" }],
        metadata: {},
      },
      time: { created: 6, completed: 7 },
    },
    { type: "text", text: "Native details complete" },
  ]),
]

const nativeShellMessages: SessionMessageInfo[] = [
  { id: "user-1", type: "user", text: "Run native shell calls", time: { created: 0 } },
  assistant("assistant-1", [
    ...Array.from(
      { length: 7 },
      (_, index): SessionMessageAssistantTool => ({
        type: "tool",
        id: `tool-native-shell-${index + 1}`,
        name: "shell",
        state: {
          status: "completed",
          input: { command: `echo shell-${index + 1}` },
          content: [{ type: "text", text: `NATIVE_SHELL_${index + 1}_OUTPUT` }],
          metadata: { exit: index === 3 ? 1 : 0 },
        },
        time: { created: 2 + index, completed: 9 + index },
      }),
    ),
    { type: "text", text: "Native shell details complete" },
  ]),
]

let mounted:
  | {
      setStatus: (status: SessionStatus) => void
      addNextInput: () => void
      completeTools: () => void
    }
  | undefined

export function WorkStepsFixture(props: {
  timeline: "current" | "next"
  workSteps: WorkSteps
  timelineDetail?: TimelineDetail
  reasoningMode?: ReasoningMode
  scenario?: "work" | "replies" | "native" | "shell-separate"
  showControls?: boolean
}) {
  const seedMessages = Match.value(props.scenario).pipe(
    Match.when("replies", () => replyOnlyMessages),
    Match.when("native", () => nativeDetailMessages),
    Match.when("shell-separate", () => nativeShellMessages),
    Match.orElse(() => initialMessages),
  )

  const timelineDetail = () => props.timelineDetail ?? compact
  const [messages, setMessages] = createSignal<SessionMessageInfo[]>(seedMessages)
  const [status, setStatus] = createSignal<SessionStatus>({ type: "busy" })
  const [disclosure, setDisclosure] = createStore<Record<string, boolean | undefined>>({})

  const documentValue: SessionDocument = {
    sessionID,
    messages: seedMessages,
    status: { type: "busy" },
    diffs: [],
  }

  const currentProjection = createReactiveTimelineProjection({
    sessionMessages: messages,
    status,
    reasoningMode: () => props.reasoningMode ?? "compact",
    timelineDetail,
    workSteps: () => props.workSteps,
  })

  const nextProjection = createNextTimelineProjection({
    sessionMessages: messages,
    status,
    timelineDetail,
    workSteps: () => props.workSteps,
  })

  const renderer = () => {
    if (props.timeline === "next") {
      const nextRenderer = createNextTimelineRowRenderer({
        sessionID: () => sessionID,
        status,
        projection: nextProjection,
        presentation: () => undefined,
        timelineDetail,
        workSteps: () => props.workSteps,
        disclosure: {
          value: (key) => disclosure[key],
          set: (key, open) => setDisclosure(key, open),
        },
      })

      return (
        <For each={nextProjection.rows().filter((row) => !Predicate.isTagged(row, "UserMessage"))}>
          {(row) => <nextRenderer.Row row={() => row} />}
        </For>
      )
    }

    const currentRenderer = createSessionTimelineRowRenderer({
      sessionID: () => sessionID,
      status,
      projection: currentProjection,
      presentation: () => undefined,
      reasoningMode: () => props.reasoningMode ?? "compact",
      shellToolDefaultOpen: () => false,
      editToolDefaultOpen: () => false,
      timelineDetail,
      workSteps: () => props.workSteps,
      disclosure: {
        value: (key) => disclosure[key],
        set: (key, open) => setDisclosure(key, open),
      },
    })

    return (
      <For each={currentProjection.rows().filter((row) => !Predicate.isTagged(row, "UserMessage"))}>
        {(row) => <currentRenderer.Row row={() => row} />}
      </For>
    )
  }

  mounted = {
    setStatus,
    addNextInput: () => setMessages((current) => [...current, nextInput]),
    completeTools: () =>
      setMessages((current) =>
        current.map((message) =>
          message.type === "assistant" && message.id === "assistant-1"
            ? {
                ...message,
                content: message.content.map((content) =>
                  content.type === "tool" && content.id === "read-1" ? tool("read-1", "read") : content,
                ),
              }
            : message,
        ),
      ),
  }

  return (
    <div data-testid="work-steps-fixture">
      <Show when={props.showControls}>
        <section class="flex items-center gap-2 px-4 py-3">
          <Button size="small" variant="neutral" onClick={controls.live}>
            Live
          </Button>
          <Button size="small" variant="neutral" onClick={controls.settle}>
            Settled
          </Button>
          <Button size="small" variant="neutral" onClick={controls.addNextInput}>
            Next input
          </Button>
        </section>
      </Show>
      <DialogProvider>
        <CurrentSessionProviders document={documentValue}>
          <div data-component="session-timeline">{renderer()}</div>
        </CurrentSessionProviders>
      </DialogProvider>
    </div>
  )
}

export function mountWorkSteps(options: Parameters<typeof WorkStepsFixture>[0]) {
  document.querySelector("[data-testid='work-steps-fixture']")?.remove()
  const host = document.createElement("div")
  document.body.append(host)
  render(() => <WorkStepsFixture {...options} />, host)
}

export const controls = {
  settle: () => mounted?.setStatus({ type: "idle" }),
  live: () => mounted?.setStatus({ type: "busy" }),
  addNextInput: () => mounted?.addNextInput(),
  completeTools: () => mounted?.completeTools(),
}
