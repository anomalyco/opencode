// `restart` (synthesis 4.14, P4c): a native plugin hangs in a command. The frozen frame gets the watchdog's notice
// at 0.5 s; at 2 s the watchdog ends the client, and its parent starts it again on the same session, with the draft
// and one notice that names the hang. Rust only: see `fault.ts`.
import { definePty } from "../../pty/run"
import { install, palette, rust, server } from "./fault"

export default definePty({
  args: [],
  command: rust(["-s", "ses_b"]),
  cols: 100,
  rows: 30,
  server,
  setup: install,
  steps: [
    { until: { screen: "fault plugin" }, settle: 500, timeout: 30_000 },
    { keys: "keep this draft", until: { screen: "keep this draft" }, settle: 300 },
    ...palette("Fault: hang"),
    { until: { screen: "is not responding" }, checkpoint: "notice", timeout: 5_000 },
    // Typed into the frozen client: dropped, so it neither reaches the new one nor sends the draft.
    { keys: "lost\r" },
    {
      until: { screen: /hung the client in `run-command`[\s\S]*keep this draft|keep this draft[\s\S]*hung the client/ },
      settle: 500,
      checkpoint: "restarted",
      timeout: 20_000,
    },
  ],
  osc: [],
})
