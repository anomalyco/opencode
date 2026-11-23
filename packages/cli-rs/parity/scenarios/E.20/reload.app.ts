// `location.reload` (T19), bound to F5 here (TS and Rust list it in the palette too, but the two palettes do
// not list the same commands yet): it posts `/api/location/reload`, then the "Configuration reloaded" toast
// replaces "Reloading configuration…" (`app.tsx:1104-1119`).
import { defineApp, HOME_PLACEHOLDER } from "../../lib/app"

export default defineApp({
  config: { experimental: { "new-designs": true }, keybinds: { "location.reload": "f5" } },
  routes: [{ method: "POST", path: "/api/location/reload" }],
  steps: [
    {
      checkpoint: "home",
      until: "Ask anything",
      masks: [HOME_PLACEHOLDER],
    },
    { keys: ["f5"] },
    {
      checkpoint: "reloaded",
      until: "Configuration reloaded",
      masks: [HOME_PLACEHOLDER],
    },
  ],
})
