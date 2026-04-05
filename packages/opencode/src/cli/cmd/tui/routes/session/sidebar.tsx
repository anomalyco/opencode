import { useSync } from "@tui/context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { Installation } from "@/installation"
import { TuiPluginRuntime } from "../../plugin"
import { Locale } from "@/util/locale"

import { getScrollAcceleration } from "../../util/scroll"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const metrics = createMemo(() => {
    const msgs = sync.data.message[props.sessionID] ?? []
    let totalOutput = 0
    let totalTime = 0

    for (const msg of msgs) {
      if (msg.role !== "assistant") continue
      if (!msg.time.completed) continue
      const out = msg.tokens.output
      if (out <= 0) continue
      const user = msgs.find((x) => x.role === "user" && x.id === msg.parentID)
      if (!user) continue
      const dur = msg.time.completed - user.time.created
      if (dur <= 0) continue
      totalOutput += out
      totalTime += dur
    }

    if (totalOutput <= 0 || totalTime <= 0) return
    return {
      tps: Locale.tokensPerSec(totalOutput, totalTime),
      tokens: totalOutput,
    }
  })

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <TuiPluginRuntime.Slot
              name="sidebar_title"
              mode="single_winner"
              session_id={props.sessionID}
              title={session()!.title}
              share_url={session()!.share?.url}
            >
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>{session()!.title}</b>
                </text>
                <Show when={session()!.share?.url}>
                  <text fg={theme.textMuted}>{session()!.share!.url}</text>
                </Show>
              </box>
            </TuiPluginRuntime.Slot>
            <Show when={metrics()}>
              {(m) => (
                <text fg={theme.textMuted} paddingRight={1}>
                  {m().tps}
                  <span> · </span>
                  {Locale.number(m().tokens)} tokens
                </text>
              )}
            </Show>
            <TuiPluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <TuiPluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>•</span> <b>Open</b>
              <span style={{ fg: theme.text }}>
                <b>Code</b>
              </span>{" "}
              <span>{Installation.VERSION}</span>
            </text>
          </TuiPluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}
