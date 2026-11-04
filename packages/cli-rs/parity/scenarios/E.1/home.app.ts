// The home (T17): the logo with both words side by side, the prompt slot, and the version in the footer.
import { defineApp } from "../../lib/app"

export default defineApp({
  steps: [
    {
      checkpoint: "wide",
      until: "Ask anything",
      masks: [
        {
          x: 16,
          y: 16,
          width: 84,
          height: 1,
          reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)",
        },
      ],
    },
  ],
})
