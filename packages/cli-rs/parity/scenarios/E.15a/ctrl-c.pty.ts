// Ctrl+C in the diff viewer (F15, big-boi's review of P6c): TS binds `app.exit` to close the viewer, so the chord in
// the full-screen route goes back home and the app keeps running; a second one on home, with an empty prompt, exits.
// Rust's host takes the reserved chord, which no plugin sees, to leave a plugin's route.
import { definePty } from "../../pty/run"
import { home, homeMasks } from "../OT/home"

const here = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}
const config = JSON.stringify({
  experimental: { "new-designs": true },
  debug: { devtools: false },
  diffs: { source: "working" },
})

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
        json: {
          location: here,
          data: [
            {
              file: "src/lexer.ts",
              patch: "@@ -1 +1 @@\n-old\n+new\n",
              additions: 1,
              deletions: 1,
              status: "modified",
            },
          ],
        },
      },
    ],
  },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "/diff", until: { screen: "/diff" }, settle: 300 },
    { keys: "\r", until: { screen: "≡ lexer.ts" }, settle: 500, checkpoint: "open" },
    { keys: "\x03", until: { screen: "█▀▀█" }, settle: 1000, checkpoint: "home" },
    { keys: "\x03" },
  ],
  masks: homeMasks,
  exits: true,
})
