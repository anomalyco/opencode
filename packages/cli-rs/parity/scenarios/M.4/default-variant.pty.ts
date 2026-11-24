// A session without a model uses the location's default model, and the variant cycle steps through that model's
// variants however the default model and the provider catalog race.
import { definePty } from "../../pty/run"
import { catalog, config, leave } from "./fixture"
import { server } from "../M.2/fixture"
import { session } from "../M.1/fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 70,
  rows: 30,
  server: server({
    routes: [
      { path: "/api/session/ses_mini", json: { data: session("ses_mini", { model: undefined }) } },
      { path: "/api/model/default", json: { data: { providerID: "demo", id: "other" } }, delay: 300 },
      ...catalog,
    ],
  }),
  setup: (root) => config(root),
  steps: [
    { until: { screen: "Other Model" }, settle: 800, timeout: 30_000, checkpoint: "named" },
    { keys: "\x10", settle: 400 },
    { keys: "variant cycle", settle: 300 },
    { keys: "\r", settle: 500, checkpoint: "variant" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
