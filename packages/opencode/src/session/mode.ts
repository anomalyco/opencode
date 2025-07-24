import { mergeDeep } from "remeda"
import { App } from "../app/app"
import { Config } from "../config/config"
import z from "zod"

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
    const mode = mergeDeep(
      {
        build: {},
        plan: {
          tools: {
            write: false,
            edit: false,
            patch: false,
          },
        },
      },
      cfg.mode ?? {},
    )
    const result: Record<string, Info> = {}
    for (const [key, value] of Object.entries(mode)) {
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          tools: {},
        }
      const model = value.model ?? cfg.model
      if (model) {
        const [providerID, ...rest] = model.split("/")
        const modelID = rest.join("/")
        item.model = {
          modelID,
          providerID,
        }
      }
      if (value.prompt) item.prompt = value.prompt
      if (value.tools) item.tools = value.tools
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
