// The committed source without base metadata (F15): the server reports no base, so the viewer asks for one instead
// of requesting a diff, at the full-screen route's size of 100 columns with no file tree to show.
import { defineApp, HOME_PLACEHOLDER, location } from "../../lib/app"

export default defineApp({
  config: { experimental: { "new-designs": true }, diffs: { source: "committed" } },
  routes: [{ path: "/api/vcs/base", json: { location, data: null } }],
  steps: [
    // Typing before the prompt is mounted loses the keys.
    {
      checkpoint: "home",
      until: "Ask anything",
      masks: [HOME_PLACEHOLDER],
    },
    { type: "/diff" },
    { keys: ["enter"] },
    { checkpoint: "unavailable", until: "Committed comparison unavailable" },
  ],
})
