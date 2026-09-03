import { createMemo, Show } from "solid-js"
import { Card } from "@opencode-ai/ui/card"
import { Icon } from "@opencode-ai/ui/icon"

export function SessionErrorMessage(props: { message: string }) {
  const content = createMemo(() => {
    const separator = props.message.indexOf(":")
    if (separator === -1) return { detail: props.message }
    return {
      title: props.message.slice(0, separator + 1),
      detail: props.message.slice(separator + 1),
    }
  })
  return (
    <>
      <Show when={content().title}>{(title) => <strong class="font-[530]">{title()}</strong>}</Show>
      {content().detail}
    </>
  )
}

export function SessionError(props: { message: string }) {
  return (
    <Card variant="error" class="error-card" data-kind="session-error-card">
      <div class="flex w-full min-w-0 items-center gap-2">
        <Icon name="outline-hexagonal-warning" class="shrink-0 text-v2-state-fg-danger" />
        <div class="min-w-0">
          <SessionErrorMessage message={props.message} />
        </div>
      </div>
    </Card>
  )
}
