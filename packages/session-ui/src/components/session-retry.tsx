import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import type { SessionStatus } from "@bolt-ai/sdk/v2/client"
import { useI18n } from "@bolt-ai/ui/context/i18n"
import { Card } from "@bolt-ai/ui/card"
import { Tooltip } from "@bolt-ai/ui/tooltip"
import { Spinner } from "@bolt-ai/ui/spinner"

export function SessionRetry(props: { status: SessionStatus; show?: boolean }) {
  const i18n = useI18n()

  const retry = createMemo(() => {
    if (props.status.type !== "retry") return

    return props.status
  })

  const [seconds, setSeconds] = createSignal(0)
  createEffect(
    on(retry, (current) => {
      if (!current) return

      const update = () => {
        const next = retry()?.next

        if (!next) return
        setSeconds(Math.round((next - Date.now()) / 1000))
      }

      update()
      const timer = setInterval(update, 1000)
      onCleanup(() => clearInterval(timer))
    }),
  )

  const message = createMemo(() => {
    const current = retry()

    if (!current) return ""

    if (current.message.includes("exceeded your current quota") && current.message.includes("gemini")) {
      return i18n.t("ui.sessionTurn.retry.geminiHot")
    }

    if (current.message.length > 80) return current.message.slice(0, 80) + "…"

    return current.message
  })

  const info = createMemo(() => {
    const current = retry()

    if (!current) return ""
    const count = Math.max(0, seconds())

    if (count > 0) return i18n.plural("ui.sessionTurn.retry.attemptWaiting", count, { attempt: current.attempt })

    return i18n.t("ui.sessionTurn.retry.attemptRetryingNow", { attempt: current.attempt })
  })

  return (
    <Show when={retry() && (props.show ?? true)}>
      <div data-slot="session-turn-retry" class="w-full min-w-0">
        <Card variant="error" class="error-card" data-kind="session-retry-card">
          <div class="flex w-full items-start gap-2">
            <Icon name="outline-hexagonal-warning" class="shrink-0 text-v2-state-fg-danger" />
            <div class="min-w-0 flex-1">
              <Tooltip appearance="standard" value={retry()?.message ?? ""} placement="top">
                <div data-slot="session-turn-retry-message" class="cursor-help truncate">
                  <SessionErrorMessage message={message()} />
                </div>
              </Tooltip>
              <Show when={info()}>
                {(line) => (
                  <div data-slot="session-turn-retry-info">
                    <TextShimmer text={line()} active />
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Card>
      </div>
    </Show>
  )
}
