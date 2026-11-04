// `OPENCODE_ROUTE` names a plugin route no plugin registers (T14b, T26): the missing route screen, centered.
import { defineApp } from "../../lib/app"

// Rust reads the default location's catalogs at startup on every route (the prompt and model state); TS
// reads none on a plugin route. Answering them keeps P-REQ to the reads both sides send.
const location = { directory: "/tmp/opencode/packages/tui", project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" } }
const catalog = (path: string) => ({ path, json: { location, data: [] } })

export default defineApp({
  routes: [
    ...["/api/model", "/api/provider", "/api/agent", "/api/integration"].map(catalog),
    { path: "/api/config", json: [] },
  ],
  env: { OPENCODE_ROUTE: JSON.stringify({ type: "plugin", id: "acme.tools", name: "board" }) },
  steps: [{ checkpoint: "missing", until: "go home" }],
})
