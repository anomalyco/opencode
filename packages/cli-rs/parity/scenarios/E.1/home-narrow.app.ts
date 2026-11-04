// The home below 44 columns (T17): the two words stacked, one column of side padding, and no footer.
import { defineApp } from "../../lib/app"

export default defineApp({
  width: 40,
  height: 24,
  steps: [
    {
      checkpoint: "narrow",
      until: "Ask",
      masks: [{ line: "Ask.*", reason: "the prompt placeholder is picked at random" }],
      deviation: ["T17-home-prompt"],
    },
  ],
})
