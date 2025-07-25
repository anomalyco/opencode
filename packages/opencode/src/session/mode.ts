import { App } from "../app/app"
import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"

export namespace Mode {
  export const Info = z
    .object({
      name: z.string(),
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
    const result: Record<string, Info> = {
      build: {
        name: "build",
        tools: {},
      },
      plan: {
        name: "plan",
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
      const model = value.model ?? cfg.model
      if (model) {
        item.model = Provider.parseModel(model)
      }
      if (value.prompt) item.prompt = value.prompt
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
