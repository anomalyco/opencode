import { createMemo, createSignal, For, Show } from "solid-js"
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

  const [displayLimit, setDisplayLimit] = createSignal(20)

  const allSessions = createMemo(() => {
    return sync.data.session
      .filter((x) => x.parentID === undefined)
      .filter((x) => {
        const title = x.title.toLowerCase()
        return !title.includes("clarifying") && 
               !title.includes("parsing") && 
               !title.includes("invalid input") &&
               !title.includes("discussing adsad") &&
               !title.startsWith("new session -")
      })
      .sort((a, b) => b.time.updated - a.time.updated)
  })

  const sessions = createMemo(() => allSessions().slice(0, displayLimit()))
  const hasMore = createMemo(() => allSessions().length > displayLimit())
  const currentSession = createMemo(() => sync.session.get(props.sessionID)!)

  return (
    <Show when={currentSession()}>
      <box flexShrink={0} gap={1} width={45}>
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

        <box overflow="hidden">
          <text wrapMode="none" attributes={TextAttributes.BOLD}>
            All Sessions
          </text>
          <For each={sessions()}>
            {(session) => (
              <text
                fg={session.id === props.sessionID ? theme.accent : theme.text}
                attributes={session.id === props.sessionID ? TextAttributes.BOLD : undefined}
                wrapMode="none"
                height={1}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  if (session.id === props.sessionID) return
                  props.onSelect(session.id)
                }}
              >
                {session.id === props.sessionID ? "▶ " : "  "}
                {Locale.truncate(Locale.stripMarkdown(session.title), 39)}
              </text>
            )}
          </For>
          <Show when={hasMore()}>
            <text
              fg={theme.textMuted}
              wrapMode="none"
              height={1}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                setDisplayLimit((prev) => prev + 20)
              }}
            >
              Load more... ({allSessions().length - displayLimit()} remaining)
            </text>
          </Show>
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
            New Session
          </text>
        </box>
      </box>
    </Show>
  )
}
