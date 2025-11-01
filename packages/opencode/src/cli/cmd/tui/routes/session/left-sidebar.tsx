import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "@tui/context/sync"
import { Locale } from "@/util/locale"
import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"

export function LeftSidebar(props: {
  sessionID: string
  onToggle: () => void
  onSelect: (sessionID: string) => void
  onSwitch: () => void
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const renderer = useRenderer()

  const sessions = createMemo(() => sync.data.session)
  const currentSession = createMemo(() => sync.session.get(props.sessionID)!)

  return (
    <Show when={currentSession()}>
      <box flexShrink={0} gap={1} width={28}>
        <box flexDirection="row" justifyContent="space-between" paddingRight={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            SESSIONS
          </text>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              props.onToggle()
            }}
          >
            ◀
          </text>
        </box>

        <box>
          <text>
            <b>Current:</b>
          </text>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            {Locale.truncate(Locale.stripMarkdown(currentSession().title), 24)}
          </text>
        </box>

        <box>
          <text>
            <b>All Sessions</b>
          </text>
          <For each={sessions()}>
            {(session) => (
              <text
                fg={session.id === props.sessionID ? theme.accent : theme.text}
                attributes={session.id === props.sessionID ? TextAttributes.BOLD : undefined}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  if (session.id === props.sessionID) return
                  props.onSelect(session.id)
                }}
              >
                {session.id === props.sessionID ? "▶ " : "  "}
                {Locale.truncate(Locale.stripMarkdown(session.title), 22)}
              </text>
            )}
          </For>
        </box>

        <box marginTop={1}>
          <text
            fg={theme.accent}
            attributes={TextAttributes.BOLD}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              props.onSwitch()
            }}
          >
            Switch Session
          </text>
        </box>
      </box>
    </Show>
  )
}
