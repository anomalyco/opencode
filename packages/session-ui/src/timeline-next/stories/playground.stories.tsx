import { For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { CurrentSessionProviders } from "../../storybook/current-session-story"
import { timelinePresets } from "../../timeline/detail"
import { SessionTimeline } from "../../timeline/session-timeline"
import { createNextTimelineProjection } from "../projection"
import { laneGap } from "../spacing"
import { timelineStatus, timelineThinking } from "../status"
import { StatusLane } from "../status-line"
import { replayScript, scenarios, ticks, type ScenarioName } from "./session-replay"
import { NextSessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Timeline/Playground",
  id: "timeline-playground",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
}

type PresetID = (typeof timelinePresets)[number]["id"]

const defaultPreset: PresetID = "compact"

const defaultScenario: ScenarioName = "Feature work"

// SAFETY: the keys of the scenarios object are exactly its scenario names.
const scenarioNames = Object.keys(scenarios) as ScenarioName[]

// The status line the app shows below a working turn, in the New timeline.
const statusLabels = {
  waitingApproval: "Waiting for approval",
  waitingAnswer: "Waiting for your answer",
  waitingShell: "Waiting for shell",
  waitingAgent: "Waiting for subagent",
  waitingAgents: "Waiting for subagents",
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
      scenario: defaultScenario,
      preset: defaultPreset,
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

    const busy = () => replay().document.status.type === "busy"

    const projection = createNextTimelineProjection({
      sessionMessages: () => replay().document.messages,
      status: () => replay().document.status,
      timelineDetail: detail,
    })

    // Where the status line sits: the space the turn's next row would take, as the app computes it.
    const laneSpacing = createMemo(() => {
      const active = projection.activeMessageID()

      return active ? laneGap(projection.rows(), active, projection.messageByID()) : undefined
    })

    const status = createMemo(() => {
      const last = replay().document.messages.findLast((message) => message.type === "assistant")

      const content = last?.type === "assistant" ? last.content : []
      const value = timelineStatus({ content })

      // The thought the model is writing says Thinking in its own row, in place of Working.
      return value === "working" && state.activity && timelineThinking(detail(), content) ? undefined : value
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
            New timeline
          </label>
          <Segmented
            label="Session"
            options={scenarioNames}
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
              <Show
                when={state.activity}
                fallback={
                  <SessionTimeline document={replay().document} timelineDetail={detail()} turnDiffs={state.turnDiffs} />
                }
              >
                <NextSessionTimeline
                  document={replay().document}
                  timelineDetail={detail()}
                  turnDiffs={state.turnDiffs}
                />
              </Show>
            </CurrentSessionProviders>
            <Show
              when={state.activity}
              fallback={
                <div class="flex h-9 items-center gap-2 pt-3 px-4 text-[13px] font-[530] leading-text-compact md:px-6">
                  <Show when={busy()}>
                    <div data-component="session-working" role="status">
                      <TextShimmer text="Working" active />
                    </div>
                  </Show>
                </div>
              }
            >
              <StatusLane
                class="px-4 md:px-6"
                spacing={laneSpacing()}
                label={busy() && status() ? statusLabels[status()!] : undefined}
                collapsed={busy() && !status()}
              />
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
