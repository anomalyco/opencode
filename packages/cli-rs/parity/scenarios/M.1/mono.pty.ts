// `mini.mono = true`: the replayed transcript in ASCII (`>` prompts, `[O]` header, ` - ` separators).
import { definePty } from "../../pty/run"
import { config, server } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 16,
  server: server(),
  setup: (root) => config(root, { mono: true }),
  steps: [
    { until: { screen: "Third answer" }, settle: 600, timeout: 30_000, checkpoint: "mono", scrollback: 16 },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [{ pattern: /^Build - model - demo( - ctrl\+p menu)?$/, reason: "the ctrl+p menu hint is M.3's" }],
})
