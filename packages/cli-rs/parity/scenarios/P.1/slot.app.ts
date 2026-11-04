// A plugin in a slot (P.1): a test plugin appends a line to home.footer, under the footer built-in. TS loads it
// from parity/plugins/slot as a local plugin; Rust registers its twin when OPENCODE_PARITY_PLUGIN is `slot`.
import { defineApp } from "../../lib/app"

export default defineApp({
  config: { plugins: ["./plugins/slot"] },
  env: { OPENCODE_PARITY_PLUGIN: "slot" },
  steps: [
    {
      checkpoint: "home",
      until: "slot plugin: home.footer",
      masks: [
        {
          x: 16,
          y: 16,
          width: 84,
          height: 1,
          reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)",
        },
      ],
      // The prompt footer hints are E.14's.
      deviation: ["P01-read-only-prompt"],
    },
  ],
})
