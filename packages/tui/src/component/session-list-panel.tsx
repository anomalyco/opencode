import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { Locale } from "../util/locale"
import { Spinner } from "./spinner"
import { useTuiConfig } from "../config"
import { getScrollAcceleration } from "../util/scroll"

export function SessionListPanel(props: { sessionID: string }) {
  const { theme } = useTheme()
  const sync = useSync()
  const { navigate } = useRoute()
  const tuiConfig = useTuiConfig()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const sessions = createMemo(() => {
    return sync.data.session
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
  })

  const sessionCount = createMemo(() => sessions().length)

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={30}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
    >
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        <box paddingLeft={1} paddingRight={1} paddingBottom={1} flexShrink={0}>
          <text fg={theme.text}>
            <b>Sessions</b>
            <span style={{ fg: theme.textMuted }}> ({sessionCount()})</span>
          </text>
        </box>
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            paddingLeft: 1,
            visible: true,
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.border,
            },
          }}
        >
          <box gap={0} paddingRight={1} paddingLeft={1}>
            <For each={sessions()}>
              {(session) => {
                const isCurrent = session.id === props.sessionID
                const status = () => sync.data.session_status?.[session.id]
                const isWorking = () => status()?.type === "busy" || status()?.type === "retry"
                const isRetry = () => status()?.type === "retry"
                const color = () => {
                  if (isCurrent) return theme.accent
                  if (isRetry()) return theme.error
                  return theme.textMuted
                }
                const bg = () => (isCurrent ? theme.backgroundElement : undefined)

                return (
                  <box
                    flexShrink={0}
                    paddingTop={0}
                    paddingBottom={0}
                    paddingLeft={1}
                    paddingRight={1}
                    height={2}
                    backgroundColor={bg()}
                    flexDirection="row"
                    onMouseUp={() => {
                      if (session.id !== props.sessionID) {
                        navigate({ type: "session", sessionID: session.id })
                      }
                    }}
                  >
                    <Show when={isWorking()} fallback={<text fg={color()} flexShrink={0} width={2}>{"\u2022 "}</text>}>
                      <Spinner />
                    </Show>
                    <text fg={color()} wrapMode="none" flexGrow={1}>
                      {" "}{Locale.truncate(session.title, 20)}
                    </text>
                    <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
                      {Locale.todayTimeOrDateTime(session.time.updated)}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        </scrollbox>
        <box flexShrink={0} paddingTop={1}>
          <box
            paddingLeft={1}
            paddingRight={1}
            paddingTop={0}
            paddingBottom={0}
            onMouseUp={() => navigate({ type: "home" })}
          >
            <text fg={theme.accent}>+ New Session</text>
          </box>
        </box>
      </box>
    </box>
  )
}
