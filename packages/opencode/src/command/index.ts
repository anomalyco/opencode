import z from "zod"
import { App } from "../app/app"
import { Config } from "../config/config"

export namespace Command {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      template: z.string(),
    })
    .openapi({
      ref: "Command",
    })
  export type Info = z.infer<typeof Info>

  const state = App.state("command", async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {}

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        template: command.template,
      }
    }

    return result
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
