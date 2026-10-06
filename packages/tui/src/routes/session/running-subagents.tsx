import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { createMemo, For, Show } from "solid-js"
import { Spinner } from "../../component/spinner"
import { useRoute } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"

export function runningSubagents(
  sessions: ReadonlyArray<Session>,
  status: Record<string, SessionStatus | undefined>,
  parentID: string,
) {
  return sessions
    .filter((session) => session.parentID === parentID && status[session.id] && status[session.id]?.type !== "idle")
    .toSorted((a, b) => a.time.created - b.time.created)
    .map((session) => ({ id: session.id, title: session.title.replace(/ \(@[\w-]+ subagent\)$/, "") }))
}

export function RunningSubagents(props: { sessionID: string }) {
  const sync = useSync()
  const route = useRoute()
  const { theme } = useTheme()
  const list = createMemo(() => runningSubagents(sync.data.session, sync.data.session_status, props.sessionID))
  const open = (sessionID: string) => route.navigate({ type: "session", sessionID })

  return (
    <Show when={list().length > 0}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <Show
          when={list().length <= 2}
          fallback={
            <box onMouseUp={() => open(list()[0].id)}>
              <Spinner>{list().length} subagents</Spinner>
            </box>
          }
        >
          <For each={list()}>
            {(item) => (
              <box onMouseUp={() => open(item.id)}>
                <Spinner color={theme.textMuted}>{Locale.truncate(item.title, 20)}</Spinner>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}
