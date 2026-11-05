// P-TUI version of `E.7b/blocks.app.ts`: block tool rows (V05b, V23) from the real tool runtime: a `patch` that
// updates one file and deletes another, one that adds a file, one that fails on a context mismatch, an `execute`
// run that throws, and a glob and a grep, each call in its own row (`session.grouping: none`). The server offers no
// `todowrite`, and a `question` needs its own dock, so neither is here.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }
const patch = (index: number, id: string, lines: string[]) => ({
  type: "toolCall" as const,
  index,
  id,
  name: "patch",
  input: { patchText: ["*** Begin Patch", ...lines, "*** End Patch"].join("\n") },
})

export default defineSim({
  height: 60,
  config: { session: { grouping: "none" } },
  files: {
    "src/lexer.rs": "fn peek(&self) -> Option<char> {\n    self.chars.get(self.pos + 1)\n}\n",
    "src/old.rs": "pub fn old() {}\n",
    "src/a.rs": "fn a() {}\n",
  },
  model: [
    {
      items: [
        patch(0, "call_1", [
          "*** Update File: src/lexer.rs",
          "@@",
          " fn peek(&self) -> Option<char> {",
          "-    self.chars.get(self.pos + 1)",
          "+    self.chars.get(self.pos)",
          " }",
          "*** Delete File: src/old.rs",
        ]),
        patch(1, "call_2", ["*** Add File: docs/lexer.md", "+# Lexer"]),
        patch(2, "call_3", ["*** Update File: src/a.rs", "@@", "-fn missing() {}", "+fn found() {}"]),
        { type: "toolCall", index: 3, id: "call_4", name: "execute", input: { code: "throw new Error('boom')" } },
        { type: "toolCall", index: 4, id: "call_5", name: "glob", input: { pattern: "src/*.rs" } },
        { type: "toolCall", index: 5, id: "call_6", name: "grep", input: { pattern: "fn peek" } },
      ],
      finish: "tool-calls",
    },
    { items: [{ type: "textDelta", text: "Fixed the lexer." }] },
  ],
  steps: [
    { until: "Simulated Model" },
    { type: "Fix the lexer and track it" },
    { until: "track it" },
    { enter: true },
    {
      checkpoint: "open",
      until: "Fixed the lexer.",
      masks: [duration],
      deviation: ["P15-metadata-gap-fg", "P16-diff-markdown-heading"],
    },
  ],
})
