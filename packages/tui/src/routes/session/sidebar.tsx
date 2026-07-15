import { useData } from "../../context/data"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useConfig } from "../../config"
import { usePluginRuntime } from "../../plugin/runtime"
import { PluginSlot } from "../../plugin/context"

import { getScrollAcceleration } from "../../util/scroll"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const data = useData()
  const { themeV2 } = useTheme().contextual("elevated")
  const config = useConfig().data
  const session = createMemo(() => data.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))

  return (
    <Show when={session()}>
      <box
        backgroundColor={themeV2.background()}
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
              backgroundColor: themeV2.background(),
              foregroundColor: themeV2.scrollbar(),
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <pluginRuntime.Slot
              name="sidebar_title"
              mode="single_winner"
              session_id={props.sessionID}
              title={session()!.title}
            >
              <box paddingRight={1}>
                <text fg={themeV2.text()}>
                  <b>{session()!.title}</b>
                </text>
                <Show when={session()!.location.workspaceID}>
                  <text fg={themeV2.text.subdued()}>{session()!.location.workspaceID}</text>
                </Show>
              </box>
            </pluginRuntime.Slot>
            <PluginSlot name="sidebar.content" input={{ sessionID: props.sessionID }} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <PluginSlot name="sidebar.footer" />
        </box>
      </box>
    </Show>
  )
}
