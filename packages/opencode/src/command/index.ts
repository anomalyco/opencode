import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
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
      subtask: z.boolean().optional(),
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
        description: "create/update AGENTS.md",
        template: PROMPT_INITIALIZE.replace("${path}", Instance.worktree),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        template: PROMPT_REVIEW.replace("${path}", Instance.worktree),
        subtask: true,
      },
    }

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

    return result
  })

  export async function get(name: string) {
    const command = await state().then((x) => x[name])
    if (command) return command

    // Check if this is an MCP prompt
    const { MCP } = await import("../mcp")
    const mcpPrompts = await MCP.prompts()
    const prompt = mcpPrompts[name]
    if (prompt) {
      return {
        name,
        description: prompt.description,
        // the template will be fetched when the command is executed so this is
        // just a placeholder
        template: "$ARGUMENTS",
      } satisfies Info
    }

    return undefined
  }

  export async function list() {
    const commands = await state().then((x) => Object.values(x))

    // Add MCP prompts as commands
    const { MCP } = await import("../mcp")
    const mcpPrompts = await MCP.prompts()

    for (const [key, prompt] of Object.entries(mcpPrompts)) {
      commands.push({
        name: key,
        description: prompt.description,
        // the template will be fetched when the command is executed so this is
        // just a placeholder
        template: "$ARGUMENTS",
      })
    }

    return commands
  }
}
