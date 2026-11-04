/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for DialogConfirm (packages/tui/src/ui/dialog-confirm.tsx): crates/ui/tests/dialogs.rs. The
// second one presses Left, which moves the legacy footer from Confirm to Cancel.
import { DialogConfirm } from "../../../tui/src/ui/dialog-confirm"
import { renderComponent } from "../lib/component"

const dialog = () => (
  <DialogConfirm title="Delete session" message="This permanently deletes the session." label={{ confirm: "delete" }} />
)
const ready = (frame: string) => frame.includes("permanently")

await renderComponent({ fixture: "U.3/confirm", width: 70, height: 16, dialog, ready })
await renderComponent({
  fixture: "U.3/confirm-left",
  width: 70,
  height: 16,
  dialog,
  ready,
  act: (setup) => setup.mockInput.pressArrow("left"),
})
