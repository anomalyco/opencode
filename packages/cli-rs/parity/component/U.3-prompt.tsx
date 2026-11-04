/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for DialogPrompt (packages/tui/src/ui/dialog-prompt.tsx): crates/ui/tests/all/dialogs.rs. With a
// value and an action, empty with its placeholder, and busy.
import { DialogPrompt } from "../../../tui/src/ui/dialog-prompt"
import { renderComponent } from "../lib/component"

const base = { width: 70, height: 16 }

await renderComponent({
  ...base,
  fixture: "U.3/prompt",
  dialog: () => (
    <DialogPrompt
      title="Rename session"
      value="My session"
      actions={[{ title: "generate", command: "dialog.worktree.generate", onTrigger: () => {} }]}
    />
  ),
  ready: (frame) => frame.includes("My session"),
})

await renderComponent({
  ...base,
  fixture: "U.3/prompt-empty",
  dialog: () => <DialogPrompt title="Worktree name" placeholder="feature-branch" />,
  ready: (frame) => frame.includes("feature-branch"),
})

await renderComponent({
  ...base,
  fixture: "U.3/prompt-busy",
  dialog: () => <DialogPrompt title="Connecting" value="token" busy busyText="Checking…" />,
  ready: (frame) => frame.includes("Checking…"),
})
