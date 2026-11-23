// A model's service tiers as speeds (#65749): the model has a slower and a faster speed, each a model of its own.
// `/speed` lists them slowest first with their prices, around the standard speed; picking Fast switches the model
// and the prompt shows the speed after the model's own name.
import { defineApp, HOME_PLACEHOLDER, location, model } from "../../lib/app"

const speed = (id: string, input: number, faster: boolean) => ({
  ...model,
  id: `model-${id}`,
  modelID: `model-${id}`,
  name: `Model ${id}`,
  cost: [{ ...model.cost[0], input }],
  experimental: { speed: { base: "model", id, faster } },
})

const agent = {
  id: "build",
  name: "build",
  description: "The default agent",
  mode: "primary",
  hidden: false,
  permissions: [],
  request: { settings: {}, headers: {}, body: {} },
}

export default defineApp({
  routes: [
    { path: "/api/agent", json: { location, data: [agent] } },
    { path: "/api/model", json: { location, data: [model, speed("flex", 1.5, false), speed("fast", 6, true)] } },
    {
      path: "/api/provider",
      json: { location, data: [{ id: "provider", name: "Provider", activation: "auto", package: "@ai-sdk/test" }] },
    },
  ],
  steps: [
    { checkpoint: "home", until: "Build · Model", masks: [HOME_PLACEHOLDER] },
    { type: "/speed" },
    { checkpoint: "slash", until: "Switch model speed" },
    { keys: ["enter"] },
    { checkpoint: "dialog", until: "2× price", masks: [HOME_PLACEHOLDER] },
    { keys: ["down", "enter"] },
    { checkpoint: "fast", until: "· fast", masks: [HOME_PLACEHOLDER] },
  ],
})
