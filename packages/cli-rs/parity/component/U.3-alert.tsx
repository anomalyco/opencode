/** @jsxImportSource @opentui/solid */
// P-COMP fixture for DialogAlert (packages/tui/src/ui/dialog-alert.tsx): crates/ui/tests/all/dialogs.rs.
import { DialogAlert } from "../../../tui/src/ui/dialog-alert"
import { renderComponent } from "../lib/component"

await renderComponent({
  fixture: "U.3/alert",
  width: 60,
  height: 12,
  dialog: () => <DialogAlert title="Heads up" message="The session was compacted." />,
  ready: (frame) => frame.includes("compacted"),
})
