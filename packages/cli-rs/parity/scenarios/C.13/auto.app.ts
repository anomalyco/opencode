// `--auto` (C01): the home prompt's metadata row says `auto` after the agent.
import { defineApp } from "../../lib/app"
import { catalog } from "./catalog"

export default defineApp({
  args: { auto: true },
  routes: catalog,
  steps: [
    {
      checkpoint: "home",
      until: "Demo Model",
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
