// `acp --login` (AC02): runs `auth login` with no target. The command finds the registered fake service
// (C.8's sandbox registration, so no real service or account is touched), opens the integration picker,
// and connects Acme through its external method with the form answers. URL opens go to C.5's sink.
import { definePty } from "../../pty/run"
import { integrationRoutes, sink } from "../C.5/fixture"
import { down, enter, first, press } from "../C.5/keys"
import { env, info, only, register } from "../C.8/fixture"

export default definePty({
  args: [],
  command: only(["acp", "--login"]),
  cols: 100,
  rows: 40,
  env: { ...env, ...sink },
  setup: register,
  server: {
    version: false,
    routes: [
      info([]),
      ...integrationRoutes(),
      { method: "POST", path: "/api/integration/acme/connect/external", status: 204 },
    ],
  },
  steps: [
    first("Select integration", "picker"),
    press("acme", "filtered"),
    press(enter, "region", "Region"),
    press(down + enter, "team", "Team"),
    press("core" + enter, "seats", "Seats"),
    press("3" + enter, "beta", "Beta features"),
    press(enter, "scopes", "Scopes"),
    press(enter, "residency", "Data residency"),
    press("yes" + enter, "done", "Done"),
  ],
  osc: [],
  exits: true,
  requests: true,
})
