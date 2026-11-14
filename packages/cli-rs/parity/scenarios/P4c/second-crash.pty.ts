// `restart`, the second-crash rule (synthesis 4.5): a crash on a plugin's own thread names nobody, so the client
// restarts with the plugin still enabled and says so. A second such crash within 10 minutes restarts it with every
// external plugin off. Rust only: see `fault.ts`.
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
    ...palette("Fault on a thread: segv"),
    {
      until: { screen: /opencode-native restarted[\s\S]*fault plugin/ },
      settle: 500,
      checkpoint: "first",
      timeout: 20_000,
    },
    { keys: "\x1b", settle: 300 },
    ...palette("Fault on a thread: segv"),
    {
      until: { screen: /^(?![\s\S]*fault plugin)[\s\S]*opencode-native crashed twice/ },
      settle: 500,
      checkpoint: "second",
      timeout: 20_000,
    },
  ],
  osc: [],
})
