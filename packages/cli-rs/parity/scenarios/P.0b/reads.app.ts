// The small reads of ABI 1.6 (P0b): the test plugin's line in the `app` slot shows its own width, the session tabs,
// the palette's keys, the model's variants and the pending keys, as each client answers them. TS loads the plugin from
// parity/plugins/p0b as a local plugin; Rust registers its twin when OPENCODE_PARITY_PLUGIN is `p0b`.
import { defineApp } from "../../lib/app"

export default defineApp({
  config: { plugins: ["./plugins/p0b"] },
  env: { OPENCODE_PARITY_PLUGIN: "p0b" },
  steps: [
    {
      checkpoint: "home",
      until: "pending 0",
      masks: [
        {
          x: 16,
          y: 16,
          width: 84,
          height: 1,
          reason: "the placeholder example: random in TS and Rust",
        },
      ],
    },
  ],
})
