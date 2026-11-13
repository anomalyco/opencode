// `restart` (synthesis 4.14, P4c): a native plugin segfaults in a render. The client dies; its parent restores the
// terminal and starts it again on the same session, with the draft typed before the crash and one notice, and the
// plugin stays disabled. Rust only: see `fault.ts`.
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
    { keys: "keep this draft", until: { screen: "keep this draft" }, settle: 300, checkpoint: "before" },
    ...palette("Fault in render: segv"),
    // The new client: the session, the draft, the notice, and no line of the plugin.
    {
      until: { screen: /Plugin failed: example\.fault[\s\S]*keep this draft|keep this draft[\s\S]*Plugin failed/ },
      settle: 500,
      checkpoint: "restarted",
      timeout: 20_000,
    },
    { keys: "\x10", until: { screen: "Search commands" }, settle: 300 },
    { keys: "plugins", settle: 300 },
    { keys: "\r", until: { screen: "example.fault" }, settle: 500, checkpoint: "manager" },
  ],
  osc: [],
})
