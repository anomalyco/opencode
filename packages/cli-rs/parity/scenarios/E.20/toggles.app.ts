// The config toggles (T19): `app.toggle.animations`, `app.toggle.diffwrap`, `app.toggle.file_context`,
// `app.toggle.paste_summary`, and `terminal.title.toggle`, bound to F5 to F9 here (all are `none` by default and
// not in the palette). Each writes `cli.json`; the settings dialog then shows the new values, one filtered row
// per checkpoint. P-FILE in `crates/tui/tests/all/system_commands.rs` checks the file bytes against TS.
import { defineApp } from "../../lib/app"

const placeholder = {
  x: 16,
  y: 16,
  width: 84,
  height: 1,
  reason: "the placeholder example: random in TS and Rust",
}
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
    },
    { keys: ["f5", "f6", "f7", "f8", "f9", "f10"] },
    { checkpoint: "settings", until: "Search settings" },
    { type: "animations" },
    { checkpoint: "animations", until: "Animations" },
    clear("animations"),
    { type: "diff wrap" },
    { checkpoint: "wrapping", until: "Wrapping" },
    clear("diff wrap"),
    { type: "editor context" },
    { checkpoint: "editor", until: "Editor context" },
    clear("editor context"),
    { type: "large pastes" },
    { checkpoint: "pastes", until: "Large pastes" },
    clear("large pastes"),
    { type: "window title" },
    { checkpoint: "title", until: "Window title" },
  ],
})
