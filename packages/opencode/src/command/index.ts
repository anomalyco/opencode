import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import { Plugin } from "../plugin"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
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
      type: z.enum(["template", "plugin"]).default("template"),
      subtask: z.boolean().optional(),
      sessionOnly: z.boolean().optional(),
      aliases: z.array(z.string()).optional(),
    })
    .meta({
      ref: "Command",
    })
  export type Info = z.infer<typeof Info>

  export const Default = {
    INIT: "init",
    REVIEW: "review",
  } as const

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {
      [Default.INIT]: {
        name: Default.INIT,
        type: "template",
        description: "create/update AGENTS.md",
        template: PROMPT_INITIALIZE.replace("${path}", Instance.worktree),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        type: "template",
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        template: PROMPT_REVIEW.replace("${path}", Instance.worktree),
        subtask: true,
      },
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        type: "template",
        agent: command.agent,
        model: command.model,
        description: command.description,
        template: command.template,
        subtask: command.subtask,
      }
    }

    // Plugin commands
    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      const commands = plugin["plugin.command"]
      if (!commands) continue
      for (const [name, cmd] of Object.entries(commands)) {
        if (result[name]) continue // Don't override existing commands
        result[name] = {
          name,
          type: "plugin",
          description: cmd.description,
          template: "", // Plugin commands don't use templates
          sessionOnly: cmd.sessionOnly,
          aliases: cmd.aliases,
        }
      }
    }

    return result
  })

  export async function get(name: string) {
    const commands = await state()
    if (commands[name]) return commands[name]
    // Resolve aliases
    for (const cmd of Object.values(commands)) {
      if (cmd.aliases?.includes(name)) return cmd
    }
    return undefined
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
