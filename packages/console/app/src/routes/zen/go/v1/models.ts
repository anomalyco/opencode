import type { APIEvent } from "@solidjs/start/server"
import { ZenData } from "@opencode-ai/console-core/model.js"
import { buildModelsResponse, buildOptionsResponse } from "../../util/modelsHandler"

export async function OPTIONS(_input: APIEvent) {
  return buildOptionsResponse()
}

export async function GET(_input: APIEvent) {
  const zenData = ZenData.list("lite")
  const models = Object.entries(zenData.models)
    .filter(([_, model]) => {
      if (!Array.isArray(model)) return true
      return model.some((m) => m.formatFilter === "oa-compat")
    })
    .map(([id]) => id)
  return buildModelsResponse(models)
}
