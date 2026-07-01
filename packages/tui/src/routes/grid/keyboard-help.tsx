import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useGrid } from "../../context/grid"
import { useKeybind } from "../../context/keybind"
import { useDialog } from "../../ui/dialog"

interface HelpRow {
  action: string
  binding: string
}

/**
 * Phase 6: keyboard help dialog for the grid view.
 *
 * Lists every grid-specific keybind in a compact two-column table. The
 * dialog is intentionally self-contained: it doesn't take props, reads the
 * keybind store directly, and registers a single `escape` handler so it
 * composes with the parent `DialogProvider`.
 *
 * The component is rendered inside a `Dialog` (size `large`) and closes
 * itself when the user dismisses the dialog stack.
 */
export function GridKeyboardHelp() {
  const dialog = useDialog()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const grid = useGrid()

  const rows = createMemo<HelpRow[]>(() => [
    { action: "Next cell", binding: keybind.print("grid_next") },
    { action: "Previous cell", binding: keybind.print("grid_prev") },
    { action: "Switch to cell 1", binding: keybind.print("grid_cell_1") },
    { action: "Switch to cell 2", binding: keybind.print("grid_cell_2") },
    { action: "Switch to cell 3", binding: keybind.print("grid_cell_3") },
    { action: "Switch to cell 4", binding: keybind.print("grid_cell_4") },
    { action: "Switch to cell 5", binding: keybind.print("grid_cell_5") },
    { action: "Switch to cell 6", binding: keybind.print("grid_cell_6") },
    { action: "Switch to cell 7", binding: keybind.print("grid_cell_7") },
    { action: "Switch to cell 8", binding: keybind.print("grid_cell_8") },
    { action: "Switch to cell 9", binding: keybind.print("grid_cell_9") },
    { action: "Single cell mode", binding: keybind.print("grid_single") },
    { action: "Toggle layout (single / split-h / split-v)", binding: keybind.print("grid_layout_toggle") },
    { action: "Toggle plan-only mode", binding: keybind.print("grid_plan_mode") },
    { action: "Close active cell", binding: keybind.print("grid_close") },
    { action: "Create new cell", binding: keybind.print("grid_create") },
    { action: "Show this help", binding: keybind.print("grid_help") },
  ])

  const close = () => dialog.clear()

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Grid View — Keyboard
        </text>
        <text fg={theme.textMuted} onMouseUp={close}>
          esc / click ✕
        </text>
      </box>

      <box paddingBottom={1}>
        <text fg={theme.textMuted}>
          Layout: {grid.layout} · Cells: {grid.cells.length} · Active: #
          {grid.cells.findIndex((c) => c.id === grid.activeCellId) + 1}
        </text>
      </box>

      <Show when={rows().length > 0} fallback={<text fg={theme.textMuted}>No keybinds available for this view.</text>}>
        <For each={rows()}>
          {(row) => (
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.text}>{row.action}</text>
              <text fg={theme.textMuted}>{row.binding}</text>
            </box>
          )}
        </For>
      </Show>

      <box flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={close}>
          <text fg={theme.selectedListItemText}>Close</text>
        </box>
      </box>
    </box>
  )
}
