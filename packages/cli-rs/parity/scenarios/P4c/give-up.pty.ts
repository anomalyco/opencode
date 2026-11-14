// `restart` (synthesis 4.5): three plugins crash the client within 60 s. The first two crashes restart it, each
// with the plugin that crashed held; the third ends the parent with the crash's code and a message, on the screen the
// shell had: the terminal is put back, though nothing restarts. Rust only: see `fault.ts`.
import { definePty } from "../../pty/run"
import { installThree, palette, rust, server } from "./fault"

export default definePty({
  args: [],
  command: rust(["-s", "ses_b"]),
  cols: 100,
  rows: 30,
  server,
  setup: installThree,
  preface: "$ opencode-native -s ses_b\r\n",
  exits: true,
  steps: [
    { until: { screen: "fault plugin c" }, settle: 500, timeout: 30_000 },
    ...palette("Fault in render: segv"),
    { until: { screen: /crashed the client in `render-slot`[\s\S]*fault plugin c/ }, settle: 500, timeout: 20_000 },
    { keys: "\x1b", settle: 300 },
    ...palette("Fault B in render: segv"),
    {
      until: { screen: /^(?![\s\S]*fault plugin b)(?=[\s\S]*example\.fault\.b)[\s\S]*fault plugin c/ },
      settle: 500,
      timeout: 20_000,
    },
    { keys: "\x1b", settle: 300 },
    ...palette("Fault C in render: segv"),
    {
      until: { screen: /\$ opencode-native -s ses_b[\s\S]*crashed 3 times in 60 s \(last in plugin example\.fault\.c\)/ },
      settle: 500,
      checkpoint: "gave up",
      timeout: 20_000,
    },
  ],
  osc: [],
  verify: ({ exit }) => (exit === 139 ? [] : [`the parent exited with ${exit}, not the crash's 139`]),
})
