// A cold Location (AGENTS.md "Plugin Loading"): the catalogs answer before the plugins load, so agents, models,
// providers, and commands are empty. The home shows no agent or model line, and the model picker opens empty.
import { defineApp } from "../../lib/app"

const empty = { json: { location: { directory: "/tmp/opencode/packages/tui" }, data: [] } }
// The home prompt's placeholder row: its example is random.
const prompt = [
  {
    x: 16,
    y: 16,
    width: 84,
    height: 1,
    reason: "the placeholder example: random in TS and Rust",
  },
]

export default defineApp({
  routes: ["/api/agent", "/api/model", "/api/provider", "/api/command"].map((path) => ({ path, ...empty })),
  steps: [
    { checkpoint: "home", until: "Ask anything", masks: prompt },
    { keys: ["ctrl+x", "m"] },
    { checkpoint: "models", until: "Free models" },
  ],
})
