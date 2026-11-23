// The home (T17): the logo with both words side by side, the prompt slot, and the version in the footer.
import { defineApp, HOME_PLACEHOLDER } from "../../lib/app"

export default defineApp({
  steps: [
    {
      checkpoint: "wide",
      until: "Ask anything",
      masks: [HOME_PLACEHOLDER],
    },
  ],
})
