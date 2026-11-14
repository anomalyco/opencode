// `restart` under job control (synthesis 4.5): in an interactive shell, Ctrl+Z stops the client and its parent
// together and the shell takes the terminal; `fg` continues both, once, and the client draws again. A crash after that
// still restarts it with the draft, and the restarted client suspends and continues too. Rust only: see `fault.ts`.
import { definePty } from "../../pty/run"
import { install, palette, server, shellLine } from "./fault"

export default definePty({
  args: [],
  command: (_side, url) => [
    "env",
    `OC_LINE=${shellLine(["-s", "ses_b"], url)}`,
    "PS1=$ ",
    "bash",
    "--norc",
    "--noprofile",
    "-i",
  ],
  cols: 100,
  rows: 30,
  server,
  setup: install,
  steps: [
    { keys: 'ulimit -c 0; eval "$OC_LINE"\r', until: { screen: "fault plugin" }, settle: 500, timeout: 30_000 },
    { keys: "\x1a", until: { screen: /Stopped/ }, settle: 500, checkpoint: "stopped" },
    { keys: "fg\r", until: { screen: /^(?![\s\S]*Stopped)[\s\S]*fault plugin/ }, settle: 1_000 },
    { keys: "keep this draft", until: { screen: "keep this draft" }, settle: 300 },
    ...palette("Fault in render: segv"),
    {
      until: { screen: /^(?![\s\S]*fault plugin)(?=[\s\S]*crashed the client)[\s\S]*keep this draft/ },
      settle: 500,
      timeout: 20_000,
    },
    { keys: "\x1a", until: { screen: /Stopped/ }, settle: 500 },
    { keys: "fg\r", until: { screen: /^(?![\s\S]*Stopped)[\s\S]*keep this draft/ }, settle: 1_000, checkpoint: "continued" },
  ],
  osc: [],
})
