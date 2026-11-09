// SIGINT while the session is still working: the run interrupts the session, waits for it to go idle,
// then exits with 130.
import { defineCli } from "../../cli/run"
import { server } from "./fixture"

const waits = (requests: { path: string }[]) =>
  requests.filter((entry) => entry.path === "/api/experimental/session/ses_run/wait").length

export default defineCli({
  args: ["run", "hello"],
  server: server({
    end: null,
    routes: [
      // The first wait never answers in time; the one after the interrupt does.
      {
        method: "POST",
        path: "/api/experimental/session/ses_run/wait",
        status: 204,
        delay: (_entry, requests) => (waits(requests) > 1 ? 0 : 20_000),
      },
      { method: "POST", path: "/api/session/ses_run/interrupt", json: { interrupted: true } },
    ],
  }),
  signal: { after: "/api/experimental/session/ses_run/wait", name: "SIGINT" },
})
