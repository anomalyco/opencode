// The composer (V20, DLG18): Down on the empty prompt opens the Subagents tab with the running subagents of the
// session's family; Down moves, Ctrl+A shows the inactive ones, Enter opens a subagent, whose session shows the
// composer instead of a prompt, and Escape goes back to the parent. Right goes to the Shell tab, Enter opens the shell
// output dialog, Ctrl+D kills the shell, the Terminals tab offers a new terminal, and Escape gives the prompt back.
import { assistant, defineApp, session, user } from "../../lib/app"

const directory = "/tmp/opencode/packages/tui"
const location = { directory, project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" } }

const child = (id: string, parentID: string, title: string, updated: number, agent?: string) => ({
  ...session(id, title, { updated }),
  parentID,
  ...(agent ? { agent } : {}),
})

const sessions = [
  session("ses_p", "Plan the release", { updated: 10 }),
  child("ses_c1", "ses_p", "Find the parser (@explore subagent)", 9),
  child("ses_c2", "ses_p", "Review the docs", 8, "general"),
  child("ses_c3", "ses_c1", "Check the tests (@general subagent)", 7),
]

const shell = {
  id: "sh_1",
  status: "running",
  command: "bun run build --watch\nbun test",
  cwd: directory,
  shell: "/bin/sh",
  file: "/tmp/sh_1.log",
  pid: 7,
  metadata: { sessionID: "ses_p" },
  time: { started: 1000 },
}

const transcript = (id: string, text: string) => [
  { path: `/api/session/${id}/message`, json: { data: [assistant(`msg_${id}_2`, "Done.", 2000), user(`msg_${id}_1`, text, 1000)], cursor: {} } },
  { path: `/api/session/${id}/inbox`, json: { data: [] } },
]

export default defineApp({
  height: 30,
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_p" },
  routes: [
    { path: "/api/session/ses_p", json: { data: sessions[0] } },
    { path: "/api/session/ses_c1", json: { data: sessions[1] } },
    { path: "/api/session", json: { data: sessions, cursor: {} } },
    { path: "/api/session/active", json: { data: { ses_c1: { type: "running" }, ses_c3: { type: "running" } } } },
    ...transcript("ses_p", "Ship it"),
    ...transcript("ses_c1", "Look for the parser"),
    { path: "/api/shell", json: { location, data: [shell] } },
    // An exited shell with nothing captured, so the dialog stays the same while it polls.
    { path: "/api/shell/sh_1", json: { location, data: { ...shell, status: "exited", exit: 0 } } },
    { path: "/api/shell/sh_1/output", json: { location, data: { output: "", cursor: 0, size: 0, truncated: false } } },
    { method: "DELETE", path: "/api/shell/sh_1", status: 204 },
  ],
  steps: [
    { checkpoint: "session", until: "Ship it" },
    { keys: ["down"] },
    { checkpoint: "subagents", until: "Subagents" },
    { keys: ["down"] },
    { checkpoint: "next", until: "Check the tests" },
    { keys: ["ctrl+a"] },
    { checkpoint: "inactive", until: "show active" },
    { keys: ["ctrl+a"] },
    { checkpoint: "active", until: "show inactive" },
    { keys: ["enter"] },
    { checkpoint: "child", until: "Look for the parser" },
    { keys: ["escape"] },
    { checkpoint: "parent", until: "Ship it" },
    { keys: ["down"] },
    { keys: ["right"] },
    { checkpoint: "shell", until: "bun run build" },
    { keys: ["enter"] },
    { checkpoint: "output", until: "No captured output" },
    { keys: ["escape"] },
    { checkpoint: "output-closed" },
    { keys: ["ctrl+d"] },
    { keys: ["right"] },
    { checkpoint: "terminals", until: "New terminal" },
    { keys: ["escape"] },
    { checkpoint: "closed" },
    { type: "ok" },
    { checkpoint: "typed" },
  ],
})
