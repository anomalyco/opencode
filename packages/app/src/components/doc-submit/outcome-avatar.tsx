import { Show } from "solid-js"
import { avatarLabel } from "./avatar-label"
import { actorColor } from "./actor-color"

type Role = "requester" | "agreed" | "rejected" | "timeout" | "left"

type Props = {
  name: string
  role: Role
  compact?: boolean
}

const map: Record<
  Role,
  { ring: string; chip: string; chipBg: string; chipFg: string; muted: boolean; glow: boolean }
> = {
  requester: {
    ring: "var(--ds-helmet)",
    chip: "요청자",
    chipBg: "rgba(255, 206, 43, 0.18)",
    chipFg: "#fff",
    muted: false,
    glow: false,
  },
  agreed: {
    ring: "var(--ds-mint)",
    chip: "동의",
    chipBg: "#ffffff",
    chipFg: "var(--ds-mint)",
    muted: false,
    glow: false,
  },
  rejected: {
    ring: "var(--ds-safety)",
    chip: "거절",
    chipBg: "#ffffff",
    chipFg: "#c44a00",
    muted: false,
    glow: true,
  },
  timeout: {
    ring: "rgba(255,255,255,0.35)",
    chip: "응답 없음",
    chipBg: "rgba(255,255,255,0.10)",
    chipFg: "rgba(255,255,255,0.6)",
    muted: true,
    glow: false,
  },
  left: {
    ring: "var(--ds-safety)",
    chip: "나감",
    chipBg: "#ffffff",
    chipFg: "#c44a00",
    muted: false,
    glow: true,
  },
}

export function OutcomeAvatar(props: Props) {
  const style = () => map[props.role]
  const color = () => actorColor(props.name)
  const size = () => (props.compact ? 32 : 40)
  const fs = () => (props.compact ? 11 : 13)

  return (
    <div class="ds-outcome" classList={{ "ds-outcome--muted": style().muted }}>
      <div
        class="ds-outcome__circle"
        classList={{ "ds-outcome__circle--glow": style().glow }}
        style={{
          width: `${size()}px`,
          height: `${size()}px`,
          "font-size": `${fs()}px`,
          background: color().background,
          color: color().foreground,
          "border-color": style().ring,
        }}
      >
        {avatarLabel(props.name)}
      </div>
      <Show when={!props.compact}>
        <div class="ds-outcome__name">{props.name}</div>
      </Show>
      <span class="ds-outcome__chip" style={{ background: style().chipBg, color: style().chipFg }}>
        {style().chip}
      </span>
    </div>
  )
}
