import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, For, Show, createSignal } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"
import { useRoute } from "../../context/route"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"

export function Sidebar(props: { sessionID?: string; overlay?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const { navigate } = useRoute()
  const session = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const hasSession = () => !!session()

  const allSessions = createMemo(() => {
    const currentWorkspace = project.workspace.current()
    return sync.data.session
      .filter((s) => s.workspaceID === currentWorkspace && !s.parentID)
      .toSorted((a, b) => b.time.created - a.time.created)
      .slice(0, 50)
  })

  return (
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
        <box flexDirection="column" flexShrink={0} gap={1} paddingRight={1}>
          <Show when={hasSession()}>
            <pluginRuntime.Slot
              name="sidebar_title"
              mode="single_winner"
              session_id={props.sessionID ?? ""}
              title={session()!.title}
              share_url={session()!.share?.url}
            >
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>{session()!.title}</b>
                </text>
                <Show when={InstallationChannel !== "latest"}>
                  <text fg={theme.textMuted}>{props.sessionID}</text>
                </Show>
                <Show when={session()!.workspaceID}>
                  <text fg={theme.textMuted}>
                    <Show
                      when={workspace()}
                      fallback={<WorkspaceLabel type="unknown" name={session()!.workspaceID!} status="error" icon />}
                    >
                      {(item) => (
                        <WorkspaceLabel
                          type={item().type}
                          name={item().name}
                          status={project.workspace.status(item().id) ?? "error"}
                          icon
                        />
                      )}
                    </Show>
                  </text>
                </Show>
                <Show when={session()!.share?.url}>
                  <text fg={theme.textMuted}>{session()!.share!.url}</text>
                </Show>
              </box>
            </pluginRuntime.Slot>
            <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID ?? ""} />
          </Show>

          <Show when={allSessions().length > 0}>
            <box height={1} />
            <text fg={theme.textMuted}>
              <b>Session History</b>
            </text>
            <box height={1} />
            <For each={allSessions()}>
              {(s) => {
                const [hover, setHover] = createSignal(false)
                const isActive = s.id === props.sessionID
                return (
                  <box
                    onMouseOver={() => setHover(true)}
                    onMouseOut={() => setHover(false)}
                    onMouseUp={() => navigate({ type: "session", sessionID: s.id })}
                    paddingLeft={1}
                    backgroundColor={hover() || isActive ? theme.backgroundElement : undefined}
                  >
                    <text fg={isActive ? theme.accent : theme.text}>
                      {s.title || "Untitled"}
                    </text>
                  </box>
                )
              }}
            </For>
          </Show>
        </box>
      </scrollbox>

      <box flexShrink={0} gap={1} paddingTop={1}>
        <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID ?? ""}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>Open</b>
            <span style={{ fg: theme.text }}>
              <b>Code</b>
            </span>{" "}
            <span>{InstallationVersion}</span>
          </text>
        </pluginRuntime.Slot>
      </box>
    </box>
  )
}
