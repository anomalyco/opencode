import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import { MCP } from "../mcp"
import { Log } from "@/util/log"

export namespace Command {
  const log = Log.create({ service: "command" })

  const InfoSchema = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      mcp: z.boolean().optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof InfoSchema>, "template"> & { template: Promise<string> | string }

  // Serializable type for events (template is always awaited to string)
  const InfoSerialized = InfoSchema.extend({
    template: z.string(),
  })

  export const Info = InfoSchema

  export function hints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
  } as const

  const mcpCommands = new Map<string, Info>()
  const mcpTemplateCache = new Map<string, Promise<string>>()
  let mcpInitPromise: Promise<void> | undefined

  export async function initMCPCommands() {
    if (mcpInitPromise) return mcpInitPromise
    mcpInitPromise = MCP.prompts()
      .then((prompts) => {
        mcpCommands.clear()
        mcpTemplateCache.clear()

        for (const [name, prompt] of Object.entries(prompts)) {
          mcpCommands.set(name, {
            name,
            mcp: true,
            description: prompt.description,
            get template() {
              if (mcpTemplateCache.has(name)) {
                return mcpTemplateCache.get(name)!
              }

              const templatePromise = (async () => {
                const template = await MCP.getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                )
                return (
                  template?.messages
                    .map((message) => (message.content.type === "text" ? message.content.text : ""))
                    .join("\n") || ""
                )
              })()

              mcpTemplateCache.set(name, templatePromise)
              return templatePromise
            },
            hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
          })
        }
      })
      .then(async () => {
        const userState = await state()
        const commands = [...Object.values(userState), ...mcpCommands.values()]
        const serialized = await Promise.all(
          commands.map(async (cmd) => ({
            name: cmd.name,
            description: cmd.description,
            agent: cmd.agent,
            model: cmd.model,
            mcp: cmd.mcp,
            template: typeof cmd.template === "string" ? cmd.template : await cmd.template,
            subtask: cmd.subtask,
            hints: cmd.hints,
          })),
        )
        Bus.publish(Event.Updated, serialized)
      })
      .catch((error) => {
        log.error("Failed to load MCP prompts", { error })
        mcpInitPromise = undefined
      })
  }

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
    Updated: BusEvent.define("command.updated", z.array(InfoSerialized)),
  }

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }

    return result
  })

  export async function get(name: string) {
    const userState = await state()
    if (userState[name]) return userState[name]
    return mcpCommands.get(name)
  }

  export async function list() {
    const userState = await state()
    return [...Object.values(userState), ...mcpCommands.values()]
  }
}
