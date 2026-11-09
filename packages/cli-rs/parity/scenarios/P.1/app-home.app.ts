// The app slot (P.1) on home: the test plugin's line shows under the route, below the home footer. TS loads the
// plugin from parity/plugins/app as a local plugin; Rust registers its twin when OPENCODE_PARITY_PLUGIN is `app`.
import { defineApp } from "../../lib/app"

export default defineApp({
  config: { plugins: ["./plugins/app"] },
  env: { OPENCODE_PARITY_PLUGIN: "app" },
  steps: [
    {
      checkpoint: "home",
      until: "app plugin: app",
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
