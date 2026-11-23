// The config toggles (T19): `app.toggle.animations`, `app.toggle.diffwrap`, `app.toggle.file_context`,
// `app.toggle.paste_summary`, and `terminal.title.toggle`, bound to F5 to F9 here (all are `none` by default and
// not in the palette). Each writes `cli.json`; the settings dialog then shows the new values, one filtered row
// per checkpoint. P-FILE in `crates/tui/tests/all/system_commands.rs` checks the file bytes against TS. The dialog
// leaves the home prompt's random placeholder in view (#64983 dropped its empty footer row), so every checkpoint
// masks it.
import { defineApp, HOME_PLACEHOLDER } from "../../lib/app"

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
      masks: [HOME_PLACEHOLDER],
    },
    { keys: ["f5", "f6", "f7", "f8", "f9", "f10"] },
    { checkpoint: "settings", until: "Search settings", masks: [HOME_PLACEHOLDER] },
    { type: "animations" },
    { checkpoint: "animations", until: "Animations", masks: [HOME_PLACEHOLDER] },
    clear("animations"),
    { type: "diff wrap" },
    { checkpoint: "wrapping", until: "Wrapping", masks: [HOME_PLACEHOLDER] },
    clear("diff wrap"),
    { type: "editor context" },
    { checkpoint: "editor", until: "Editor context", masks: [HOME_PLACEHOLDER] },
    clear("editor context"),
    { type: "large pastes" },
    { checkpoint: "pastes", until: "Large pastes", masks: [HOME_PLACEHOLDER] },
    clear("large pastes"),
    { type: "window title" },
    { checkpoint: "title", until: "Window title", masks: [HOME_PLACEHOLDER] },
  ],
})
