// Escape at the consent prompt: the red cancel line, exit 130, nothing written.
import { definePty } from "../../pty/run"
import { command } from "../../cli/client"
import { configFile, env, quote } from "../C.8/fixture"

// The command, its exit code, and then the config file: a refusal writes nothing.
const run = (side: "ts" | "rs") => [
  "sh",
  "-c",
  `${command(side, ["pair", "--remote"]).map(quote).join(" ")}; echo "exit $?"; cat ${quote("../" + configFile)} 2>&1 | sed 's/^cat: .*: /cat: /'`,
]

export default definePty({
  args: [],
  command: run,
  env,
  cols: 100,
  rows: 20,
  steps: [
    { until: { screen: "Expose your server to the internet?" }, settle: 300, timeout: 30_000 },
    { keys: "\x1b", until: { screen: "exit " }, settle: 300, checkpoint: "cancelled" },
  ],
  osc: [],
  exits: true,
})
