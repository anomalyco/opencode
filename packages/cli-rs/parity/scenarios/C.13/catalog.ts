// The catalogs a prompt needs before it can submit: one agent, one provider, one model, as full wire objects.
import type { Route } from "../../lib/app"

const location = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}

const agent = {
  id: "build",
  name: "build",
  mode: "primary",
  hidden: false,
  permissions: [],
  request: { settings: {}, headers: {}, body: {} },
}

const provider = { id: "demo", name: "Demo", activation: "auto", package: "demo" }

const model = {
  id: "model",
  modelID: "model",
  providerID: "demo",
  name: "Demo Model",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [],
  time: { released: 0 },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: 1000, output: 100 },
}

export const catalog: Route[] = [
  { path: "/api/agent", json: { location, data: [agent] } },
  { path: "/api/provider", json: { location, data: [provider] } },
  { path: "/api/model", json: { location, data: [model] } },
]

// What `POST /api/session/:id/prompt` answers: the admitted inbox item.
export function inbox(sessionID: string) {
  return {
    id: "msg_p",
    sessionID,
    time: { created: 3 },
    type: "user",
    payload: { text: "hello" },
    delivery: "steer",
  }
}
