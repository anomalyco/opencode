import { Button } from "@opencode/ui/button"
import { Collapsible } from "@opencode/ui/collapsible"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Predicate } from "effect"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { BackgroundMoveHint } from "../../../../app/src/session/timeline/message-timeline"
import { createStore, reconcile } from "solid-js/store"
import type { SessionDocument } from "../../document"
import {
  codeModeDocument,
  codeModeMetadata,
  codeModeScenarios,
  codeModeSession,
  codeModeStates,
  type CodeModeScenario,
  type CodeModeState,
} from "../../storybook/codemode-snapshots"
import { CurrentSessionProviders } from "../../storybook/current-session-story"
import { timelinePresets, type TimelineDetail } from "../../timeline/detail"
import { Timeline, createReactiveTimelineProjection, type ReasoningMode } from "../../timeline/projection"
import { SessionTimeline } from "../../timeline/session-timeline"
import { createNextTimelineProjection } from "../projection"
import { laneGap } from "../spacing"
import { timelineStatus } from "../status"
import { StatusLane } from "../status-line"
import { NextSessionTimeline } from "./session-timeline"

/**
 * Code Mode `execute` parts captured from real runs, drawn by the real timelines at each state the client store held:
 * called, first progress, progress, each time the files list grew, and final. The last step is the whole session,
 * with what came after the call. Play steps through them once a second, as the live updates arrived.
 *
 * The controls live in the address: `?id=codemode-captured-states--captured&scenario=running&step=3&metadata=open`.
 * Left and right arrows step too.
 */
export default {
  title: "Code Mode/Captured states",
  id: "codemode-captured-states",
  parameters: { layout: "fullscreen" },
}

const timelines = [
  { id: "old", label: "Old" },
  { id: "new", label: "New" },
  { id: "both", label: "Side by side" },
] as const

const presetLabels = {
  everything: "Everything",
  detailed: "Detailed",
  compact: "Compact",
  quiet: "Quiet",
  "text-only": "Messages only",
} as const

// The control's default is a fixed 232px of equal segments, too narrow for these labels.
const segments = { width: "auto" }

const segment = { flex: "none" }

type Step = { label: string; file?: string; state: CodeModeState }

const names = codeModeScenarios.map((scenario) => scenario.name)

// Each state of the scenario's tool parts, then the whole session.
const steps = (name: CodeModeScenario): Step[] => {
  const states = codeModeStates(name)
  const calls = [...new Map(states.map((state) => [state.part.id, state.part.name])).entries()]

  // A session of several calls labels each state with its call, numbered where a tool runs more than once.
  const call = (state: CodeModeState) => {
    const named = calls.filter(([, tool]) => tool === state.part.name)

    if (named.length < 2) return state.part.name

    return `${state.part.name} ${named.findIndex(([id]) => id === state.part.id) + 1}`
  }

  return [
    ...states.map((state) => ({
      label: calls.length > 1 ? `${call(state)} · ${state.reason}` : state.reason,
      file: state.file,
      state,
    })),
    { label: "session end", state: states.at(-1)! },
  ]
}

export const Captured = {
  render: () => {
    const query = new URLSearchParams(location.search)

    const [state, setState] = createStore({
      scenario: names.find((name) => name === query.get("scenario")) ?? names[0],
      step: query.has("step") ? Number(query.get("step")) : Number.MAX_SAFE_INTEGER,
      timeline: timelines.find((item) => item.id === query.get("timeline"))?.id ?? timelines[2].id,
      preset: timelinePresets.find((item) => item.id === query.get("preset"))?.id ?? timelinePresets[1].id,
      playing: false,
      metadata: query.get("metadata") === "open",
    })

    const list = createMemo(() => steps(state.scenario))
    const index = createMemo(() => Math.max(0, Math.min(state.step, list().length - 1)))
    const step = createMemo(() => list()[index()]!)
    const last = () => index() === list().length - 1
    const detail = createMemo(() => timelinePresets.find((preset) => preset.id === state.preset)!.value)
    const session = createMemo(() => codeModeSession(state.scenario))

    // One document that the store reconciles, so each step updates the rows the way a live progress event does.
    const [view, setView] = createStore<{ document: SessionDocument }>({
      document: codeModeDocument(state.scenario, step().file, { now: Date.now() }),
    })

    createEffect(() =>
      setView("document", reconcile(codeModeDocument(state.scenario, step().file, { now: Date.now() }))),
    )

    createEffect(() => {
      const address = new URLSearchParams(location.search)

      address.set("scenario", state.scenario)
      address.set("step", String(index()))
      address.set("timeline", state.timeline)
      address.set("preset", state.preset)

      if (state.metadata) address.set("metadata", "open")
      else address.delete("metadata")

      history.replaceState(history.state, "", `?${address}`)
    })

    createEffect(() => {
      if (!state.playing) return

      const timer = setInterval(() => {
        if (last()) return setState("playing", false)
        setState("step", index() + 1)
      }, 1_000)

      onCleanup(() => clearInterval(timer))
    })

    const go = (next: number) => setState({ step: Math.max(0, Math.min(next, list().length - 1)), playing: false })

    const play = () => {
      if (state.playing) return setState("playing", false)
      setState({ step: last() ? 0 : index(), playing: true })
    }

    const pick = (scenario: CodeModeScenario) => setState({ scenario, step: Number.MAX_SAFE_INTEGER, playing: false })

    const keys = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return

      if (event.key === "ArrowRight") go(index() + 1)
      else if (event.key === "ArrowLeft") go(index() - 1)
      else return

      event.preventDefault()
    }

    onMount(() => window.addEventListener("keydown", keys))
    onCleanup(() => window.removeEventListener("keydown", keys))

    // As MessageTimeline lays out a session: rows the width of the session column, then the status lane below them.
    const pane = (next: boolean) => (
      <div class="w-full py-6 md:mx-auto md:max-w-session">
        <CurrentSessionProviders document={view.document} directory={session().directory}>
          <Show
            when={next}
            fallback={
              <SessionTimeline
                document={view.document}
                timelineDetail={detail()}
                turnDiffs={false}
                {...sessionTimelineSettings(detail())}
              />
            }
          >
            <NextSessionTimeline document={view.document} timelineDetail={detail()} />
          </Show>
        </CurrentSessionProviders>
        <SessionStatusLane document={view.document} timelineDetail={detail()} next={next} />
      </div>
    )

    return (
      <div class="flex h-screen min-h-0 bg-v2-background-bg-base text-v2-text-text-base">
        <nav
          aria-label="Scenario"
          class="flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-v2-border-border-base p-2"
        >
          <div class="px-2 pt-1 pb-2">
            <div class="text-14-medium">Code Mode</div>
            <div class="text-12-regular text-v2-text-text-muted">Captured on dev 7b8a065e29 and b6973f1b7b</div>
          </div>
          <For each={codeModeScenarios}>
            {(scenario) => (
              <button
                type="button"
                aria-current={state.scenario === scenario.name ? "true" : undefined}
                class="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-v2-overlay-simple-overlay-hover"
                classList={{ "bg-v2-background-bg-layer-02": state.scenario === scenario.name }}
                onClick={() => pick(scenario.name)}
              >
                <span class="font-mono text-13-regular">{scenario.name}</span>
                <span class="text-12-regular text-v2-text-text-muted">{scenario.description}</span>
              </button>
            )}
          </For>
        </nav>
        <div class="flex min-w-0 flex-1 flex-col">
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-v2-border-border-base px-4 py-2 text-13-regular">
            <Labeled label="Timeline">
              <SegmentedControl
                aria-label="Timeline"
                style={segments}
                value={state.timeline}
                onChange={(value) => {
                  const item = timelines.find((timeline) => timeline.id === value)

                  if (item) setState("timeline", item.id)
                }}
              >
                <For each={timelines}>
                  {(item) => (
                    <SegmentedControlItem value={item.id} style={segment}>
                      {item.label}
                    </SegmentedControlItem>
                  )}
                </For>
              </SegmentedControl>
            </Labeled>
            <Labeled label="Detail">
              <SegmentedControl
                aria-label="Detail"
                style={segments}
                value={state.preset}
                onChange={(value) => {
                  const preset = timelinePresets.find((item) => item.id === value)

                  if (preset) setState("preset", preset.id)
                }}
              >
                <For each={timelinePresets}>
                  {(preset) => (
                    <SegmentedControlItem value={preset.id} style={segment}>
                      {presetLabels[preset.id]}
                    </SegmentedControlItem>
                  )}
                </For>
              </SegmentedControl>
            </Labeled>
          </div>
          <div class="flex flex-col gap-2 border-b border-v2-border-border-base px-4 py-2">
            <div class="flex items-center gap-2">
              <Button
                size="small"
                variant="neutral"
                icon="chevron-left"
                aria-label="Previous state"
                disabled={index() === 0}
                onClick={() => go(index() - 1)}
              />
              <Button size="small" variant={state.playing ? "neutral" : "contrast"} class="w-16" onClick={play}>
                {state.playing ? "Pause" : "Play"}
              </Button>
              <Button
                size="small"
                variant="neutral"
                icon="chevron-right"
                aria-label="Next state"
                disabled={last()}
                onClick={() => go(index() + 1)}
              />
              <input
                type="range"
                aria-label="State"
                class="mx-2 min-w-0 flex-1"
                min="0"
                max={list().length - 1}
                value={index()}
                onInput={(event) => go(event.currentTarget.valueAsNumber)}
              />
              <span class="shrink-0 text-13-regular text-v2-text-text-muted tabular-nums">
                {index() + 1}/{list().length}
              </span>
            </div>
            <div class="flex flex-wrap gap-1">
              <For each={list()}>
                {(item, at) => (
                  <button
                    type="button"
                    aria-current={at() === index() ? "step" : undefined}
                    class="rounded-md border border-v2-border-border-base px-1.5 py-0.5 font-mono text-12-regular hover:bg-v2-overlay-simple-overlay-hover"
                    classList={{
                      "bg-v2-background-bg-layer-03 text-v2-text-text-base": at() === index(),
                      "text-v2-text-text-muted": at() !== index(),
                    }}
                    onClick={() => go(at())}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
            <Metadata
              state={step().state}
              file={step().file}
              open={state.metadata}
              onOpenChange={(open) => setState("metadata", open)}
            />
          </div>
          <Show
            when={state.timeline === "both"}
            fallback={
              <div class="min-h-0 flex-1 overflow-y-auto" data-scrollable>
                {pane(state.timeline === "new")}
              </div>
            }
          >
            <div class="grid min-h-0 flex-1 grid-cols-2 divide-x divide-v2-border-border-base">
              <For each={[false, true]}>
                {(next) => (
                  <div class="flex min-h-0 flex-col">
                    <div class="border-b border-v2-border-border-base px-4 py-1.5 text-12-medium text-v2-text-text-muted">
                      {next ? "New timeline" : "Old timeline"}
                    </div>
                    <div class="min-h-0 flex-1 overflow-y-auto" data-scrollable>
                      {pane(next)}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    )
  },
}

function Labeled(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-center gap-2">
      <span class="text-v2-text-text-muted">{props.label}</span>
      {props.children}
    </div>
  )
}

// The state's raw `metadata`, as the store held it, for checking what the timeline was given.
function Metadata(props: {
  state: CodeModeState
  file?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const part = () => props.state.part
  const metadata = createMemo(() => codeModeMetadata(part()))
  const calls = createMemo(() => metadata().toolCalls ?? [])
  const files = createMemo(() => metadata().files)

  const counts = createMemo(() =>
    [...new Set(calls().map((call) => call.status))]
      .map((status) => `${calls().filter((call) => call.status === status).length} ${status}`)
      .join(", "),
  )

  const flags = createMemo(() =>
    (["background", "jobID", "error", "truncated"] as const).flatMap((key) =>
      metadata()[key] === undefined ? [] : [`${key}: ${String(metadata()[key])}`],
    ),
  )

  const error = () => {
    const state = part().state

    return state.status === "error" ? JSON.stringify(state.error) : undefined
  }

  return (
    <Collapsible variant="ghost" open={props.open} onOpenChange={props.onOpenChange}>
      <Collapsible.Trigger class="flex w-full items-center gap-2 py-0.5 text-left text-12-regular text-v2-text-text-muted">
        <Collapsible.Arrow />
        <span class="text-12-medium text-v2-text-text-base">metadata</span>
        <span class="truncate font-mono">
          {part().name} · {part().state.status} · {calls().length} toolCalls · {files()?.length ?? "no"} files
          <For each={flags()}>{(flag) => <> · {flag}</>}</For>
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div class="grid max-h-56 grid-cols-[auto_1fr] gap-x-4 gap-y-1 overflow-y-auto py-1.5 font-mono text-12-regular">
          <span class="text-v2-text-text-muted">state</span>
          <span>{props.file ?? "session end (last state)"}</span>
          <span class="text-v2-text-text-muted">status</span>
          <span>
            {part().state.status}
            <Show when={error()}>{(text) => <> · {text()}</>}</Show>
          </span>
          <span class="text-v2-text-text-muted">toolCalls</span>
          <span>
            {calls().length}
            <Show when={counts()}>{(text) => <span class="text-v2-text-text-muted"> ({text()})</span>}</Show>
          </span>
          <span class="text-v2-text-text-muted">files</span>
          <div class="flex flex-col">
            <Show when={files()} fallback={<span class="text-v2-text-text-muted">absent</span>}>
              {(entries) => (
                <Show when={entries().length > 0} fallback={<span class="text-v2-text-text-muted">[]</span>}>
                  <For each={entries()}>
                    {(entry) => (
                      <span>
                        {entry.file} <span class="text-v2-text-text-muted">{entry.status}</span>
                        <Show when={entry.additions !== undefined || entry.deletions !== undefined}>
                          {" "}
                          +{entry.additions ?? 0} −{entry.deletions ?? 0}
                        </Show>
                        <Show when={!entry.patch}>
                          <span class="text-v2-text-text-faint"> no patch</span>
                        </Show>
                      </span>
                    )}
                  </For>
                </Show>
              )}
            </Show>
          </div>
          <Show when={flags().length > 0}>
            <span class="text-v2-text-text-muted">flags</span>
            <span>{flags().join(" · ")}</span>
          </Show>
        </div>
      </Collapsible.Content>
    </Collapsible>
  )
}

const padding = "px-4 md:px-6"

const statusLabels = {
  waitingApproval: "Waiting for approval",
  waitingAnswer: "Waiting for your answer",
  waitingShell: "Waiting for shell",
  working: "Working",
} as const

/** The old timeline's settings as the app's timeline controller derives them from the detail setting. */
function sessionTimelineSettings(detail: TimelineDetail) {
  const reasoningMode: ReasoningMode =
    detail.thinking.placement === "hidden" ? "hidden" : detail.thinking.details === "expanded" ? "full" : "compact"

  return {
    reasoningMode,
    shellToolDefaultOpen: detail.shell.details === "expanded",
    editToolDefaultOpen: detail.edit.details === "expanded",
  }
}

/**
 * The line below a working turn, as `MessageTimeline` in the app draws it at the bottom of the timeline: the New
 * timeline's status lane spaced like the turn's next row, or the old 36px lane, each with Working when the app shows
 * it and the offer to move a blocking call to the background. A story session has no permissions, questions, queued
 * input or background tasks, so those cases are left out.
 */
function SessionStatusLane(props: { document: SessionDocument; timelineDetail: TimelineDetail; next: boolean }) {
  const input = {
    sessionMessages: () => props.document.messages,
    status: () => props.document.status,
    timelineDetail: () => props.timelineDetail,
    turnDiffs: () => false,
  }

  const settings = () => sessionTimelineSettings(props.timelineDetail)

  const projection = props.next
    ? createNextTimelineProjection(input)
    : createReactiveTimelineProjection({
        ...input,
        reasoningMode: () => settings().reasoningMode,
        shellToolDefaultOpen: () => settings().shellToolDefaultOpen,
        editToolDefaultOpen: () => settings().editToolDefaultOpen,
      })

  const busy = () => props.document.status.type === "busy"

  const assistant = () => {
    const active = projection.activeMessageID()

    return active ? projection.assistantMessagesByParent().get(active)?.at(-1) : undefined
  }

  const laneSpacing = createMemo(() => {
    const active = projection.activeMessageID()

    return props.next && active ? laneGap(projection.rows(), active, projection.messageByID()) : undefined
  })

  // MessageTimeline's showWorking, the old timeline's Working.
  const showWorking = createMemo(() => {
    if (!busy()) return false
    const active = projection.activeMessageID()

    if (!active) return false
    const last = assistant()

    if (last?.retry || last?.error) return false
    const content = last?.content.at(-1)

    if (
      last?.time.completed === undefined &&
      last?.time.streamed === undefined &&
      content?.type === "text" &&
      content.text.trim()
    )
      return false

    return !projection.rows().some((row) => {
      if (row.userMessageID !== active) return false

      if (Predicate.isTagged(row, "Thinking")) return true

      if (Predicate.isTagged(row, "Notice")) {
        const message = projection.messageByID().get(row.messageID)

        return message?.type === "compaction" && message.status === "running"
      }

      if (!Predicate.isTagged(row, "AssistantPart")) return false

      if (row.group.type === "context" && projection.lastAssistantGroupKey().get(active) === row.group.key)
        return row.group.refs.every(
          (ref) =>
            Timeline.resolveContent(projection.messageByID().get(ref.messageID), ref.partID)?.type === "reasoning",
        )

      if (row.group.type === "context" || row.group.type === "read") return false

      return (row.group.type === "part" ? [row.group.ref] : row.group.refs).some((ref) => {
        const content = Timeline.resolveContent(projection.messageByID().get(ref.messageID), ref.partID)

        return content?.type === "tool" && (content.state.status === "streaming" || content.state.status === "running")
      })
    })
  })

  const nextStatus = createMemo(() =>
    busy() && projection.activeMessageID() ? timelineStatus({ content: assistant()?.content ?? [] }) : undefined,
  )

  const liveThought = createMemo(() =>
    projection
      .rows()
      .some((row) => Predicate.isTagged(row, "Thinking") && row.userMessageID === projection.activeMessageID()),
  )

  const working = () => {
    if (!props.next) return showWorking()
    const status = nextStatus()

    return !!status && (status !== "working" || !liveThought())
  }

  // The app offers the move for a foreground shell, subagent or Code Mode script, which its background service
  // reports as blocking; the New timeline waits until the call has run for 300ms.
  const blocking = createMemo(() => {
    if (!busy()) return
    const last = assistant()

    return last?.content.findLast(
      (part): part is Extract<typeof part, { type: "tool" }> =>
        part.type === "tool" && part.state.status === "running" && ["shell", "subagent", "execute"].includes(part.name),
    )
  })

  const [hint, setHint] = createSignal(false)

  createEffect(() => {
    const part = blocking()

    if (!part) return setHint(false)

    const wait = props.next ? Math.max(0, (part.time.ran ?? part.time.created) + 300 - Date.now()) : 0
    const timer = setTimeout(() => setHint(true), wait)

    onCleanup(() => clearTimeout(timer))
  })

  const move = () => (
    <Show when={hint()}>
      <div data-component="session-background-hint-row">
        <BackgroundMoveHint keybind={["Ctrl", "B"]} />
      </div>
    </Show>
  )

  return (
    <div class="w-full min-w-0 max-w-full md:mx-auto md:max-w-session">
      <Show
        when={props.next}
        fallback={
          <div class={`flex h-9 items-center gap-2 pt-3 text-[13px] font-[530] leading-text-compact ${padding}`}>
            <Show when={showWorking()}>
              <div data-component="session-working" role="status">
                <TextShimmer text="Working" active />
              </div>
            </Show>
            {move()}
          </div>
        }
      >
        <StatusLane
          class={padding}
          spacing={laneSpacing()}
          label={working() ? statusLabels[nextStatus() ?? "working"] : undefined}
          collapsed={liveThought() && !working() && !hint()}
        >
          {move()}
        </StatusLane>
      </Show>
    </div>
  )
}
