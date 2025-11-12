import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import { Bus } from "../bus"
import { Identifier } from "../id/id"

export namespace Command {
  export const Default = {
    INIT: "init",
  } as const

  export const Event = {
    Executed: Bus.event(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: Identifier.schema("session"),
        arguments: z.string(),
        messageID: Identifier.schema("message"),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      template: z.string(),
      subtask: z.boolean().optional(),
    })
    .meta({
      ref: "Command",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {}

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        template: command.template,
        subtask: command.subtask,
      }
    }

    if (result[Default.INIT] === undefined) {
      result[Default.INIT] = {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        template: PROMPT_INITIALIZE.replace("${path}", Instance.worktree),
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
