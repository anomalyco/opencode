// A plugin's title longer than the 4091 bytes OpenTUI takes (reviews bigboi-2, carbon-3): the TUI sends it cut on a
// character boundary and keeps running, instead of failing its terminal session and exiting. Rust only.
import { definePty } from "../../pty/run"
import { home, install, leave } from "./fixture"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  server: { fallback: "tui" },
  setup: (root) => install(root),
  steps: [
    ...home,
    { keys: "/p0blong", until: { screen: "Set a long title" }, settle: 300 },
    { keys: "\r", until: { osc: "p0b long éé" }, settle: 300 },
    { keys: "still here", until: { screen: "still here" }, settle: 300 },
    { keys: "\x15", settle: 200 },
    ...leave,
  ],
  osc: ["title"],
  exits: true,
  rsOnly: true,
})
