import { createMemo, Show } from "solid-js"
import { useI18n, type UiI18n } from "@opencode/ui/context/i18n"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { createToolElapsed } from "@opencode/ui/hooks"

/**
 * The moment a live timer should count from. Displayed content can predate the newest user prompt:
 * a follow-up sent while the previous turn still streams leaves the old reasoning on screen until
 * the new turn produces its own. Counting from the prompt keeps a seconds-old follow-up from
 * reading minutes old, and the new content taking over later lands within milliseconds of the
 * same anchor instead of jumping the clock backwards.
 */
export function anchorElapsedStart(created: number, messages: Iterable<SessionMessageInfo>) {
  let start = created

  for (const message of messages) {
    if (message.type === "user" && message.time.created > start) start = message.time.created
  }

  return start
}

/** One duration format for every elapsed row, including the hours branch a long run needs. */
export function formatElapsed(ms: number, i18n: UiI18n) {
  const numfmt = new Intl.NumberFormat(i18n.locale())

  const total = Math.max(0, Math.floor(ms / 1000))

  if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt.format(total) })

  if (total < 3600)
    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt.format(Math.floor(total / 60)),
      seconds: numfmt.format(total % 60),
    })

  return i18n.t("ui.message.duration.hoursMinutes", {
    hours: numfmt.format(Math.floor(total / 3600)),
    minutes: numfmt.format(Math.floor(total / 60) % 60),
  })
}

export function ToolElapsed(props: { time?: SessionMessageAssistantTool["time"]; running?: boolean }) {
  const i18n = useI18n()

  const elapsed = createToolElapsed(
    () => props.time,
    () => props.running ?? false,
  )

  const text = createMemo(() => {
    const value = elapsed()

    return value === undefined ? undefined : formatElapsed(value, i18n)
  })

  return (
    <Show when={elapsed() !== undefined}>
      {/* The tick redraws every second, so it stays out of the row's accessible name instead of renaming it. */}
      <span data-slot="tool-elapsed" class="shrink-0 text-text-weak whitespace-nowrap" aria-hidden="true">
        {text()}
      </span>
    </Show>
  )
}
