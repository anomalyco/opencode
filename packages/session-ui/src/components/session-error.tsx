import { createMemo, Show } from "solid-js"
import { Card } from "@opencode/ui/card"
import { Icon } from "@opencode/ui/icon"
import { LinkedText } from "./linked-text"

export function SessionErrorMessage(props: { message: string; links?: boolean }) {
  const content = createMemo(() => {
    // The colon of a URL scheme does not end a title.
    const separator = props.message.search(/:(?!\/\/)/)

    if (separator === -1) return { detail: props.message }

    return {
      title: props.message.slice(0, separator + 1),
      detail: props.message.slice(separator + 1),
    }
  })

  return (
    <>
      <Show when={content().title}>{(title) => <strong class="font-[530]">{title()}</strong>}</Show>
      <Show when={props.links} fallback={content().detail}>
        <LinkedText text={content().detail} />
      </Show>
    </>
  )
}

export function SessionError(props: { message: string }) {
  return (
    <Card variant="error" class="error-card" data-kind="session-error-card">
      <div class="flex w-full min-w-0 items-start gap-2">
        <Icon name="outline-hexagonal-warning" class="shrink-0 text-v2-state-fg-danger" />
        <div class="min-w-0">
          <SessionErrorMessage message={props.message} links />
        </div>
      </div>
    </Card>
  )
}
