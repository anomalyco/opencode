// The server pages shell output at UTF-8 boundaries (#63984). The running shell wrote 65,535 bytes of ASCII, then
// `😀 end` and two of the three bytes of `€`. The first page stops before the emoji rather than cut it at 65,536
// bytes, the second starts with it, and the third answers nothing and keeps its cursor before `€`: the dialog waits
// for the next poll instead of asking again at once. The joined text is 65,541 code units, so the dialog keeps the
// newest 65,536 and notes the earlier output. The view follows the end, where the last line shows the emoji whole.
import { assistant, defineApp, location, session, user } from "../../lib/app"

const directory = "/tmp/opencode/packages/tui"
const first = `${"x".repeat(1023)}\n`.repeat(63) + `${"x".repeat(1017)}\ntail `
const second = "😀 end"
const size = Buffer.byteLength(first + second) + 2

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

const page = (cursor: number, data: { output: string; cursor: number; size: number }, limit = true) => ({
  path: "/api/shell/sh_1/output",
  query: {
    cursor: [String(cursor)],
    ...(limit ? { limit: ["65536"] } : {}),
    "location[directory]": [directory],
  },
  json: { location, data: { ...data, truncated: false } },
})

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
    { path: "/api/shell/sh_1", json: { location, data: shell } },
    // When the dialog opened, the file held 65,536 bytes, so it reads from the start.
    page(Number.MAX_SAFE_INTEGER, { output: "", cursor: 65536, size: 65536 }, false),
    page(0, { output: first, cursor: first.length, size }),
    page(first.length, { output: second, cursor: size - 2, size }),
    page(size - 2, { output: "", cursor: size - 2, size }),
  ],
  steps: [
    { checkpoint: "session", until: "Run it" },
    { keys: ["down"] },
    { keys: ["right"] },
    { checkpoint: "shell", until: "render-frames" },
    { keys: ["enter"] },
    { checkpoint: "output", until: "Earlier output omitted" },
  ],
})
