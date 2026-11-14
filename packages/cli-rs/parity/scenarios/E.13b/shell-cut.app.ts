// The shell output dialog keeps the newest 64 KiB, counted in UTF-16 code units, and starts it on a whole character
// (#63967): the output is an emoji and then 65,535 units, so the 65,536-unit tail would start on the emoji's second
// half. Every read answers the whole output, so each poll appends it again and the tail stays the same text; Home
// shows its first line, which starts with `x` and not with the emoji or half of it.
import { assistant, defineApp, session, user } from "../../lib/app"

const directory = "/tmp/opencode/packages/tui"
const location = { directory, project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" } }
const rest = `${"x".repeat(1023)}\n`.repeat(63) + "x".repeat(1023)
const output = `😀${rest}`
const size = Buffer.byteLength(output)

const shell = {
  id: "sh_1",
  status: "running",
  command: "render-frames",
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
    { path: "/api/session/ses_p", json: { data: session("ses_p", "Render", { updated: 10 }) } },
    { path: "/api/session", json: { data: [session("ses_p", "Render", { updated: 10 })], cursor: {} } },
    {
      path: "/api/session/ses_p/message",
      json: { data: [assistant("msg_p_2", "Started it.", 2000), user("msg_p_1", "Run it", 1000)], cursor: {} },
    },
    { path: "/api/session/ses_p/inbox", json: { data: [] } },
    { path: "/api/shell", json: { location, data: [shell] } },
    { path: "/api/shell/sh_1", json: { location, data: { ...shell, status: "exited", exit: 0 } } },
    { path: "/api/shell/sh_1/output", json: { location, data: { output, cursor: size, size, truncated: false } } },
  ],
  steps: [
    { checkpoint: "session", until: "Run it" },
    { keys: ["down"] },
    { keys: ["right"] },
    { checkpoint: "shell", until: "render-frames" },
    { keys: ["enter"] },
    { checkpoint: "output", until: "Earlier output omitted" },
    { keys: ["home"] },
    { checkpoint: "first-line" },
  ],
})
