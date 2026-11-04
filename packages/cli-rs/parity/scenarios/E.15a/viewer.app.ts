// The diff viewer (F15) over a repository fixture: `/diff` docks the viewer beside the session (compact, unified),
// `]` jumps to a hunk, `n` to the next file, `m` marks it reviewed, `f` goes full screen with the file tree and the
// split view, `v` switches to unified, `s` shows one file, `b` hides the tree, and `q` closes the viewer.
import { assistant, defineApp, session, user } from "../../lib/app"
import { repoDiff } from "./repo"

const lines = (count: number, line: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => line(index + 1)).join("\n") + "\n"
const parser = lines(40, (index) => `export const rule${index} = ${index}`)

const files = await repoDiff(
  {
    "README.md": "# Parser\n\nParses the token stream.\n",
    "docs/old.md": "Old notes\nabout the lexer\nand more\n",
    "src/parser.ts": parser,
  },
  {
    "README.md": "# Parser\n\nParses the token stream into a tree.\n",
    "docs/old.md": null,
    "src/lexer/token.ts": "export type Token = {\n  kind: string\n  text: string\n}\n",
    "src/parser.ts": parser
      .replace("rule3 = 3", "rule3 = 3 * 2")
      .replace("export const rule35 = 35\n", "export const rule35 = 35\nexport const extra = true\n"),
  },
)

const here = { directory: "/tmp/opencode/packages/tui", project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" } }

export default defineApp({
  width: 140,
  height: 40,
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_d" },
  routes: [
    { path: "/api/session/ses_d", json: { data: session("ses_d", "Review the parser", { updated: 2 }) } },
    {
      path: "/api/session/ses_d/message",
      json: { data: [assistant("msg_2", "The parser changes are ready."), user("msg_1", "Show me the diff")], cursor: {} },
    },
    { path: "/api/session/ses_d/inbox", json: { data: [] } },
    { path: "/api/vcs/base", json: { location: here, data: { name: "main", ref: "main", source: "default" } } },
    { path: "/api/vcs/diff", json: { location: here, data: files } },
  ],
  steps: [
    { checkpoint: "session", until: "The parser changes are ready." },
    { type: "/diff" },
    { keys: ["enter"] },
    { checkpoint: "panel", until: "vs main" },
    { keys: ["]"] },
    { checkpoint: "hunk" },
    { keys: ["n"] },
    { checkpoint: "file" },
    { keys: ["m"] },
    { checkpoint: "reviewed" },
    { keys: ["f"] },
    { checkpoint: "full", until: "▾ src" },
    { keys: ["v"] },
    { checkpoint: "unified" },
    { keys: ["s"] },
    { checkpoint: "single" },
    { keys: ["b"] },
    { checkpoint: "no-tree" },
    { keys: ["q"] },
    { checkpoint: "closed", until: "The parser changes are ready." },
  ],
})
