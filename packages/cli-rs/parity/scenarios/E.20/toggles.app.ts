// The config toggles (T19): `app.toggle.animations`, `app.toggle.diffwrap`, `app.toggle.file_context`,
// `app.toggle.paste_summary`, and `terminal.title.toggle`, bound to F5 to F9 here (all are `none` by default and
// not in the palette). Each writes `cli.json`; the settings dialog then shows the new values, one filtered row
// per checkpoint. P-FILE in `crates/tui/tests/system_commands.rs` checks the file bytes against TS.
import { defineApp } from "../../lib/app"

const placeholder = { line: "Ask anything….*", reason: "the prompt placeholder is picked at random" }
const behind = { masks: [placeholder], deviation: ["T17-home-prompt", "P01-read-only-prompt"] }
const clear = (text: string) => ({ keys: Array.from(text, () => "backspace") })

export default defineApp({
  config: {
    experimental: { "new-designs": true },
    keybinds: {
      "app.toggle.animations": "f5",
      "app.toggle.diffwrap": "f6",
      "app.toggle.file_context": "f7",
      "app.toggle.paste_summary": "f8",
      "terminal.title.toggle": "f9",
      "opencode.settings": "f10",
    },
  },
  steps: [
    {
      checkpoint: "home",
      until: "Ask anything",
      masks: [placeholder],
      deviation: ["T17-home-prompt", "P01-read-only-prompt"],
    },
    { keys: ["f5", "f6", "f7", "f8", "f9", "f10"] },
    { checkpoint: "settings", until: "Search settings", ...behind },
    { type: "animations" },
    { checkpoint: "animations", until: "Animations", ...behind },
    clear("animations"),
    { type: "diff wrap" },
    { checkpoint: "wrapping", until: "Wrapping", ...behind },
    clear("diff wrap"),
    { type: "editor context" },
    { checkpoint: "editor", until: "Editor context", ...behind },
    clear("editor context"),
    { type: "large pastes" },
    { checkpoint: "pastes", until: "Large pastes", ...behind },
    clear("large pastes"),
    { type: "window title" },
    { checkpoint: "title", until: "Window title", ...behind },
  ],
})
