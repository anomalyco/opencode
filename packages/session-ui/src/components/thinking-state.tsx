import { Collapsible } from "@opencode/ui/collapsible"
import { useI18n } from "@opencode/ui/context/i18n"
import { TextReveal } from "@opencode/ui/text-reveal"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createEffect, createMemo, onCleanup, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { formatThinkingDuration, thinkingElapsedMs } from "./thinking-duration"

const TICK_MS = 500

function ThinkingSparkle() {
  return (
    <span data-slot="thinking-state-sparkle" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
      </svg>
    </span>
  )
}

export function ThinkingState(props: {
  streaming: boolean
  createdAt?: number
  completedAt?: number
  heading?: string
  steps?: number
  open?: boolean
  defaultOpen?: boolean
  hideDetails?: boolean
  onOpenChange?: (open: boolean) => void
  children?: JSX.Element
}) {
  const i18n = useI18n()
  const mountedAt = Date.now()
  const [state, setState] = createStore<{ open?: boolean; now: number }>({
    now: mountedAt,
  })
  const open = () => props.open ?? state.open ?? props.defaultOpen ?? false
  const hasDetails = () => !props.hideDetails

  createEffect(() => {
    if (!props.streaming) return
    setState("now", Date.now())
    const timer = setInterval(() => setState("now", Date.now()), TICK_MS)
    onCleanup(() => clearInterval(timer))
  })

  const elapsedMs = createMemo(() =>
    thinkingElapsedMs({
      streaming: props.streaming,
      createdAt: props.createdAt,
      completedAt: props.completedAt,
      now: state.now,
      fallbackStart: mountedAt,
    }),
  )

  const durationLabel = createMemo(() => {
    const ms = elapsedMs()
    if (ms === undefined) return undefined
    const formatted = formatThinkingDuration(ms, i18n.locale())
    if (formatted.kind === "seconds") return i18n.t("ui.message.duration.seconds", { count: formatted.count })
    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: formatted.minutes,
      seconds: formatted.seconds,
    })
  })

  const title = createMemo(() => {
    if (props.streaming) return i18n.t("ui.sessionTurn.status.thinking")
    const duration = durationLabel()
    if (!duration) return i18n.t("ui.message.thought")
    return i18n.t("ui.message.thoughtFor", { duration })
  })

  const setOpen = (value: boolean) => {
    if (props.open === undefined) setState("open", value)
    props.onOpenChange?.(value)
  }

  return (
    <Collapsible
      class="thinking-state-collapsible"
      open={open()}
      onOpenChange={hasDetails() ? setOpen : undefined}
      data-streaming={props.streaming ? "true" : "false"}
    >
      <Collapsible.Trigger data-hide-details={hasDetails() ? undefined : "true"}>
        <div data-component="thinking-state-trigger" data-hide-details={hasDetails() ? undefined : "true"}>
          <div data-slot="thinking-state-trigger-main">
            <ThinkingSparkle />
            <div data-slot="basic-tool-tool-info-structured">
              <div data-slot="basic-tool-tool-info-main">
                <span data-slot="basic-tool-tool-title" role="status">
                  <TextShimmer text={title()} active={props.streaming} />
                </span>
                <Show when={props.streaming && durationLabel() !== undefined}>
                  <span data-slot="basic-tool-tool-subtitle" data-kind="duration">
                    {durationLabel()}
                  </span>
                </Show>
                <Show when={props.steps}>
                  {(steps) => (
                    <span data-slot="basic-tool-tool-subtitle" data-kind="steps">
                      {i18n.plural("ui.message.stepCount", steps())}
                    </span>
                  )}
                </Show>
                <Show when={props.streaming && !open() && !!props.heading}>
                  <span data-slot="basic-tool-tool-subtitle">
                    <TextReveal text={props.heading} />
                  </span>
                </Show>
              </div>
            </div>
          </div>
          <Show when={hasDetails()}>
            <Collapsible.Arrow />
          </Show>
        </div>
      </Collapsible.Trigger>
      <Show when={hasDetails()}>
        <Collapsible.Content>
          <div data-slot="thinking-state-content">{props.children}</div>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  )
}
