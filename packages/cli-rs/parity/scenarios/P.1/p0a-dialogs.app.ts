// A plugin's confirm and alert, and its styled box (rich plugins P0a, ABI 1.5): the box sits in home.footer, F6 asks
// a confirm whose answer toasts, and F7 shows an alert that toasts once escape closes it. TS loads the plugin from
// parity/plugins/p0a as a local plugin; Rust registers its twin when OPENCODE_PARITY_PLUGIN is `p0a`.
import { defineApp } from "../../lib/app"

// The composer's placeholder example is random in TS and Rust. A dialog covers it but for "Ask".
const placeholder = { x: 16, y: 14, width: 84, height: 1, reason: "the placeholder example: random in TS and Rust" }

export default defineApp({
  config: { plugins: ["./plugins/p0a"] },
  env: { OPENCODE_PARITY_PLUGIN: "p0a" },
  steps: [
    { checkpoint: "home", until: "p0a", masks: [placeholder] },
    { keys: ["f6"] },
    { checkpoint: "confirm", until: "Delete the draft?" },
    { keys: ["return"] },
    { checkpoint: "confirmed", until: "answered true", masks: [placeholder] },
    { keys: ["f7"] },
    { checkpoint: "alert", until: "Heads up" },
    { keys: ["escape"] },
    { checkpoint: "alerted", until: "alert closed", masks: [placeholder] },
  ],
})
