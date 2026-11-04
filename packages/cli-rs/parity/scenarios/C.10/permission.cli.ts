// A permission request for this session is rejected with feedback, and the run goes on.
import { defineCli } from "../../cli/run"
import { event, server, textStep } from "./fixture"

export const ask = event("permission.asked", { id: "per_1", action: "edit", resources: ["src/a.ts", "src/b.ts"] }, 12)

export default defineCli({
  args: ["run", "hello"],
  server: server({
    events: () => [ask, ...textStep("Skipped the edit.")],
    routes: [{ method: "POST", path: "/api/session/ses_run/permission/per_1/reply", status: 204 }],
  }),
})
