// P-TUI version of `E.7a/tools.app.ts`: core tool rows (V05a) from the real tool runtime: a shell that fails with
// its output, a read of a line range, and a `patch` with a unified diff, each call in its own row
// (`session.grouping: none`). The server has no LSP here, so there is no diagnostic.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }
const parser = [
  "fn next(tokens: &[Token], index: usize) -> Option<&Token> {",
  "    if index + 1 < tokens.len() {",
  "        return tokens.get(index);",
  "    }",
  "    None",
  "}",
  "",
].join("\n")

export default defineSim({
  height: 40,
  config: { session: { grouping: "none" } },
  files: { "src/parser.rs": parser },
  model: [
    {
      items: [
        {
          type: "toolCall",
          index: 0,
          id: "call_1",
          name: "shell",
          input: {
            command:
              "printf 'running 2 tests\\ntest next_stops_early ... FAILED\\ntest next_reads ... ok\\n'; exit 101",
            description: "Run the parser tests",
          },
        },
        {
          type: "toolCall",
          index: 1,
          id: "call_2",
          name: "read",
          input: { path: "src/parser.rs", offset: 1, limit: 4 },
        },
        {
          type: "toolCall",
          index: 2,
          id: "call_3",
          name: "patch",
          input: {
            patchText: [
              "*** Begin Patch",
              "*** Update File: src/parser.rs",
              "@@",
              " fn next(tokens: &[Token], index: usize) -> Option<&Token> {",
              "-    if index + 1 < tokens.len() {",
              "+    if index < tokens.len() {",
              "         return tokens.get(index);",
              "*** End Patch",
            ].join("\n"),
          },
        },
      ],
      finish: "tool-calls",
    },
    { items: [{ type: "textDelta", text: "Fixed the bound." }] },
  ],
  steps: [
    { until: "Simulated Model" },
    { type: "Fix the off-by-one in the parser" },
    { until: "in the parser" },
    { enter: true },
    { checkpoint: "open", until: "Fixed the bound.", masks: [duration], deviation: ["P15-metadata-gap-fg"] },
  ],
})
