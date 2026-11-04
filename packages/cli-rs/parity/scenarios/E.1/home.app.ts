// The home (T17): the logo with both words side by side, the prompt slot, and the version in the footer.
import { defineApp } from "../../lib/app"

export default defineApp({
  steps: [
    {
      checkpoint: "wide",
      until: "Ask anything",
      masks: [{ line: "Ask anything….*", reason: "the prompt placeholder is picked at random" }],
      deviation: ["T17-home-prompt"],
    },
  ],
})
