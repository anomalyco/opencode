import { DateTime } from "luxon"
import type { Session } from "@opencode-ai/sdk/v2/client"

export type SessionNodeProps = {
  session: Session
  active?: boolean
  onClick: () => void
}

export function SessionNode(props: SessionNodeProps) {
  const title = () => props.session.title || "Untitled"
  const relativeTime = () => DateTime.fromMillis(props.session.time.updated).toRelative()

  return (
    <div
      class={`min-w-0 cursor-pointer rounded px-2 py-1 transition-colors ${
        props.active ? "bg-surface-raised-base-hover" : "hover:bg-surface-raised-base-hover/50"
      }`}
      onClick={props.onClick}
      title={`${title()}\n${relativeTime()}`}
    >
      <span class="block truncate text-13-regular text-text-standard">{title()}</span>
      <span class="block truncate text-12-regular text-text-weak">{relativeTime()}</span>
    </div>
  )
}
