import type { SessionMessageCompaction } from "@opencode/client/promise"
import { Card } from "@opencode/ui/card"
import { useI18n } from "@opencode/ui/context/i18n"
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import { BasicTool } from "../components/basic-tool"
import { LinkedText } from "../components/linked-text"
import { useData } from "../context"
import {
  createCompactionEntranceState,
  DISPOSED_COMPACTION_ENTRANCE_EVENT,
  GRACE_ELAPSED_EVENT,
  selectCompactionEnter,
  transitionCompactionEntrance,
  type CompactionEntranceEffect,
  type CompactionEntranceEvent,
} from "../message/compaction-entrance-machine"
import { PacedMarkdown } from "../message/message-content"
import { Separator } from "./separator"

/** A compaction the server admitted but has not started, drawn as the divider a started one opens with. */
export function CompactionQueued() {
  const i18n = useI18n()

  return (
    <div data-component="session-compaction-message">
      <Separator label={i18n.t("ui.messagePart.compaction.queued")} />
    </div>
  )
}

/**
 * A compaction, drawn with the timeline's own dividers: as tall as their text, with a plain line, spaced like the rows
 * around them. An automatic one with background compaction on is one quiet divider instead.
 */
export function CompactionMessage(props: { message: SessionMessageCompaction; error: string }) {
  const i18n = useI18n()
  const data = useData()
  const summary = () => (props.message.status === "failed" ? "" : props.message.summary)

  const error = () => {
    if (props.message.status !== "failed") return ""

    if (props.message.error.type === "aborted" || props.message.error.type === "compaction.interrupted") return ""

    return props.error
  }

  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  // Usage of the compaction request itself; the resulting context size only shows on the next assistant step.
  const usage = () => {
    if (props.message.status === "running" || !props.message.tokens) return ""
    const tokens = props.message.tokens
    const input = tokens.input + tokens.cache.read + tokens.cache.write
    const output = tokens.output + tokens.reasoning

    if (input + output <= 0) return ""

    return i18n.t("ui.messagePart.compaction.usage", {
      input: compact().format(input),
      output: compact().format(output),
    })
  }

  const outcome = () => {
    if (props.message.status !== "failed")
      return props.message.status === "completed" && props.message.native?.messages
        ? "ui.messagePart.providerCompaction"
        : "ui.messagePart.compaction"

    if (props.message.error.type === "aborted") return "ui.messagePart.compaction.cancelled"

    if (props.message.error.type === "compaction.interrupted") return "ui.messagePart.compaction.interrupted"

    return "ui.messagePart.compaction.failed"
  }

  const label = createMemo(() => [i18n.t(outcome()), usage()].filter(Boolean).join(" · "))

  return (
    <Show
      when={!data.backgroundCompaction || props.message.reason === "manual" || props.message.status === "failed"}
      fallback={
        <QuietCompaction
          id={props.message.id}
          created={props.message.time.created}
          running={props.message.status === "running"}
          summary={summary()}
          usage={usage()}
        />
      }
    >
      <div data-component="session-compaction-message" class="flex flex-col gap-[var(--timeline-gap-m)]">
        <Separator label={i18n.t("ui.messagePart.compaction.started")} />
        <Show when={summary().trim()}>
          <div data-component="text-part" data-timeline-part-id={props.message.id}>
            <div data-slot="text-part-body">
              <PacedMarkdown
                text={summary()}
                cacheKey={props.message.id}
                streaming={props.message.status === "running"}
              />
            </div>
          </div>
        </Show>
        <Show when={props.message.status === "running"}>
          <div role="status">
            <BasicTool
              icon="archive"
              trigger={{ title: i18n.t("ui.messagePart.compaction.running") }}
              status="running"
              locked
              hideDetails
            />
          </div>
        </Show>
        <Show when={props.message.status !== "running"}>
          <Separator label={label()} />
        </Show>
        <Show when={error()}>
          <Card variant="error" class="error-card">
            <LinkedText text={error()} />
          </Card>
        </Show>
      </div>
    </Show>
  )
}

/**
 * An automatic compaction, drawn as one divider that reads Compacting, then Compacted. Its height never changes, and
 * clicking it opens the summary.
 */
function QuietCompaction(props: { id: string; created: number; running: boolean; summary: string; usage: string }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  // A new one waits out the grace before showing Compacting; one that ends inside it, as a precomputed summary does,
  // only fades in as Compacted. One already running or finished when the history loads shows without an entrance.
  const initial = createCompactionEntranceState({ ageMs: Date.now() - props.created, running: props.running })
  const [entrance, setEntrance] = createSignal(initial.state)
  const enter = createMemo(() => selectCompactionEnter(entrance()))
  let graceTimer: ReturnType<typeof setTimeout> | undefined

  const runEntrance = (effect: CompactionEntranceEffect) => {
    clearTimeout(graceTimer)
    graceTimer = undefined

    if (effect.type === "schedule-grace")
      graceTimer = setTimeout(() => dispatchEntrance(GRACE_ELAPSED_EVENT), effect.delayMs)
  }

  const dispatchEntrance = (event: CompactionEntranceEvent) => {
    const result = transitionCompactionEntrance(untrack(entrance), event)
    setEntrance(result.state)
    result.effects.forEach(runEntrance)
  }

  initial.effects.forEach(runEntrance)
  createEffect(() => dispatchEntrance({ type: "running.changed", running: props.running }))
  onCleanup(() => dispatchEntrance(DISPOSED_COMPACTION_ENTRANCE_EVENT))

  const expandable = () => !props.running && !!props.summary.trim()

  const label = createMemo(() =>
    splitEnding(i18n.t("ui.messagePart.compaction.running"), i18n.t("ui.messagePart.compaction.done")),
  )

  return (
    <div
      data-component="session-compaction-message"
      data-quiet=""
      data-enter={enter()}
      class="flex flex-col gap-[var(--timeline-gap-m)]"
    >
      <button
        type="button"
        data-slot="session-compaction-divider"
        data-state={props.running ? "running" : "done"}
        class="flex h-4 w-full items-center gap-3 text-v2-text-text-faint"
        disabled={!expandable()}
        aria-busy={props.running}
        aria-expanded={expandable() ? open() : undefined}
        aria-controls={expandable() && open() ? `${props.id}-summary` : undefined}
        aria-label={props.running ? label().running : label().done}
        onClick={() => setOpen((value) => !value)}
      >
        <span data-slot="session-compaction-line" data-side="start" class="h-px min-w-0 flex-1">
          <span data-slot="session-compaction-light" />
        </span>
        <span
          data-slot="session-compaction-label"
          class="relative flex shrink-0 whitespace-nowrap text-[13px] font-[440] leading-text-compact tracking-[-0.04px]"
        >
          <span>{label().stem}</span>
          <span data-slot="session-compaction-ending" class="grid justify-items-start">
            <span data-slot="session-compaction-running">{label().ending.running}</span>
            <span data-slot="session-compaction-done">{label().ending.done}</span>
          </span>
          <span data-slot="session-compaction-glint" aria-hidden="true">
            <span data-slot="session-compaction-glint-stem">{label().stem}</span>
            <span data-slot="session-compaction-glint-ending">{label().ending.running}</span>
          </span>
        </span>
        <span data-slot="session-compaction-line" data-side="end" class="h-px min-w-0 flex-1">
          <span data-slot="session-compaction-light" />
        </span>
      </button>
      <Show when={expandable() && open()}>
        <div id={`${props.id}-summary`} data-slot="session-compaction-summary">
          <div data-component="text-part" data-timeline-part-id={props.id}>
            <div data-slot="text-part-body">
              <PacedMarkdown text={props.summary} cacheKey={props.id} streaming={false} />
            </div>
          </div>
          <Show when={props.usage}>
            <div class="mt-2 text-[13px] leading-text-compact text-v2-text-text-faint tabular-nums">{props.usage}</div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/** Splits Compacting and Compacted at their shared stem, so only the ending changes when the compaction ends. */
function splitEnding(running: string, done: string) {
  const chars = [...running]
  const others = [...done]
  const at = chars.findIndex((char, index) => char !== others[index])
  const stem = chars.slice(0, at === -1 ? chars.length : at).join("")

  return { running, done, stem, ending: { running: running.slice(stem.length), done: done.slice(stem.length) } }
}
