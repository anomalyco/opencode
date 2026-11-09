import type { SessionMessageInfo } from "@opencode/client/promise"
import { For, Show, createEffect, createMemo, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { replayScript, replaySession, scenarios, sessionSteps, ticks } from "../storybook/session-replay"
import { timelinePresets } from "./detail"
import { timelineStatus } from "./status"

/**
 * Compares the same session in two builds of the timeline: `base`, another checkout's stories server, and `head`, this
 * one. `script/timeline-compare.ts` in packages/stories starts both and opens this page. Every control drives both
 * sides, so the only difference between them is the code.
 */
export default {
  title: "OpenCode/Timeline/Compare",
  id: "timeline-compare",
  parameters: { layout: "fullscreen" },
}

type PresetID = (typeof timelinePresets)[number]["id"]

type View = "side" | "swipe" | "onion"

// Sessions exported with `script/timeline-compare.ts export <id>`. The folder is ignored by git: they hold real code.
const exported = Object.entries(
  import.meta.glob<{ info: { id: string; title?: string }; messages: SessionMessageInfo[] }>(
    "./compare-sessions/*.json",
    { eager: true, import: "default" },
  ),
).map(([path, data]) => ({
  name:
    data.info.title ||
    path
      .split("/")
      .at(-1)!
      .replace(/\.json$/, ""),
  data,
}))

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

export const Compare = {
  render: () => {
    const query = new URLSearchParams(location.search)
    const base = query.get("base")
    const baseLabel = query.get("baseLabel") ?? "base"
    const headLabel = query.get("headLabel") ?? "head"
    const sessions = [...Object.keys(scenarios), ...exported.map((session) => session.name)]

    const [state, setState] = createStore({
      session: sessions[0]!,
      preset: "compact" as PresetID,
      activity: true,
      tick: Number.MAX_SAFE_INTEGER,
      playing: false,
      width: 720,
      theme: "light" as "light" | "dark",
      turnDiffs: false,
      view: "side" as View,
      mix: 50,
    })

    const real = createMemo(() => exported.find((session) => session.name === state.session)?.data)

    const total = createMemo(() => {
      const session = real()

      if (session) return sessionSteps(session.messages)

      return scenarios[state.session as keyof typeof scenarios].reduce((sum, beat) => sum + ticks(beat), 0)
    })

    const tick = createMemo(() => Math.min(state.tick, total()))

    // The playhead is now, so live durations read like a session happening as you watch.
    const replay = createMemo(() => {
      const session = real()

      if (session) return replaySession(session.info.id, session.messages, tick())

      return replayScript(scenarios[state.session as keyof typeof scenarios], tick(), Date.now() - tick() * 1_500)
    })

    const detail = createMemo(() => timelinePresets.find((preset) => preset.id === state.preset)!.value)
    const busy = () => replay().document.status.type === "busy"

    const headStatus = createMemo(() => {
      if (!busy()) return undefined

      if (!state.activity) return "Working"
      const last = replay().document.messages.findLast((message) => message.type === "assistant")

      return statusLabels[timelineStatus({ detail: detail(), content: last?.type === "assistant" ? last.content : [] })]
    })

    const frames = {
      base: undefined as HTMLIFrameElement | undefined,
      head: undefined as HTMLIFrameElement | undefined,
    }

    const send = (side: keyof typeof frames) =>
      frames[side]?.contentWindow?.postMessage(
        {
          type: "timeline-compare:render",
          document: replay().document,
          detail: detail(),
          activity: side === "head" && state.activity,
          turnDiffs: state.turnDiffs,
          width: state.width,
          status: side === "head" ? headStatus() : busy() ? "Working" : undefined,
        },
        "*",
      )

    createEffect(() => {
      send("base")
      send("head")
    })

    // A frame that loads, or reloads for a theme, asks for the session. A scroll in one lines the other up with it.
    const receive = (event: MessageEvent<{ type: string; anchor: string; offset: number }>) => {
      const side =
        event.source === frames.base?.contentWindow
          ? "base"
          : event.source === frames.head?.contentWindow
            ? "head"
            : undefined

      if (!side) return

      if (event.data?.type === "timeline-compare:ready") return send(side)

      if (event.data?.type !== "timeline-compare:scroll") return
      frames[side === "base" ? "head" : "base"]?.contentWindow?.postMessage(
        { type: "timeline-compare:scroll-to", anchor: event.data.anchor, offset: event.data.offset },
        "*",
      )
    }

    onMount(() => window.addEventListener("message", receive))
    onCleanup(() => window.removeEventListener("message", receive))

    createEffect(() => {
      if (!state.playing) return
      const timer = setInterval(() => {
        if (tick() >= total()) return setState("playing", false)
        setState("tick", tick() + 1)
      }, 700)
      onCleanup(() => clearInterval(timer))
    })

    const src = (origin: string) => `${origin}/?id=timeline-compare-renderer--renderer&globals=theme:${state.theme}`

    const frame = (side: keyof typeof frames, origin: string, style?: JSX.CSSProperties) => (
      <Show when={state.theme} keyed>
        {(_) => (
          <iframe
            ref={(element) => (frames[side] = element)}
            title={side === "base" ? baseLabel : headLabel}
            src={src(origin)}
            class="absolute inset-0 h-full w-full border-0"
            style={style}
          />
        )}
      </Show>
    )

    return (
      <div class="flex h-screen min-h-0 flex-col bg-v2-background-bg-base text-v2-text-text-base">
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-v2-border-border-base px-5 py-2.5 text-13-regular">
          <Choice
            label="Session"
            options={sessions}
            value={state.session}
            onChange={(session) => setState({ session, tick: Number.MAX_SAFE_INTEGER, playing: false })}
          />
          <Choice
            label="Preset"
            options={timelinePresets.map((preset) => preset.id)}
            value={state.preset}
            onChange={(preset) => setState("preset", preset)}
          />
          <Check
            label={`Activity timeline (${headLabel})`}
            checked={state.activity}
            onChange={(activity) => setState("activity", activity)}
          />
          <Choice
            label="Width"
            options={[480, 720, 960] as const}
            value={state.width}
            onChange={(width) => setState("width", width)}
          />
          <Choice
            label="Theme"
            options={["light", "dark"] as const}
            value={state.theme}
            onChange={(theme) => setState("theme", theme)}
          />
          <Check
            label="Changed files"
            checked={state.turnDiffs}
            onChange={(turnDiffs) => setState("turnDiffs", turnDiffs)}
          />
          <Choice
            label="View"
            options={["side", "swipe", "onion"] as const}
            value={state.view}
            onChange={(view) => setState("view", view)}
          />
          <Show when={state.view !== "side"}>
            <input
              type="range"
              aria-label={state.view === "swipe" ? "Divider" : "Head opacity"}
              min="0"
              max="100"
              value={state.mix}
              onInput={(event) => setState("mix", event.currentTarget.valueAsNumber)}
            />
          </Show>
        </div>
        <div class="flex items-center gap-3 border-b border-v2-border-border-base px-5 py-2.5 text-13-regular">
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
          <span class="w-64 shrink-0 truncate text-v2-text-text-muted tabular-nums">
            {tick()}/{total()} · {replay().caption}
          </span>
        </div>
        <Show
          when={base}
          fallback={
            <p class="p-6 text-13-regular text-v2-text-text-muted">
              Open this page with <code>bun packages/stories/script/timeline-compare.ts</code>, which starts the base
              build and passes its address.
            </p>
          }
        >
          {(origin) => (
            <Show
              when={state.view === "side"}
              fallback={
                <div class="relative min-h-0 flex-1">
                  {frame("base", origin())}
                  {frame(
                    "head",
                    location.origin,
                    state.view === "swipe"
                      ? { "clip-path": `inset(0 0 0 ${state.mix}%)` }
                      : { opacity: state.mix / 100 },
                  )}
                  <Show when={state.view === "swipe"}>
                    <div
                      class="pointer-events-none absolute inset-y-0 w-px bg-v2-state-fg-danger"
                      style={{ left: `${state.mix}%` }}
                    />
                  </Show>
                  <div class="pointer-events-none absolute top-2 left-2 rounded bg-v2-background-bg-layer-03 px-2 py-0.5 text-12-regular">
                    {state.view === "swipe" ? `${baseLabel} | ${headLabel}` : `${baseLabel} under ${headLabel}`}
                  </div>
                </div>
              }
            >
              <div class="grid min-h-0 flex-1 grid-cols-2 divide-x divide-v2-border-border-base">
                <For
                  each={
                    [
                      ["base", origin()],
                      ["head", location.origin],
                    ] as const
                  }
                >
                  {([side, address]) => (
                    <div class="flex min-h-0 flex-col">
                      <div class="border-b border-v2-border-border-base px-4 py-1.5 text-12-medium text-v2-text-text-muted">
                        {side === "base" ? baseLabel : headLabel}
                      </div>
                      <div class="relative min-h-0 flex-1">{frame(side, address)}</div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          )}
        </Show>
      </div>
    )
  },
}

function Choice<T extends string | number>(props: {
  label: string
  options: readonly T[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <label class="flex items-center gap-2">
      <span class="text-v2-text-text-muted">{props.label}</span>
      <select
        class="rounded-md border border-v2-border-border-base bg-transparent px-1.5 py-0.5"
        value={String(props.value)}
        onChange={(event) =>
          props.onChange(props.options.find((option) => String(option) === event.currentTarget.value)!)
        }
      >
        <For each={props.options}>{(option) => <option value={String(option)}>{option}</option>}</For>
      </select>
    </label>
  )
}

function Check(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label class="flex items-center gap-2">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      {props.label}
    </label>
  )
}
