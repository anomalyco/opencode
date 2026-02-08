import { createMemo, For, Show } from "solid-js"
import type { CoordTeamSummary } from "@opencode-ai/sdk/v2"
import { useTheme } from "@tui/context/theme"

export function CoordWorkers(props: { summary: CoordTeamSummary | null }) {
  const { theme } = useTheme()
  const members = createMemo(() => props.summary?.team.members ?? [])
  const inbox = createMemo(() => props.summary?.inbox ?? [])
  const unreadFor = (name: string) => inbox().find((item) => item.name === name)?.unread ?? 0

  return (
    <box flexDirection="column" gap={1} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
      <Show
        when={props.summary}
        fallback={<text fg={theme.textMuted}>No workers yet.</text>}
      >
        <box flexDirection="column" gap={1}>
          <text fg={theme.text}>
            <b>{props.summary?.team.name}</b>
          </text>
          <Show when={props.summary?.team.description}>
            {(desc) => <text fg={theme.textMuted}>{desc()}</text>}
          </Show>
        </box>
        <For each={members()}>
          {(member) => (
            <box flexDirection="row" justifyContent="space-between">
              <box flexDirection="column">
                <text fg={theme.text}>{member.name}</text>
                <text fg={theme.textMuted}>{member.agentType}</text>
              </box>
              <Show when={unreadFor(member.name) > 0}>
                {(count) => <text fg={theme.warning}>● {count()}</text>}
              </Show>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}
