// The base branch dialog (F15, DLG46 and DLG47) on the full-screen route: `d` opens the diff source dialog, whose
// "Base" row names the reported base; it opens the branch picker over the repository's branches, with the reported
// base marked. Choosing a branch loads the diff against it, and the source dialog then names the chosen base.
import { defineApp } from "../../lib/app"
import { repoFixture } from "../E.15a/repo"

const repo = await repoFixture(
  { "README.md": "# Parser\n\nParses the token stream.\n" },
  {
    "README.md": "# Parser\n\nParses the token stream into a tree.\n",
    "src/lexer.ts": "export const lex = (text: string) => [...text]\n",
  },
  { branches: ["feature/lexer", "release"] },
)

const here = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}

export default defineApp({
  width: 80,
  height: 30,
  config: { experimental: { "new-designs": true } },
  routes: [
    { path: "/api/vcs/base", json: { location: here, data: { name: "main", ref: "main", source: "default" } } },
    { path: "/api/vcs/diff", json: { location: here, data: repo.files } },
    { path: "/api/vcs/branch", json: { location: here, data: repo.branches } },
  ],
  steps: [
    {
      checkpoint: "home",
      until: "Ask anything",
      masks: [
        {
          x: 6,
          y: 16,
          width: 74,
          height: 1,
          reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)",
        },
      ],
    },
    { type: "/diff" },
    { keys: ["enter"] },
    { checkpoint: "open", until: "vs main" },
    { keys: ["d"] },
    { checkpoint: "sources", until: "Diff source" },
    { keys: ["down", "down", "down", "enter"] },
    { checkpoint: "branches", until: "release" },
    { keys: ["down", "enter"] },
    { checkpoint: "chosen", until: "vs release" },
    { keys: ["d"] },
    { checkpoint: "remembered", until: "Diff source" },
    { keys: ["escape"] },
    { checkpoint: "closed", until: "vs release" },
  ],
})
