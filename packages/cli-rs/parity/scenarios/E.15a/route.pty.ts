// The diff viewer in a real terminal (F15, phase P6c): on home, `/diff` opens the full-screen route with the file tree,
// `]` steps to a hunk, a wheel step scrolls the cards, a right press on a tree row opens the file menu, enter marks the
// file complete, and `q` goes back home. The source is Uncommitted, so no base is read.
import { location } from "../../lib/app"
import { definePty } from "../../pty/run"
import { home, homeMasks, press, release } from "../OT/home"

const lines = (count: number, line: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => line(index + 1)).join("\n")
const file = (name: string, changed: number) => ({
  file: name,
  patch: `@@ -1,20 +1,20 @@\n${lines(20, (index) => (index === changed ? `-old ${index}\n+new ${index}` : ` line ${index}`))}\n`,
  additions: 1,
  deletions: 1,
  status: "modified",
})
const config = JSON.stringify({
  experimental: { "new-designs": true },
  debug: { devtools: false },
  diffs: { source: "working" },
})
const wheelDown = (x: number, y: number) => `\x1b[<65;${x};${y}M`

export default definePty({
  args: [],
  cols: 120,
  rows: 30,
  env: { ...home.env, OPENCODE_CLI_CONFIG_CONTENT: config },
  server: {
    ...home.server,
    routes: [
      {
        path: "/api/vcs/diff",
        json: { location, data: [file("src/lexer.ts", 4), file("src/parser.ts", 15)] },
      },
    ],
  },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "/diff", until: { screen: "/diff" }, settle: 300 },
    { keys: "\r", until: { screen: "≡ parser.ts" }, settle: 500, checkpoint: "open" },
    { keys: "]", settle: 500, checkpoint: "hunk" },
    { keys: wheelDown(80, 15), settle: 500, checkpoint: "wheel" },
    { keys: press(10, 5).replace("<0;", "<2;"), until: { screen: "Mark complete" }, settle: 300 },
    { keys: release(10, 5).replace("<0;", "<2;"), settle: 300, checkpoint: "menu" },
    { keys: "\r", until: { screen: "1/2" }, settle: 500, checkpoint: "complete" },
    { keys: "q", until: { screen: "█▀▀█" }, settle: 500, checkpoint: "home" },
    // Ctrl+C on the empty prompt exits; a second press could land once the terminal is restored, as a SIGINT.
    { keys: "\x03", until: { exit: true } },
  ],
  masks: homeMasks,
  exits: true,
})
