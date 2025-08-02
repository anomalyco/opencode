import { App } from "../app/app"
import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"

export namespace Mode {
  export const Info = z
    .object({
      name: z.string(),
      temperature: z.number().optional(),
      topP: z.number().optional(),
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      prompt: z.string().optional(),
      tools: z.record(z.boolean()),
    })
    .openapi({
      ref: "Mode",
    })
  export type Info = z.infer<typeof Info>
  const state = App.state("mode", async () => {
    const cfg = await Config.get()
    const model = cfg.model ? Provider.parseModel(cfg.model) : undefined
    const result: Record<string, Info> = {
      build: {
        model,
        name: "build",
        tools: {},
      },
      plan: {
        name: "plan",
        model,
        tools: {
          write: false,
          edit: false,
          patch: false,
        },
      },
    }
    for (const [key, value] of Object.entries(cfg.mode ?? {})) {
      if (value.disable) continue
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          tools: {},
        }
      item.name = key
      if (value.model) item.model = Provider.parseModel(value.model)
      if (value.prompt) item.prompt = value.prompt
      if (value.temperature != undefined) item.temperature = value.temperature
      if (value.top_p != undefined) item.topP = value.top_p
      if (value.tools)
        item.tools = {
          ...value.tools,
          ...item.tools,
        }
    }

    return result
  })

  export async function get(mode: string) {
    return state().then((x) => x[mode])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
