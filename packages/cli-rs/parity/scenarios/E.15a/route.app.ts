// The diff viewer as a full-screen route (F15): `/diff` on home opens it with the file tree and unified hunks (the
// patches are too narrow to split at 120 columns). `]` and `[` step through hunks across files, `s` and `m` review
// the single file and move on, `ctrl+d`, `shift+g`, and `gg` scroll, and `q` goes back home.
import { defineApp } from "../../lib/app"
import { repoDiff } from "./repo"

const lines = (count: number, line: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => line(index + 1)).join("\n") + "\n"
const config = lines(60, (index) => `key${index}: value${index}`)

const files = await repoDiff(
  {
    "config/app.yaml": config,
    "src/main.rs": 'fn main() {\n    println!("hello");\n}\n',
  },
  {
    "config/app.yaml": config
      .replace("key5: value5\n", "key5: changed\n")
      .replace("key40: value40\n", "key40: changed\nkey40b: added\n"),
    "src/main.rs": 'fn main() {\n    println!("hello, world");\n}\n',
    "src/util/mod.rs": "pub mod text;\n",
  },
)

const here = { directory: "/tmp/opencode/packages/tui", project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" } }

export default defineApp({
  width: 120,
  height: 30,
  config: { experimental: { "new-designs": true } },
  routes: [
    { path: "/api/vcs/base", json: { location: here, data: { name: "origin/main", ref: "origin/main", source: "reflog" } } },
    { path: "/api/vcs/diff", json: { location: here, data: files } },
  ],
  steps: [
    { type: "/diff" },
    { keys: ["enter"] },
    { checkpoint: "open", until: "vs origin/main" },
    { keys: ["]"] },
    { checkpoint: "hunk-1" },
    { keys: ["]"] },
    { checkpoint: "hunk-2" },
    { keys: ["["] },
    { checkpoint: "hunk-back" },
    { keys: ["s"] },
    { checkpoint: "single" },
    { keys: ["m"] },
    { checkpoint: "single-reviewed" },
    { keys: ["s"] },
    { checkpoint: "all" },
    { keys: ["ctrl+d"] },
    { checkpoint: "half-page" },
    { keys: ["shift+g"] },
    { checkpoint: "last" },
    { keys: ["g", "g"] },
    { checkpoint: "first" },
    { keys: ["q"] },
    {
      checkpoint: "home",
      until: "Ask anything",
      masks: [{ x: 26, y: 16, width: 94, height: 1, reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)" }],
    },
  ],
})
