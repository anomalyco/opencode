// `background` with `--format json`: a `background_wait` event lists the jobs.
import { defineCli } from "../../cli/run"
import { nowMask, server, textStep } from "./fixture"
import { job, jobs, old, woken } from "./background.cli"

export default defineCli({
  args: ["run", "--format", "json", "hello"],
  server: server({
    events: () => textStep("Started the job."),
    routes: [jobs((count) => (count === 1 ? [old, job] : [old]))],
    late: woken,
  }),
  masks: [nowMask],
})
