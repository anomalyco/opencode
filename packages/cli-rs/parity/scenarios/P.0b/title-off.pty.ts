// A plugin sets the terminal title while `terminal.title` is off (P0b): the TUI sets no title of its own, the
// plugin's still shows, and exiting clears it, as TS's `destroyRenderer` clears the title whatever the setting. Only
// the title OSC log is compared; the plugin's files are in fixture.ts.
import { definePty } from "../../pty/run"
import { install, steps } from "./fixture"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  server: { fallback: "tui" },
  setup: (root) => install(root, { terminal: { title: false } }),
  steps,
  osc: ["title"],
  exits: true,
})
