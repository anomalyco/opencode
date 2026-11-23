// SIGINT while a video job runs (#63666): the API can't cancel a video job, so the run interrupts the session
// and exits with 130 instead of waiting for the job, as it does for image and Code Mode jobs.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"

const video = {
  kind: "video",
  id: "vid_1",
  sessionID: "ses_run",
  status: "running",
  title: "a cat surfing",
  path: "videos/cat",
  time: { started: 3 },
}

export default defineCli({
  args: ["run", "hello"],
  server: server({
    events: () => textStep("Started the video."),
    routes: [
      { path: "/api/experimental/job", json: { data: [video] } },
      { method: "POST", path: "/api/session/ses_run/interrupt", json: { interrupted: true } },
    ],
  }),
  signal: { after: "/api/experimental/job", name: "SIGINT" },
})
