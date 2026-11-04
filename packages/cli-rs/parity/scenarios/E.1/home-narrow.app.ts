// The home below 44 columns (T17): the two words stacked, one column of side padding, and no footer.
import { defineApp } from "../../lib/app"

export default defineApp({
  width: 40,
  height: 24,
  steps: [
    {
      checkpoint: "narrow",
      until: "Ask",
      masks: [
        { x: 2, y: 16, width: 38, height: 1, reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)" },
      ],
    },
  ],
})
