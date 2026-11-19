// The working directory dialog (DLG42, T23): a click on the prompt footer's location opens "Working directory"
// with "Copy path", "Open folder", and "Workspaces" (`ui/working-directory-actions.tsx`). Escape closes it. No
// option is chosen: copying and opening reach the system, which the Rust tests cover with a sink.
import { defineApp, HOME_PLACEHOLDER } from "../../lib/app"

export default defineApp({
  config: { experimental: { "new-designs": true } },
  steps: [
    {
      checkpoint: "home",
      until: "/tmp/opencode/packages/tui:main",
      masks: [HOME_PLACEHOLDER],
    },
    { click: [16, 20] },
    {
      checkpoint: "dialog",
      until: "Working directory",
      masks: [HOME_PLACEHOLDER],
    },
    { keys: ["escape"] },
    { checkpoint: "closed", masks: [HOME_PLACEHOLDER] },
  ],
})
