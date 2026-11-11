import type { SessionMessageInfo } from "@opencode/client/promise"
import { For, Show, createEffect, createMemo, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { timelinePresets } from "../../timeline/detail"
import { createNextTimelineProjection } from "../projection"
import { laneGap } from "../spacing"
import { timelineStatus, timelineThinking } from "../status"
import { replayScript, replaySession, scenarios, sessionSteps, ticks } from "./session-replay"

/**
 * Compares the same session drawn two ways, side by side. On its own it shows this build's current timeline beside its
 * New timeline, which is the page to share with the team: `?id=timeline-compare--compare`. With `?base=` set to another
 * checkout's stories server it compares that build with this one instead, such as dev with the New timeline off.
 *
 * Every control drives both sides, so the only difference between them is the timeline. The controls live in the
 * address, so a link opens on the same session, setting and step.
 */
export default {
  title: "OpenCode/Timeline/Compare",
  id: "timeline-compare",
  parameters: { layout: "fullscreen" },
}

type PresetID = (typeof timelinePresets)[number]["id"]

type Side = "base" | "head"

const views = ["side", "swipe", "onion"] as const

type View = (typeof views)[number]

const defaultView: View = "side"

const defaultPreset: PresetID = "compact"

// Scripted sessions by name; a name with no script is an exported session.
const scripts = new Map(Object.entries(scenarios))

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
  waitingShell: "Waiting for shell",
  waitingAgent: "Waiting for subagent",
  waitingAgents: "Waiting for subagents",
  working: "Working",
} as const

export const Compare = {
  render: () => {
    const query = new URLSearchParams(location.search)
    // Without another build to compare, the page compares this build's two timelines.
    const other = query.get("base")
    // This build's own page, wherever it is hosted, and the other build's stories server.
    const self = location.href.split("?")[0]!
    const base = other ? `${other.replace(/\/$/, "")}/` : self
    const baseLabel = query.get("baseLabel") ?? (other ? "base" : "Current timeline")
    const headLabel = query.get("headLabel") ?? (other ? "head" : "New timeline")
    const sessions = [...Object.keys(scenarios), ...exported.map((session) => session.name)]

    const presetIDs = timelinePresets.map((preset) => preset.id)
    const number = (key: string) => (query.has(key) ? Number(query.get(key)) : undefined)

    const [state, setState] = createStore({
      session: sessions.find((session) => session === query.get("session")) ?? sessions[0]!,
      preset: presetIDs.find((preset) => preset === query.get("preset")) ?? defaultPreset,
      next: query.get("next") !== "false",
      baseNext: query.get("baseNext") === "true",
      tick: number("step") ?? Number.MAX_SAFE_INTEGER,
      playing: false,
      width: ([480, 720, 960] as const).find((width) => width === number("width")) ?? 720,
      theme: query.get("theme") === "light" ? ("light" as const) : ("dark" as const),
      turnDiffs: query.get("files") === "true",
      view: views.find((view) => view === query.get("view")) ?? defaultView,
      mix: 50,
    })

    // The address follows the controls, so a link opens where it was copied.
    createEffect(() => {
      const address = new URLSearchParams(location.search)
      address.set("session", state.session)
      address.set("preset", state.preset)
      address.set("theme", state.theme)
      address.set("width", String(state.width))
      address.set("view", state.view)

      if (state.turnDiffs) address.set("files", "true")
      else address.delete("files")

      if (state.tick < Number.MAX_SAFE_INTEGER) address.set("step", String(state.tick))
      else address.delete("step")
      history.replaceState(history.state, "", `?${address}`)
    })

    const real = createMemo(() => exported.find((session) => session.name === state.session)?.data)

    const total = createMemo(() => {
      const session = real()

      if (session) return sessionSteps(session.messages)

      return (scripts.get(state.session) ?? []).reduce((sum, beat) => sum + ticks(beat), 0)
    })

    const tick = createMemo(() => Math.min(state.tick, total()))

    // The playhead is now, so live durations read like a session happening as you watch.
    const replay = createMemo(() => {
      const session = real()

      if (session) return replaySession(session.info.id, session.messages, tick())

      return replayScript(scripts.get(state.session) ?? [], tick(), Date.now() - tick() * 1_500)
    })

    const detail = createMemo(() => timelinePresets.find((preset) => preset.id === state.preset)!.value)
    const busy = () => replay().document.status.type === "busy"

    const nextStatus = createMemo(() => {
      if (!busy()) return undefined
      const last = replay().document.messages.findLast((message) => message.type === "assistant")
      const content = last?.type === "assistant" ? last.content : []
      const status = timelineStatus({ content })

      // The thought the model is writing says Thinking in its own row, in place of Working.
      if (status === "working" && timelineThinking(detail(), content)) return undefined

      return statusLabels[status]
    })

    const projection = createNextTimelineProjection({
      sessionMessages: () => replay().document.messages,
      status: () => replay().document.status,
      timelineDetail: detail,
    })

    // Where the New timeline's status line sits: the space its next row would take, as the app computes it.
    const laneSpacing = createMemo(() => {
      const active = projection.activeMessageID()

      return active ? laneGap(projection.rows(), active, projection.messageByID()) : undefined
    })

    // As in the app: a shell or subagent call still running in the step the agent is on blocks the turn.
    const blocking = createMemo(() => {
      if (!busy()) return false
      const last = replay().document.messages.findLast((message) => message.type === "assistant")

      return (
        last?.type === "assistant" &&
        last.time.completed === undefined &&
        last.content.some(
          (part) =>
            part.type === "tool" &&
            part.state.status === "running" &&
            (part.name === "shell" || part.name === "subagent"),
        )
      )
    })

    const collapsed = createMemo(() => {
      if (!busy()) return false
      const last = replay().document.messages.findLast((message) => message.type === "assistant")

      return !nextStatus() && timelineThinking(detail(), last?.type === "assistant" ? last.content : [])
    })

    const next = (side: "base" | "head") => (side === "head" ? state.next : state.baseNext)

    const frames = new Map<Side, HTMLIFrameElement>()

    const send = (side: Side) =>
      frames.get(side)?.contentWindow?.postMessage(
        {
          type: "timeline-compare:render",
          document: replay().document,
          detail: detail(),
          activity: next(side),
          turnDiffs: state.turnDiffs,
          width: state.width,
          status: next(side) ? nextStatus() : busy() ? "Working" : undefined,
          lane: next(side) ? "activity" : "legacy",
          collapsed: next(side) && collapsed(),
          spacing: next(side) ? laneSpacing() : undefined,
          hint: blocking(),
          hintDelay: next(side) ? 300 : 0,
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
        event.source === frames.get("base")?.contentWindow
          ? "base"
          : event.source === frames.get("head")?.contentWindow
            ? "head"
            : undefined

      if (!side) return

      if (event.data?.type === "timeline-compare:ready") return send(side)

      if (event.data?.type !== "timeline-compare:scroll") return
      frames
        .get(side === "base" ? "head" : "base")
        ?.contentWindow?.postMessage(
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

    const src = (page: string) => `${page}?id=timeline-compare-renderer--renderer&globals=theme:${state.theme}`

    const frame = (side: Side, origin: string, style?: JSX.CSSProperties) => (
      <Show when={state.theme} keyed>
        {(_) => (
          <iframe
            ref={(element) => frames.set(side, element)}
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
            options={presetIDs}
            value={state.preset}
            onChange={(preset) => setState("preset", preset)}
          />
          <Show when={other}>
            <Check
              label={`New timeline (${headLabel})`}
              checked={state.next}
              onChange={(next) => setState("next", next)}
            />
            <Check
              label={`New timeline (${baseLabel})`}
              checked={state.baseNext}
              onChange={(next) => setState("baseNext", next)}
            />
          </Show>
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
          when={state.view === "side"}
          fallback={
            <div class="relative min-h-0 flex-1">
              {frame("base", base)}
              {frame(
                "head",
                self,
                state.view === "swipe" ? { "clip-path": `inset(0 0 0 ${state.mix}%)` } : { opacity: state.mix / 100 },
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
                  ["base", base],
                  ["head", self],
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
