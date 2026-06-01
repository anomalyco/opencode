import { createMemo, For, Show } from "solid-js"
import { MoreIndicator } from "./more-indicator"
import { PendingAvatar } from "./pending-avatar"

const max = 5

type Item = { name: string }

type Props = {
  items: Item[]
}

export function PendingRow(props: Props) {
  const large = createMemo(() => props.items.length > 4)
  const size = createMemo(() => (large() ? 32 : 40))
  const more = createMemo(() => props.items.length > max)
  const slots = createMemo(() => (more() ? props.items.slice(0, max - 1) : props.items))
  const hidden = createMemo(() => props.items.length - slots().length)

  return (
    <div class="ds-pending-row" classList={{ "ds-pending-row--large": large() }}>
      <For each={slots()}>{(item) => <PendingAvatar name={item.name} compact={large()} />}</For>
      <Show when={more()}>
        <MoreIndicator size={size()} hidden={hidden()} />
      </Show>
    </div>
  )
}
