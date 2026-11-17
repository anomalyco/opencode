import { createMemo, createSignal, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useData } from "../../context/data"
import { useLocal } from "../../context/local"
import { useTheme } from "../../context/theme"
import { Keymap } from "../../context/keymap"
import { Locale } from "../../util/locale"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"

// A subagent's session view looks like any other, so this line above its prompt says where you are and how to leave.
export function SubagentStatus(props: { sessionID: string; parentID: string; width: number; onBack: () => void }) {
  const data = useData()
  const local = useLocal()
  const theme = useTheme()
  const shortcuts = Keymap.useShortcuts()
  const [hovered, setHovered] = createSignal(false)

  const session = createMemo(() => data.session.get(props.sessionID))
  const parent = createMemo(() => data.session.get(props.parentID))
  const agent = createMemo(() => session()?.agent)
  const title = createMemo(() => {
    const current = session()
    return current ? withTimestampedFallback(current) : ""
  })
  const parentTitle = createMemo(() => {
    const current = parent()
    return current ? withTimestampedFallback(current) : "Main session"
  })
  const wide = createMemo(() => props.width >= 80)
  // Reads "esc" like the prompt's interrupt hint.
  const key = createMemo(() => {
    const shortcut = shortcuts.get("session.parent")
    return !shortcut || shortcut === "escape" ? "esc" : shortcut
  })

  return (
    <box id="subagent-status" flexDirection="row" flexShrink={0} paddingLeft={3} paddingRight={1}>
      <Show when={wide()}>
        <text fg={theme.text.muted} wrapMode="none" truncate flexShrink={1} minWidth={0}>
          {parentTitle()}
        </text>
        <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
          {" › "}
        </text>
      </Show>
      {/* The agent keeps its name whole; the titles around it give way first. */}
      <text wrapMode="none" flexShrink={0}>
        <span style={{ fg: agent() ? local.agent.color(agent()!) : theme.text.base, attributes: TextAttributes.BOLD }}>
          {Locale.titlecase(agent() ?? "subagent")}
        </span>
        <span style={{ fg: theme.text.base }}> subagent</span>
      </text>
      <Show when={title()}>
        <text fg={theme.text.muted} wrapMode="none" truncate flexShrink={1} minWidth={0}>
          {` · ${title()}`}
        </text>
      </Show>
      <box flexGrow={1} minWidth={2} />
      <box
        id="subagent-status-back"
        flexShrink={0}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={props.onBack}
      >
        <text wrapMode="none">
          <span style={{ fg: theme.text.base, attributes: TextAttributes.BOLD }}>{key()}</span>
          <span style={{ fg: hovered() ? theme.text.action.secondary.hovered : theme.text.action.secondary.base }}>
            {wide() ? " main session" : " back"}
          </span>
        </text>
      </box>
    </box>
  )
}
