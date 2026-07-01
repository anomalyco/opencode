import { For } from "solid-js"
import { useTheme } from "../../context/theme"
import { useGrid } from "../../context/grid"
import { useSync } from "../../context/sync"
import { useProject } from "../../context/project"
import { useSDK } from "../../context/sdk"
import { useWorkspaceClients } from "../../context/workspace-clients"
import { useToast } from "../../ui/toast"
import { useRoute } from "../../context/route"
import { createGridSession } from "./grid-create"

/**
 * Cell tab bar for the grid view. Renders one tab per cell with the session
 * label, a mode badge (plan-only vs full), and a close button ("×"). The
 * active cell is highlighted. A "+" button at the end creates a fresh
 * session via the SDK and adds it to the grid (Phase 8) instead of the
 * pre-Phase-8 "navigate to home" behaviour.
 */
export function GridToolbar() {
  const grid = useGrid()
  const { theme } = useTheme()
  const sync = useSync()
  const project = useProject()
  const sdk = useSDK()
  const workspaceClients = useWorkspaceClients()
  const toast = useToast()
  const route = useRoute()
  const cells = () => grid.cells
  const activeId = () => grid.activeCellId

  const addNewCell = () => void createGridSession({ grid, sdk, project, sync, workspaceClients, toast, route })

  return (
    <box
      flexDirection="row"
      height={3}
      backgroundColor={theme.backgroundPanel}
      border={["bottom"]}
      borderColor={theme.border}
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row">
        <For each={cells()}>
          {(cell) => {
            const isActive = cell.id === activeId()
            const session = () => sync.session.get(cell.sessionID)
            const label = () => cell.label || session()?.title || "cell"
            return (
              <box
                flexDirection="row"
                alignItems="center"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isActive ? theme.background : theme.backgroundElement}
                border={["left", "right"]}
                borderColor={isActive ? theme.borderActive : theme.border}
                marginRight={1}
                onMouseUp={() => grid.setActive(cell.id)}
              >
                <text fg={theme.textMuted}>{cell.mode === "plan-only" ? "📋" : "💬"}</text>
                <text fg={isActive ? theme.text : theme.textMuted} marginLeft={1} wrapMode="none">
                  {label()}
                </text>
                <box
                  marginLeft={1}
                  onMouseUp={(evt) => {
                    evt.stopPropagation()
                    grid.removeCell(cell.id)
                  }}
                >
                  <text fg={isActive ? theme.textMuted : theme.textMuted}>×</text>
                </box>
              </box>
            )
          }}
        </For>
      </box>

      {/* "+" button to create a new cell — Phase 8: directly create a session
          via SDK and add it to the grid. Replaces the pre-Phase-8 behaviour of
          navigating to home, which left the user stranded outside the grid. */}
      <box onMouseUp={addNewCell} paddingLeft={1} paddingRight={1}>
        <text fg={theme.textMuted}>+</text>
      </box>

      <box flexGrow={1} />
    </box>
  )
}
