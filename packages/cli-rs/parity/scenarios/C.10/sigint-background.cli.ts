// SIGINT while waiting on a background job: the run interrupts the session, removes the shell job this
// prompt started (not the older one), waits until the tree is quiet, and exits with 130.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"
import { job, old } from "./background.cli"

export default defineCli({
  args: ["run", "hello"],
  server: server({
    events: () => textStep("Started the job."),
    routes: [
      {
        path: "/api/experimental/job",
        json: (_entry: unknown, requests: { method: string; path: string }[]) => ({
          data: requests.some((entry) => entry.method === "DELETE" && entry.path === "/api/shell/sh_1")
            ? [old]
            : [old, job],
        }),
      },
      { method: "DELETE", path: "/api/shell/sh_1", status: 204 },
      { method: "POST", path: "/api/session/ses_run/interrupt", json: { interrupted: true } },
    ],
  }),
  signal: { after: "/api/experimental/job", name: "SIGINT" },
})
