// A file mention long enough to wrap over three rows. Up from its end moves before the mention (OpenTUI #2104, on
// both sides since 0.9.4). A typed key shows where the cursor is.
import { definePty } from "../../pty/run"
import { home, homeMasks } from "./home"

// No `/`: `homeMasks` masks a line from its first `/`.
const file = "long_".repeat(32) + "file.ts"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  server: {
    ...home.server,
    routes: [{ path: "/api/fs/find", json: { location: { directory: "/tmp" }, data: [{ path: file, type: "file" }] } }],
  },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "@file", until: { screen: "file.ts" }, settle: 600, checkpoint: "listed" },
    { keys: "\r", settle: 400, checkpoint: "picked" },
    // Left over the space after the mention.
    { keys: "\x1b[D", settle: 300 },
    { keys: "\x1b[A", settle: 300, checkpoint: "up" },
    { keys: "X", settle: 400, checkpoint: "up-typed" },
  ],
  cursor: true,
  masks: homeMasks,
})
