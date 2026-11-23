// D131: a generated title longer than 40 characters reaches the terminal title cut to 37 and an ellipsis.
import { definePty } from "../../pty/run"
import { config, masks, server } from "./session"

export default definePty({
  args: [],
  cols: 120,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  server: server("Investigate the flaky reconnect test on Windows runners"),
  steps: [
    { until: { screen: "Demo Model" }, settle: 500, timeout: 30_000 },
    { keys: "hello", until: { screen: "hello" }, settle: 200 },
    { keys: "\r", until: { osc: "OC | Investigate the flaky reconnect test …" }, settle: 500 },
  ],
  // As in title-renamed, TS sends the same title again on each change and Rust only a change: the logs differ.
  osc: [],
  masks,
})
