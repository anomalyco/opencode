// A plugin sets the terminal title (P0b, TS `renderer.setTerminalTitle`, Rust `Host::set_title`): on home the TUI
// sets "OpenCode", `/p0btitle` sets the plugin's title, and exiting clears it (TS `destroyRenderer`). Only the title
// OSC log is compared; the plugin's files are in fixture.ts.
import { definePty } from "../../pty/run"
import { install, steps } from "./fixture"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  server: { fallback: "tui" },
  setup: (root) => install(root),
  steps,
  osc: ["title"],
  exits: true,
})
