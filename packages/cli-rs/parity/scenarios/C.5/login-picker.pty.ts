// `auth login` on a terminal: the integration picker (categories, connected marks), typing filters, then
// the Acme form one prompt per field, and the external connect with the answers.
import { definePty } from "../../pty/run"
import { integrationRoutes, sink } from "./fixture"
import { down, enter, first, press } from "./keys"

export default definePty({
  args: ["auth", "login"],
  cols: 100,
  rows: 40,
  env: sink,
  server: {
    routes: [...integrationRoutes(), { method: "POST", path: "/api/integration/acme/connect/external", status: 204 }],
  },
  steps: [
    first("Select integration", "picker"),
    press(down + down, "moved"),
    press("acme", "filtered"),
    press(enter, "region", "Region"),
    press(down + enter, "team", "Team"),
    press("co" + enter, "team-short", "Must be at least"),
    press("re" + enter, "seats", "Seats"),
    press("80" + enter, "seats-high", "Must be at most"),
    press("\x7f\x7f3" + enter, "beta", "Beta features"),
    press(enter, "scopes", "Scopes"),
    press(enter, "residency", "Data residency"),
    press("yes" + enter, "done", "Done"),
  ],
  osc: [],
  exits: true,
  requests: true,
})
