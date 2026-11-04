// The working directory dialog (DLG42, T23): a click on the prompt footer's location opens "Working directory"
// with "Copy path", "Open folder", and "Workspaces" (`ui/working-directory-actions.tsx`). Escape closes it. No
// option is chosen: copying and opening reach the system, which the Rust tests cover with a sink.
import { defineApp } from "../../lib/app"

// The home prompt behind the dialog: its placeholder is random in TS and not drawn in Rust yet
// (T17-home-prompt), and its footer hints are E.14's (P01-read-only-prompt).
const placeholder = { line: "Ask anything….*", reason: "the prompt placeholder is picked at random" }

export default defineApp({
  config: { experimental: { "new-designs": true } },
  steps: [
    {
      checkpoint: "home",
      until: "/tmp/opencode/packages/tui:main",
      masks: [placeholder],
      deviation: ["T17-home-prompt", "P01-read-only-prompt"],
    },
    { click: [16, 20] },
    {
      checkpoint: "dialog",
      until: "Working directory",
      masks: [placeholder],
      deviation: ["T17-home-prompt", "P01-read-only-prompt"],
    },
    { keys: ["escape"] },
    { checkpoint: "closed", masks: [placeholder], deviation: ["T17-home-prompt", "P01-read-only-prompt"] },
  ],
})
