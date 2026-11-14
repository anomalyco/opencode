// `restart` (synthesis 4.5): a TERM sent to the parent alone reaches the client, which ends as it would with no
// parent (OpenTUI quits the app, with 0); the parent restarts nothing and exits with the client's code, and the
// shell's screen is back. Without the parent passing it on, the client would run on and the steps time out. Rust
// only: see `fault.ts`.
import { definePty } from "../../pty/run"
import { install, rust, server } from "./fault"

export default definePty({
  args: [],
  command: rust(["-s", "ses_b"]),
  cols: 100,
  rows: 30,
  server,
  setup: install,
  preface: "$ opencode-native -s ses_b\r\n",
  exits: true,
  steps: [
    { until: { screen: "fault plugin" }, settle: 500, timeout: 30_000 },
    { keys: "a draft", until: { screen: "a draft" }, settle: 300 },
    { signal: "SIGTERM", until: { screen: /^(?![\s\S]*fault plugin)[\s\S]*\$ opencode-native -s ses_b/ }, settle: 500 },
  ],
  osc: [],
  verify: ({ exit }) => (exit === 0 ? [] : [`the parent exited with ${exit}, not the client's 0`]),
})
