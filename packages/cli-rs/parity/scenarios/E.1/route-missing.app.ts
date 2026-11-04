// `OPENCODE_ROUTE` names a plugin route no plugin registers (T14b, T26): the missing route screen, centered.
import { defineApp } from "../../lib/app"

export default defineApp({
  env: { OPENCODE_ROUTE: JSON.stringify({ type: "plugin", id: "acme.tools", name: "board" }) },
  steps: [{ checkpoint: "missing", until: "go home" }],
})
