// The status row names the model and provider from the catalog. The command menu's "Switch model" lists the
// catalog (opencode first, deprecated models left out); a pick names the new model, and the variant cycle steps
// through its variants. `/settings` lists mini's settings, and right on Verbosity saves the next preset.
import { definePty } from "../../pty/run"
import { catalog, config, leave } from "./fixture"
import { server } from "../M.2/fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 70,
  rows: 30,
  server: server({ routes: catalog }),
  setup: (root) => config(root),
  steps: [
    { until: { screen: "Demo Model" }, settle: 800, timeout: 30_000, checkpoint: "named" },
    { keys: "\x10", settle: 400 },
    { keys: "switch model", settle: 300 },
    { keys: "\r", until: { screen: "Select model" }, settle: 500, checkpoint: "models" },
    { keys: "other", settle: 300, checkpoint: "search" },
    { keys: "\r", settle: 500, checkpoint: "picked" },
    { keys: "\x10", settle: 400 },
    { keys: "variant cycle", settle: 300 },
    { keys: "\r", settle: 500, checkpoint: "variant" },
    { keys: "/settings", settle: 300 },
    { keys: "\r", until: { screen: "Settings" }, settle: 500, checkpoint: "settings" },
    { keys: "\x1b[C", settle: 800, checkpoint: "everything" },
    { keys: "\x1b", settle: 400 },
    ...leave,
  ],
  exits: true,
})
