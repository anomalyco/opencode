import { Show } from "solid-js"
import { avatarLabel } from "./avatar-label"
import { actorColor } from "./actor-color"

type Props = {
  name: string
  compact?: boolean
}

export function PendingAvatar(props: Props) {
  const color = () => actorColor(props.name)
  const size = () => (props.compact ? 32 : 40)
  const fs = () => (props.compact ? 11 : 12)

  return (
    <div class="ds-pending-avatar" title={`${props.name} · 응답 대기 중`}>
      <div
        class="ds-pending-avatar__circle"
        style={{
          width: `${size()}px`,
          height: `${size()}px`,
          "font-size": `${fs()}px`,
          background: color().background,
          color: color().foreground,
        }}
      >
        {avatarLabel(props.name)}
      </div>
      <Show when={!props.compact}>
        <div class="ds-pending-avatar__name">{props.name}</div>
      </Show>
    </div>
  )
}
