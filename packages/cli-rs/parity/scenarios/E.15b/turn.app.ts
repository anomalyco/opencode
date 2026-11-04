// The last turn's diff (F15, DLG47): in a session, `d` opens the diff source dialog with "Last turn" offered,
// selecting it loads `/api/session/:id/diff`, `m` marks a file reviewed, and a turn that runs and ends loads the
// diff again, which starts the reviewed marks over.
import { assistant, defineApp, session, user } from "../../lib/app"
import { repoFixture } from "../E.15a/repo"

const base = {
  "README.md": "# Parser\n\nParses the token stream.\n",
  "src/parser.ts": "export const parse = (text: string) => text.split(' ')\n",
}
const branch = await repoFixture(base, {
  "README.md": "# Parser\n\nParses the token stream into a tree.\n",
  "src/lexer.ts": "export const lex = (text: string) => [...text]\n",
})
const turn = await repoFixture(base, {
  "src/parser.ts": "export const parse = (text: string) => text.trim().split(' ')\n",
  "src/tree.ts": "export type Tree = { children: Tree[] }\n",
})

const here = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}
const id = "ses_d"
let seq = 0
const execution = (type: string) => ({
  event: {
    id: `evt_${++seq}`,
    created: 3000 + seq,
    type,
    durable: { aggregateID: id, seq, version: 1 },
    data: { sessionID: id },
  },
})

export default defineApp({
  width: 140,
  height: 40,
  config: { experimental: { "new-designs": true } },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Review the parser", { updated: 2 }) } },
    {
      path: `/api/session/${id}/message`,
      json: {
        data: [assistant("msg_2", "The parser changes are ready."), user("msg_1", "Show me the diff")],
        cursor: {},
      },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { path: `/api/session/${id}/diff`, json: { data: turn.files } },
    { path: "/api/vcs/base", json: { location: here, data: { name: "main", ref: "main", source: "default" } } },
    { path: "/api/vcs/diff", json: { location: here, data: branch.files } },
  ],
  steps: [
    { checkpoint: "session", until: "The parser changes are ready." },
    { type: "/diff" },
    { keys: ["enter"] },
    { checkpoint: "panel", until: "vs main" },
    { keys: ["d"] },
    { checkpoint: "sources", until: "Latest session turn" },
    { keys: ["down", "down", "down", "enter"] },
    { checkpoint: "turn", until: "src/tree.ts" },
    { keys: ["m"] },
    { checkpoint: "reviewed", until: "1/2" },
    execution("session.execution.started"),
    // The viewer must see the session running before it sees it idle again.
    { checkpoint: "running", until: "1/2" },
    execution("session.execution.succeeded"),
    { checkpoint: "refetched", until: "0/2" },
  ],
})
