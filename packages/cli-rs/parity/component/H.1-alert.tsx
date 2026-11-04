/** @jsxImportSource @opentui/solid */
// P-COMP fixture for the TUI's DialogAlert (packages/tui/src/ui/dialog-alert.tsx), dark opencode theme.
import { DialogAlert } from "../../../tui/src/ui/dialog-alert"
import { renderComponent } from "../lib/component"

await renderComponent({
  fixture: "H.1/alert",
  width: 60,
  height: 12,
  dialog: () => <DialogAlert title="Heads up" message="The session was compacted." />,
  ready: (frame) => frame.includes("compacted"),
})
