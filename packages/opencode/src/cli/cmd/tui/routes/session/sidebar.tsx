import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { Installation } from "@/installation"
import { TuiPluginRuntime } from "../../plugin"
import { SidekickChat } from "./sidekick"

export type SidebarTab = "plugins" | "sidekick"

export const [sidebarTab, setSidebarTab] = createSignal<SidebarTab>("plugins")

import { getScrollAcceleration } from "../../util/scroll"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

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
        <box flexShrink={0} flexDirection="row" gap={2} paddingBottom={1}>
          <box onMouseUp={() => setSidebarTab("plugins")}>
            <text fg={sidebarTab() === "plugins" ? theme.text : theme.textMuted}>
              <Show when={sidebarTab() === "plugins"} fallback={<b>Plugins</b>}>
                <b>
                  <u>Plugins</u>
                </b>
              </Show>
            </text>
          </box>
          <box onMouseUp={() => setSidebarTab("sidekick")}>
            <text fg={sidebarTab() === "sidekick" ? theme.text : theme.textMuted}>
              <Show when={sidebarTab() === "sidekick"} fallback={<b>Sidekick</b>}>
                <b>
                  <u>Sidekick</u>
                </b>
              </Show>
            </text>
          </box>
        </box>

        <Switch>
          <Match when={sidebarTab() === "plugins"}>
            <scrollbox
              flexGrow={1}
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
          </Match>

          <Match when={sidebarTab() === "sidekick"}>
            <SidekickChat parentID={props.sessionID} />
          </Match>
        </Switch>
      </box>
    </Show>
  )
}
