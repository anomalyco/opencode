import { For, Show, createMemo } from "solid-js"
import { useTheme } from "../../context/theme"
import { useGrid } from "../../context/grid"
import { useSync } from "../../context/sync"
import { useRoute } from "../../context/route"
import type { GridLayout } from "../../context/grid-persistence"
import { TextAttributes } from "@opentui/core"

/**
 * Grid management sidebar. Shows the cell list with workspace labels,
 * layout toggle buttons (single / split-h / split-v), and metadata for
 * the currently active cell (session title, workspace, agent).
 */
export function Sidebar() {
  const grid = useGrid()
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const cells = () => grid.cells
  const activeId = () => grid.activeCellId
  const layout = () => grid.layout
  const activeCell = () => grid.activeCell()

  const layouts = createMemo<{ key: GridLayout; label: string }[]>(() => [
    { key: "single", label: "⬜" },
    { key: "split-h", label: "◧" },
    { key: "split-v", label: "◪" },
    { key: "2x2", label: "田" },
  ])

  const availableSessions = createMemo(() => {
    const all = sync.data.session ?? []
    return all.filter((s: any) => !s.parentID && !s.time?.archived)
  })

  return (
    <box
      width={28}
      height="100%"
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.border}
      flexDirection="column"
      paddingTop={1}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="column" flexShrink={0}>
        {/* Layout toggles */}
        <box flexDirection="row" gap={1} marginBottom={1} flexShrink={0}>
          <For each={layouts()}>
            {(item) => (
              <box
                width={5}
                height={3}
                alignItems="center"
                justifyContent="center"
                backgroundColor={layout() === item.key ? theme.backgroundElement : undefined}
                border={["top", "bottom", "left", "right"]}
                borderColor={layout() === item.key ? theme.borderActive : theme.border}
                onMouseUp={() => grid.setLayout(item.key)}
              >
                <text fg={layout() === item.key ? theme.text : theme.textMuted} attributes={TextAttributes.BOLD}>
                  {item.label}
                </text>
              </box>
            )}
          </For>
        </box>

        {/* Cell list */}
        <box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          marginBottom={1}
          height={1}
          flexShrink={0}
        >
          <text fg={theme.textMuted}>Cells ({cells().length})</text>
          <box
            onMouseUp={() => route.navigate({ type: "home" })}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.backgroundElement}
            border={["left", "right"]}
            borderColor={theme.border}
          >
            <text fg={theme.text} wrapMode="none">
              Exit Grid
            </text>
          </box>
        </box>
        <box flexDirection="column" flexShrink={0}>
          <For each={cells()}>
            {(cell) => {
              const session = () => sync.session.get(cell.sessionID)
              const isActive = cell.id === activeId()
              return (
                <box
                  flexDirection="row"
                  alignItems="center"
                  paddingLeft={1}
                  backgroundColor={isActive ? theme.backgroundElement : undefined}
                  onMouseUp={() => grid.setActive(cell.id)}
                >
                  <text fg={isActive ? theme.text : theme.textMuted} wrapMode="none">
                    {cell.label || session()?.title || "Untitled"}
                  </text>
                  <text fg={theme.textMuted}>{cell.mode === "plan-only" ? " 📋" : " 💬"}</text>
                </box>
              )
            }}
          </For>
        </box>

        {/* Existing sessions — click to add to grid */}
        <box flexDirection="column" flexShrink={0} marginTop={1}>
          <text fg={theme.textMuted}>Sessions</text>
          <For each={availableSessions()}>
            {(session) => {
              const inGrid = cells().some((c) => c.sessionID === session.id)
              return (
                <Show when={!inGrid}>
                  <box
                    flexDirection="row"
                    alignItems="center"
                    paddingLeft={1}
                    onMouseUp={() => {
                      grid.addCell({
                        sessionID: session.id,
                        label: session.title,
                        workspaceID: session.workspaceID ?? "",
                        mode: "full",
                      })
                    }}
                  >
                    <text fg={theme.textMuted} wrapMode="none">
                      + {session.title}
                    </text>
                  </box>
                </Show>
              )
            }}
          </For>
        </box>

        {/* Active cell metadata */}
        <Show when={activeCell()}>
          {(ac) => (
            <>
              <text fg={theme.textMuted} marginTop={2}>
                Active Cell
              </text>
              <text fg={theme.textMuted}>
                Session: <span style={{ fg: theme.text }}>{sync.session.get(ac().sessionID)?.title ?? "—"}</span>
              </text>
              <text fg={theme.textMuted}>
                Workspace: <span style={{ fg: theme.text }}>{ac().workspaceID || "default"}</span>
              </text>
              <Show when={ac().agentID}>
                {(agentId) => (
                  <text fg={theme.textMuted}>
                    Agent: <span style={{ fg: theme.text }}>{agentId()}</span>
                  </text>
                )}
              </Show>
            </>
          )}
        </Show>
      </box>

      <box flexGrow={1} />
    </box>
  )
}
