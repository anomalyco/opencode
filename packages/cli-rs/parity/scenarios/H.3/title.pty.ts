// The TUI on home against an empty server sets the title to "OpenCode" (`packages/tui/src/app.tsx:644`)
// and resets it when it exits. The server answers the TUI's startup reads with the TUI test defaults.
// Both sides run (E.1 sets the title in Rust). Only the OSC log is compared: the home's cells are P-APP's
// (`E.1/home`), and here the TS screen adds the DevTools bar of the local channel.
import { definePty } from "../../pty/run"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  server: { fallback: "tui" },
  steps: [
    // The title can come before the first paint, so wait for the logo as well.
    { until: { osc: "OpenCode", screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "\x03", settle: 300 },
    { keys: "\x03" },
  ],
  exits: true,
})
