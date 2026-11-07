import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js"
import { useI18n } from "@opencode/ui/context/i18n"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"

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

export function createToolElapsed(
  time: Accessor<SessionMessageAssistantTool["time"] | undefined>,
  running: Accessor<boolean>,
) {
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (time()?.ran === undefined || time()?.completed !== undefined || !running()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  return createMemo(() => {
    const start = time()?.ran
    const end = time()?.completed ?? (running() ? now() : undefined)

    if (start === undefined || end === undefined) return undefined

    return Math.max(0, end - start)
  })
}

export function ToolElapsed(props: { time?: SessionMessageAssistantTool["time"]; running?: boolean }) {
  const i18n = useI18n()

  const elapsed = createToolElapsed(
    () => props.time,
    () => props.running ?? false,
  )

  const text = () => {
    const seconds = Math.floor((elapsed() ?? 0) / 1000)

    return seconds < 60
      ? i18n.t("ui.message.duration.seconds", { count: seconds })
      : i18n.t("ui.message.duration.minutesSeconds", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
  }

  return (
    <Show when={elapsed() !== undefined}>
      <span data-slot="tool-elapsed" class="shrink-0 text-text-weak whitespace-nowrap">
        {text()}
      </span>
    </Show>
  )
}
