/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the settings and experiments dialogs (packages/tui/src/component/dialog-config.tsx,
// dialog-experiments.tsx): crates/tui/tests/settings.rs. The harness has no config service, so a changed value is
// shown by starting from a config that already holds it.
import { DialogConfig } from "../../../tui/src/component/dialog-config"
import { DialogExperiments } from "../../../tui/src/component/dialog-experiments"
import { renderComponent } from "../lib/component"

const settings = { width: 80, height: 30, dialog: () => <DialogConfig />, ready: (f: string) => f.includes("esc") && f.includes("Scroll") }

await renderComponent({ ...settings, fixture: "E.18a/settings" })
await renderComponent({
  ...settings,
  fixture: "E.18a/settings-down",
  act: (setup) => {
    // Two moves: from the third on, the Rust select scrolls one step earlier than TS (U.3 follow-up).
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down")
  },
})
await renderComponent({
  ...settings,
  fixture: "E.18a/settings-filter",
  act: (setup) => setup.mockInput.typeText("scroll"),
})
await renderComponent({
  ...settings,
  fixture: "E.18a/settings-config",
  config: { animations: true, session: { sidebar: "hide" }, scroll: { speed: 2.5 }, leader: { timeout: 2250 } },
  act: (setup) => setup.mockInput.typeText("speed"),
})

const experiments = {
  width: 80,
  height: 24,
  dialog: () => <DialogExperiments />,
  ready: (f: string) => f.includes("Experiments"),
}
await renderComponent({ ...experiments, fixture: "E.18a/experiments" })
await renderComponent({
  ...experiments,
  fixture: "E.18a/experiments-on",
  config: { experimental: { "client-mcp": true } },
  act: (setup) => setup.mockInput.pressArrow("down"),
})
