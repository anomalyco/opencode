import { useData } from "../../context/data"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useConfig } from "../../config"
import { PluginSlot } from "../../plugin/render"
import { withTimestampedFallback } from "@opencode-ai/util/session-title-fallback"

import { getScrollAcceleration } from "../../util/scroll"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const data = useData()
  const theme = useTheme("elevated")
  const config = useConfig().data
  const session = createMemo(() => data.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.background.default}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          ref={(scroll) => queueMicrotask(() => scroll.verticalScrollBar.resetVisibilityControl())}
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            visible: false,
            trackOptions: {
              backgroundColor: theme.background.default,
              foregroundColor: theme.scrollbar.default,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box paddingRight={1}>
              <text fg={theme.text.default}>
                <b>{withTimestampedFallback(session()!)}</b>
              </text>
              <Show when={session()!.location.workspaceID}>
                <text fg={theme.text.subdued}>{session()!.location.workspaceID}</text>
              </Show>
            </box>
            <PluginSlot name="sidebar.content" input={{ sessionID: props.sessionID }} mode="all" />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <PluginSlot name="sidebar.footer" input={{}} mode="replace" />
        </box>
      </box>
    </Show>
  )
}
