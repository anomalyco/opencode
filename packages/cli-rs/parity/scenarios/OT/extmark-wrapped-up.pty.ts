// OT2104 (parity/deviations/OT2104-chip-steps.md): a file mention long enough to wrap over three rows. Up from its
// end lands on the row above nearer the mention's end: TS stays at the end, Rust moves before the mention. A typed key
// shows where the cursor is: in TS it extends the mention's word, so the file list opens again; in Rust the three
// rows wrap one cell later.
import { definePty } from "../../pty/run"
import { home, homeMasks } from "./home"

const deviation = { file: "OT2104-chip-steps", lines: 5 }
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
    { keys: "\x1b[A", settle: 300, checkpoint: "up", deviation: { ...deviation, lines: 1 } },
    { keys: "X", settle: 400, checkpoint: "up-typed", deviation },
  ],
  cursor: true,
  masks: homeMasks,
})
