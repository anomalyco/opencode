// The shortcuts dialog and the file menu (F15, DLG48 and DLG49) on the full-screen route with the file tree: `?`
// shows the shortcuts as bound, a right-click on a tree row opens the file menu, Enter marks the file complete, and
// the menu opened again offers to mark it incomplete until Escape closes it.
import { defineApp } from "../../lib/app"
import { repoFixture } from "../E.15a/repo"

const repo = await repoFixture(
  { "README.md": "# Parser\n\nParses the token stream.\n" },
  {
    "README.md": "# Parser\n\nParses the token stream into a tree.\n",
    "src/lexer.ts": "export const lex = (text: string) => [...text]\n",
  },
)

const here = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}

export default defineApp({
  width: 120,
  height: 30,
  config: { experimental: { "new-designs": true } },
  routes: [
    { path: "/api/vcs/base", json: { location: here, data: { name: "main", ref: "main", source: "default" } } },
    { path: "/api/vcs/diff", json: { location: here, data: repo.files } },
  ],
  steps: [
    {
      checkpoint: "home",
      until: "Ask anything",
      masks: [
        {
          x: 26,
          y: 16,
          width: 94,
          height: 1,
          reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)",
        },
      ],
    },
    { type: "/diff" },
    { keys: ["enter"] },
    {
      checkpoint: "open",
      until: "vs main",
      // TS settles this first frame before its asynchronous highlighting lands; `help-closed` compares the same
      // rows highlighted.
      masks: [
        { x: 33, y: 3, width: 87, height: 1, reason: "code row, highlighted later in TS" },
        { x: 33, y: 7, width: 87, height: 1, reason: "code row, highlighted later in TS" },
      ],
    },
    { keys: ["?"] },
    { checkpoint: "help", until: "Diff shortcuts" },
    { keys: ["escape"] },
    { checkpoint: "help-closed", until: "≡ lexer.ts" },
    { rightClick: [8, 4] },
    { checkpoint: "menu", until: "Mark complete" },
    { keys: ["enter"] },
    { checkpoint: "complete", until: "1/2" },
    { rightClick: [8, 4] },
    { checkpoint: "menu-again", until: "Mark incomplete" },
    { keys: ["escape"] },
    { checkpoint: "menu-closed", until: "1/2" },
  ],
})
