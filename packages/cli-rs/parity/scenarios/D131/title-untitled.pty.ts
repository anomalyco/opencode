// D131: a session the home prompt creates and the server never titles. The tab shows the fallback title, as in TS;
// the exit summary names it "New session" where TS prints an
// empty title (D131-epilogue-untitled).
import { definePty } from "../../pty/run"
import { config, masks, server } from "./session"

export default definePty({
  args: [],
  cols: 120,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  server: server(),
  steps: [
    { until: { screen: "Demo Model" }, settle: 500, timeout: 30_000 },
    { keys: "hello", until: { screen: "hello" }, settle: 200 },
    // The tab reads "New session", the new tab's title, before the timestamped default.
    { keys: "\r", until: { screen: /New session +\+/ }, settle: 500, checkpoint: "untitled" },
    // Ctrl+C on the empty prompt exits. A second press is not needed: a screen that holds still cannot tell it from an
    // exit that has not drawn yet, and once the terminal is restored the press is a SIGINT.
    {
      keys: "\x03",
      until: { screen: "Continue" },
      settle: 300,
      checkpoint: "epilogue",
      deviation: { file: "D131-epilogue-untitled", lines: 1 },
      timeout: 10_000,
    },
  ],
  // TS sets "OpenCode" again as the session opens; Rust sends only a change (title-renamed).
  osc: [],
  masks,
  exits: true,
})
