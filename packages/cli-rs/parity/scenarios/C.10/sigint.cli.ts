// SIGINT while the session is still working: the run interrupts the session, then exits with 130.
import { defineCli } from "../../cli/run"
import { server } from "./fixture"

export default defineCli({
  args: ["run", "hello"],
  server: server({
    end: null,
    routes: [
      // The wait never answers in time; the interrupt does.
      { method: "POST", path: "/api/experimental/session/ses_run/wait", status: 204, delay: 20_000 },
      { method: "POST", path: "/api/session/ses_run/interrupt", json: { interrupted: true } },
    ],
  }),
  signal: { after: "/api/experimental/session/ses_run/wait", name: "SIGINT" },
})
