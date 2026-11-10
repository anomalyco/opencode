// Clicks in the composer (#60168): with a running shell and no running subagent, a click on the footer's
// "1 shell" opens the composer on the Shell tab, and a click on a tab label switches to it.
import { assistant, defineApp, session, user } from "../../lib/app"

const directory = "/tmp/opencode/packages/tui"
const location = { directory, project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" } }

const shell = {
  id: "sh_1",
  status: "running",
  command: "bun run build --watch",
  cwd: directory,
  shell: "/bin/sh",
  file: "/tmp/sh_1.log",
  pid: 7,
  metadata: { sessionID: "ses_p" },
  time: { started: 1000 },
}

export default defineApp({
  height: 30,
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_p" },
  routes: [
    { path: "/api/session/ses_p", json: { data: session("ses_p", "Plan the release", { updated: 10 }) } },
    {
      path: "/api/session/ses_p/message",
      json: { data: [assistant("msg_2", "Done.", 2000), user("msg_1", "Ship it", 1000)], cursor: {} },
    },
    { path: "/api/session/ses_p/inbox", json: { data: [] } },
    { path: "/api/shell", json: { location, data: [shell] } },
  ],
  steps: [
    { checkpoint: "session", until: "1 shell" },
    { click: [73, 28] },
    { checkpoint: "shell", until: "bun run build" },
    { click: [8, 19] },
    { checkpoint: "subagents", until: "show inactive" },
    { click: [17, 19] },
    { checkpoint: "shell-again", until: "bun run build" },
  ],
})
