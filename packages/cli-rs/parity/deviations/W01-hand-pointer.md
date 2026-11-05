# W01: the hand pointer over clickable elements

TypeScript: the TUI never sets a mouse pointer shape. `packages/tui/src` never calls `setMousePointer`, and Core
0.8.1's renderables set none. The renderer writes `OSC 22;default` on its first frame and `OSC 22;` on exit, so the
terminal shows its arrow everywhere: over tabs, links, buttons, select rows, and the pane resize handle.

Rust: every element that acts on a click shows the hand (`OSC 22;pointer`) while the mouse is over it:

- tabs in the strip and the rail, and the new-tab `+` (only over a tab or the button, not the empty strip);
- links: OSC 8 hyperlinks in the transcript (`features/links.rs`) and the OAuth link in DLG10;
- clickable footer and sidebar items: the goal, running subagents and shells, the working directory, MCP;
- buttons and dialog actions, the dialog close `esc`, select and list rows in dialogs, the composer, and the
  autocomplete;
- toasts, user messages, the subagent row and other tool rows that open or expand on a click, reasoning, shell,
  skill and usage headers, the revert banner, the "latest" button, and queued prompts;
- the diff viewer's file rows, controls, file menu, and image cards; prompt image attachments.

A tool row, a reasoning header, or a dialog action that is not clickable in its current state keeps the default.
The pane resize handle shows the resize shape (`OSC 22;ew-resize`). Text, the transcript around these elements,
the prompt and other inputs, the terminal pane, and dialog backdrops keep the default pointer.

`opencode_ui::click_pointer` picks the shape; the shared helpers (select rows, dialog footer actions and close,
toasts, `sidebar::on_click`, the inline and block tool rows) set it, so new elements built on them get it too.

Reason: the user's decision O-46 ("yes"): a hand over tabs and every other clickable element, as a deliberate
deviation from TypeScript.
