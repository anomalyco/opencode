/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the system dialogs (E.18b): crates/tui/tests/system.rs opens the Rust dialogs over the whole
// TUI and compares the dialog panel.
import { DialogThemeList } from "../../../tui/src/component/dialog-theme-list"
import { renderComponent } from "../lib/component"

const themes = {
  width: 80,
  height: 30,
  dialog: () => <DialogThemeList />,
  ready: (f: string) => f.includes("esc"),
}
await renderComponent({ ...themes, fixture: "E.18b/themes" })
// One move previews the next theme, so the dialog draws in it.
await renderComponent({ ...themes, fixture: "E.18b/themes-down", act: (setup) => setup.mockInput.pressArrow("down") })
await renderComponent({ ...themes, fixture: "E.18b/themes-filter", act: (setup) => setup.mockInput.typeText("tokyo") })
