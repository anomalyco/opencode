// `location.reload` (T19), bound to F5 here (TS and Rust list it in the palette too, but the two palettes do
// not list the same commands yet): it posts `/api/location/reload`, then the "Configuration reloaded" toast
// replaces "Reloading configuration…" (`app.tsx:1104-1119`).
import { defineApp } from "../../lib/app"

const placeholder = {
  x: 16,
  y: 16,
  width: 84,
  height: 1,
  reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)",
}

export default defineApp({
  config: { experimental: { "new-designs": true }, keybinds: { "location.reload": "f5" } },
  routes: [{ method: "POST", path: "/api/location/reload" }],
  steps: [
    {
      checkpoint: "home",
      until: "Ask anything",
      masks: [placeholder],
    },
    { keys: ["f5"] },
    {
      checkpoint: "reloaded",
      until: "Configuration reloaded",
      masks: [placeholder],
    },
  ],
})
