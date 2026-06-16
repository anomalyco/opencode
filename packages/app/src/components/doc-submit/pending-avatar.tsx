import { Show } from "solid-js"
import { avatarLabel } from "./avatar-label"

type Props = {
  name: string
  // Server-assigned hex color (same source as the doc cursor label / question dock avatar), so the
  // "동의 전송" avatar always matches the participant's collaborative color.
  color: string
  compact?: boolean
}

export function PendingAvatar(props: Props) {
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
          background: props.color,
          color: "#fff",
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
