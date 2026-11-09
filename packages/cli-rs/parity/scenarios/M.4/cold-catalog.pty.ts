// A cold Location (AGENTS.md "Plugin Loading"): the catalogs answer empty until the plugins load, here once a
// prompt was sent. The `*.updated` events that follow fill in the status row's model and provider names and the
// server's `/` commands, without a restart.
import type { Logged, Route } from "../../lib/fake-server"
import { definePty } from "../../pty/run"
import { config, leave } from "./fixture"
import { catalog } from "./fixture"
import { answer, commands, agents } from "../M.2/fixture"
import { directory, location, server } from "../M.1/fixture"

const warm = (requests: Logged[]) =>
  requests.some((entry) => entry.method === "POST" && entry.path.endsWith("/prompt"))

const cold = (route: Route, data: unknown): Route => ({
  path: route.path,
  json: (entry: Logged, requests: Logged[]) => (warm(requests) ? data : { location, data: [] }),
})

const listed = (data: unknown[]) => ({ location, data })

const updated = (type: string) => ({
  id: `evt_${type.replace(/\W/g, "")}`,
  created: 100,
  type,
  location: { directory },
  data: {},
})

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 70,
  rows: 20,
  server: server({
    routes: [
      ...catalog.map((route) => cold(route, route.json)),
      cold({ path: "/api/agent" }, listed(agents)),
      cold({ path: "/api/command" }, listed(commands)),
      { path: "/api/reference", json: listed([]) },
    ],
    events: (id) => [
      ...answer(id, "Warm now."),
      ...["provider.updated", "model.updated", "agent.updated", "command.updated"].map(updated),
    ],
  }),
  setup: (root) => config(root),
  steps: [
    { until: { screen: "Third answer" }, settle: 800, timeout: 30_000, checkpoint: "cold" },
    { keys: "/rev", settle: 400, checkpoint: "cold-slash" },
    { keys: "\x1b", settle: 300 },
    { keys: "hello\r", until: { screen: "Demo Model" }, settle: 800, checkpoint: "warm" },
    { keys: "/rev", settle: 400, checkpoint: "warm-slash" },
    { keys: "\x1b", settle: 300 },
    ...leave,
  ],
  exits: true,
  masks: [
    {
      pattern: /^[Bb]uild · Demo Model · <duration>$/,
      reason:
        "the turn's agent label is read when its line is written: TS writes it on the turn's end, before the " +
        "catalog refresh lands; Rust after `session.wait`, after it",
    },
  ],
})
