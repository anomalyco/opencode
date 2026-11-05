// P-TUI version of `layout-parity-2/permission-edit.app.ts`: a real `patch` call asks for the edit permission
// (V11, E.9a), and the dock shows the server's diff, whose added line wraps: the diff's scroll box is as tall as the
// wrapped rows inline, and fills the prompt in full screen.
import { defineSim } from "../../sim/scenario"

// Plain text, so neither client highlights it (TS downloads grammars at runtime, H06). The added line wraps.
const long =
  "The parser keeps every value, trims the spaces around it, and skips the empty values and the lines that start with #."

export default defineSim({
  permissions: [{ action: "edit", resource: "*", effect: "ask" }],
  files: { "notes.txt": "Parser notes\nThe parser keeps every value.\nSee the tests.\n" },
  model: [
    {
      items: [
        {
          type: "toolCall",
          index: 0,
          id: "call_1",
          name: "patch",
          input: {
            patchText: [
              "*** Begin Patch",
              "*** Update File: notes.txt",
              "@@",
              " Parser notes",
              "-The parser keeps every value.",
              `+${long}`,
              " See the tests.",
              "*** End Patch",
            ].join("\n"),
          },
        },
      ],
      finish: "tool-calls",
    },
  ],
  steps: [
    { until: "Simulated Model" },
    { type: "Fix the parser" },
    { until: "Fix the parser" },
    { enter: true },
    { checkpoint: "inline", until: "Permission required" },
    { press: "f", modifiers: { ctrl: true } },
    { checkpoint: "fullscreen", until: "ctrl+f minimize" },
  ],
})
