// A background job this prompt started holds the run open: "waiting for 1 background job", then the reply
// it wakes streams before the run ends with exit 0.
import { defineCli } from "../../cli/run"
import { event, server, succeeded, textStep } from "./fixture"

export const job = {
  kind: "shell",
  id: "sh_1",
  sessionID: "ses_run",
  status: "running",
  shellID: "sh_1",
  command: "sleep 5",
  title: "sleep 5",
  time: { started: 3 },
}

// A job started before this prompt (a dev server from an earlier turn) is not waited for.
export const old = { ...job, id: "sh_0", shellID: "sh_0", command: "bun dev", title: "bun dev", time: { started: 1 } }

export const jobs = (list: (count: number) => unknown[]) => ({
  path: "/api/experimental/job",
  json: (_entry: unknown, requests: { path: string }[]) => ({
    data: list(requests.filter((entry) => entry.path === "/api/experimental/job").length),
  }),
})

export const woken = [
  event("session.text.started", { assistantMessageID: "msg_b", ordinal: 0 }, 30),
  event("session.text.ended", { assistantMessageID: "msg_b", ordinal: 0, text: "Job finished." }, 31),
  succeeded(),
]

export default defineCli({
  args: ["run", "hello"],
  server: server({
    events: () => textStep("Started the job."),
    routes: [jobs((count) => (count === 1 ? [old, job] : [old]))],
    late: woken,
  }),
})
