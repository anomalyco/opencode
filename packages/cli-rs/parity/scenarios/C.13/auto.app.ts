// `--auto` (C01): the home prompt's metadata row says `auto` after the agent.
import { defineApp, HOME_PLACEHOLDER } from "../../lib/app"
import { catalog } from "./catalog"

export default defineApp({
  args: { auto: true },
  routes: catalog,
  steps: [
    {
      checkpoint: "home",
      until: "Demo Model",
      masks: [HOME_PLACEHOLDER],
    },
  ],
})
