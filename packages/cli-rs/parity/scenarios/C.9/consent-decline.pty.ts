// `pair --remote` for the first time on a terminal: the warning and the consent prompt; N declines, says how to
// pair locally, and exits 0 without enabling remote access or recording consent.
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
    { until: { screen: "Expose your server to the internet?" }, settle: 300, checkpoint: "prompt", timeout: 30_000 },
    { keys: "n", until: { screen: "exit " }, settle: 300, checkpoint: "declined" },
  ],
  osc: [],
  exits: true,
})
