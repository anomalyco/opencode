import { For, Show } from "solid-js"
import { marks } from "~/i18n/rich"

/**
 * Copy with named runs (`[ for {{os}}](os)`, see `marks`), each named run in a span with the
 * data-slot that `slots` gives it, so translations can place the run anywhere in the string.
 */
export function Marked(props: { text: string; slots: Record<string, string> }) {
  return (
    <For each={marks(props.text)}>
      {(part) => (
        <Show when={part.mark && props.slots[part.mark]} fallback={part.text}>
          {(slot) => <span data-slot={slot()}>{part.text}</span>}
        </Show>
      )}
    </For>
  )
}
