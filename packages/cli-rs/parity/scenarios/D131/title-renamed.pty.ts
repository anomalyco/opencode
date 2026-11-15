// D131: a session the home prompt creates takes the title the server generates. The tab, the sidebar and the
// terminal title follow `session.renamed`, and the exit summary names the session by it.
import { definePty } from "../../pty/run"
import { config, masks, server } from "./session"

export default definePty({
  args: [],
  cols: 120,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  server: server("README.md onboarding token"),
  steps: [
    { until: { screen: "Demo Model" }, settle: 500, timeout: 30_000 },
    { keys: "hello", until: { screen: "hello" }, settle: 200 },
    { keys: "\r", until: { osc: "OC | README.md onboarding token" }, settle: 500, checkpoint: "renamed" },
    { keys: "\x03", settle: 300 },
    { keys: "\x03" },
    { until: { screen: "Continue" }, settle: 300, checkpoint: "epilogue", timeout: 10_000 },
  ],
  // The `renamed` step waits for both to set the generated title. TS sets a title again on every change to the
  // session, the same one too; Rust sends only a change, so the logs are not compared.
  osc: [],
  masks,
  exits: true,
})
