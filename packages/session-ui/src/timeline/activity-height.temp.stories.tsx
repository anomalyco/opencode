import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode-ai/client/promise"
import { Button } from "@opencode-ai/ui/button"
import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import type { SessionDocument } from "../document"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../storybook/current-session-fixtures"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { SessionTimeline } from "./session-timeline"

const modes = ["thinking", "shell", "edit", "patch"] as const
type Mode = (typeof modes)[number]

const labels = {
  thinking: "Thinking",
  shell: "Shell",
  edit: "Edit",
  patch: "Patch",
} satisfies Record<Mode, string>

const tool = (name: Exclude<Mode, "thinking">): SessionMessageAssistantTool => ({
  type: "tool",
  id: `tool_${name}`,
  name,
  state: {
    status: "running",
    input:
      name === "shell"
        ? { command: "bun test src/timeline" }
        : name === "edit"
          ? { path: "src/timeline/projection.ts", oldString: "before", newString: "after" }
          : { patchText: "*** Begin Patch\n*** Update File: src/timeline/projection.ts" },
    metadata: {},
  },
  time: { created: STORY_TIME + 2_000, ran: STORY_TIME + 2_100 },
})

const user = {
  id: "msg_activity_height_user",
  type: "user",
  text: "Keep the active status row stable while work begins.",
  metadata: { agent: "build", model: STORY_MODEL },
  time: { created: STORY_TIME + 1_000 },
} satisfies SessionMessageInfo

const documents = Object.fromEntries(
  modes.map((mode) => [
    mode,
    {
      sessionID: CURRENT_SESSION_ID,
      status: { type: "busy" },
      diffs: [],
      messages:
        mode === "thinking"
          ? [user]
          : [
              user,
              {
                id: `msg_activity_height_${mode}`,
                type: "assistant",
                agent: "build",
                model: STORY_MODEL,
                content: [tool(mode)],
                time: { created: STORY_TIME + 2_000 },
              },
            ],
    } satisfies SessionDocument,
  ]),
) as Record<Mode, SessionDocument>

function ActivityHeightStory() {
  const [mode, setMode] = createSignal<Mode>("thinking")
  const [cycling, setCycling] = createSignal(true)
  const [height, setHeight] = createSignal(0)
  let surface: HTMLDivElement | undefined
  let frame: number | undefined

  const measure = () => {
    const row = Array.from(surface?.querySelectorAll<HTMLElement>("[data-timeline-row]") ?? []).at(-1)
    if (row) setHeight(row.getBoundingClientRect().height)
  }

  createEffect(() => {
    mode()
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measure)
  })

  onMount(() => {
    const observer = new ResizeObserver(measure)
    if (surface) observer.observe(surface)
    const interval = setInterval(() => {
      if (!cycling()) return
      setMode((current) => modes[(modes.indexOf(current) + 1) % modes.length])
    }, 1_500)
    onCleanup(() => {
      observer.disconnect()
      clearInterval(interval)
      if (frame !== undefined) cancelAnimationFrame(frame)
    })
  })

  return (
    <section class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header class="flex items-start justify-between gap-4 border-b border-border-weak-base pb-3">
        <div>
          <h1 class="text-16-medium text-text-strong">Temporary activity-row height check</h1>
          <p class="mt-1 text-13-regular text-text-weak">
            Thinking and pending tool states should all measure 32px without moving the transcript.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <code class="text-13-medium text-text-strong">{height()}px</code>
          <Button size="small" variant="neutral" onClick={() => setCycling((value) => !value)}>
            {cycling() ? "Pause" : "Cycle"}
          </Button>
        </div>
      </header>
      <div class="flex flex-wrap gap-2">
        <For each={modes}>
          {(item) => (
            <Button size="small" variant={mode() === item ? "primary" : "neutral"} onClick={() => setMode(item)}>
              {labels[item]}
            </Button>
          )}
        </For>
      </div>
      <div ref={surface} class="min-h-32 overflow-hidden rounded-lg border border-border-weak-base bg-background-base py-4">
        <CurrentSessionProviders document={documents[mode()]}>
          <SessionTimeline document={documents[mode()]} />
        </CurrentSessionProviders>
      </div>
    </section>
  )
}

export default {
  title: "Temporary/Activity row height",
  id: "temporary-activity-row-height",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
}

export const SwitchingActiveState = {
  render: () => <ActivityHeightStory />,
}
