// Mini replays an answer with a fence that holds one shell line wider than the terminal, at the top level and in a
// list item. Both clients wrap the line by word inside the fence (Core's default `wrapMode: "word"`, OpenTUI #2089
// in Rust).
import { definePty } from "../../pty/run"
import { assistant, config, server, statusMask, user } from "./fixture"

const command =
  "OPENCODE_STORY_MEDIA=/home/user/src/opencode/packages/tui/fixtures/story-media.json OPENCODE_STORY=transcript-fences bun run dev:live"
const text = `Run the story:\n\n\`\`\`sh\n${command}\n\`\`\`\n\n1. Then in a list:\n\n   \`\`\`sh\n   ${command}\n   \`\`\`\n\nDone.`

const rest = String.raw`\n\s*\S*json OPENCODE_STORY=transcript-fences bun run dev:live\s*\n`
const wrapped = new RegExp(String.raw`${rest}[\s\S]*${rest}[\s\S]*Done\.`)

const messages = [user("msg_u1", "show the story command", 10), assistant("msg_a1", [{ type: "text", text }], 11)]

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 80,
  rows: 30,
  server: server({ messages }),
  setup: (root) => config(root),
  steps: [
    // Each fence's second row starts with the wrapped rest of the line, so a cut-off line times out.
    { until: { screen: wrapped }, settle: 800, timeout: 30_000, checkpoint: "replayed", scrollback: 30 },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400, checkpoint: "exited" },
  ],
  exits: true,
  masks: [statusMask],
})
