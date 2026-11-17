// Contract 2.x, addition 3 (step D): `opencode-good-fences@0.1.0`, unmodified from npm. For every filetype OpenTUI's
// maps name it registers a code-block renderer that wraps the host's own code view (`defaultRender()`) in a raised box
// with the fence's language as a muted label. The answer holds a `ts` fence, a fence with no language (no filetype, so
// no renderer: the host's own view), and a `latex` fence, which good-fences takes from the built-in LaTeX as the last
// to register, as in TS. A fence then streams, and the theme changes. TS loads the package from node_modules; the Rust
// client runs the same files on the JS host through the V2 compatibility layer, where a renderer answers after the
// frame: the host's code view shows first, and the box once the JS host answered.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_g"
const answer = [
  "Here is the code:",
  "",
  "```ts",
  "const answer = 42",
  "console.log(answer)",
  "```",
  "",
  "A plain fence:",
  "",
  "```",
  "no language here",
  "```",
  "",
  "And the math:",
  "",
  "```latex",
  "E = mc^2",
  "```",
  "",
].join("\n")

// The blank row a boxed fence has: above the box in Rust (opentui-rust's Markdown spaces every block, O-89); in TS
// inside it, under the label, where the default render's own margin puts it. About 116 cells a box.
const margin = (boxes: number) => [{ file: "F16-plugin-fence-margin", cells: 117 * boxes }]

const delta = (seq: number, text: string) => ({
  event: {
    id: `evt_${seq}`,
    created: 10 + seq,
    type: "session.text.delta",
    durable: { aggregateID: id, seq, version: 1 },
    data: { sessionID: id, assistantMessageID: "msg_2", ordinal: 0, delta: text },
  },
})

export default defineApp({
  width: 120,
  height: 40,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-good-fences"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Show the fences", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Show the fences", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", answer, 2000), user("msg_1", "Show me the fences", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [
    { checkpoint: "settled", until: "E = mc^2", deviation: margin(2) },
    // A fence that streams: its code follows in the frame; its box comes with the JS host's answer.
    delta(1, "\nOne more:\n\n```py\nprint('streaming')\n"),
    { checkpoint: "streaming", until: "print('streaming')", deviation: margin(3) },
    delta(2, "print('done')\n```\n\nThat is all.\n"),
    { checkpoint: "streamed", until: "That is all.", deviation: margin(3) },
    // The theme changes: Markdown builds each fence again, which the plugin draws in the new theme.
    { type: "/themes" },
    { keys: ["enter"] },
    { wait: 500 },
    { type: "tokyonight" },
    { wait: 500 },
    { keys: ["enter"] },
    { wait: 1000 },
    { checkpoint: "themed", until: "That is all.", deviation: margin(3) },
  ],
})
