import type { APIEvent } from "@solidjs/start/server"
import { ZenData } from "@opencode-ai/console-core/model.js"
import { buildModelsResponse, buildOptionsResponse, getNpm } from "../../util/modelsHandler"

export async function OPTIONS(_input: APIEvent) {
  return buildOptionsResponse()
}

export async function GET(_input: APIEvent) {
  const catalog = ZenData.list("lite")
  const models = Object.entries(catalog.models).map(([id, model]) => ({
    id,
    npm: getNpm(model, catalog.providers),
  }))
  return buildModelsResponse(models)
}
