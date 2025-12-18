import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import { MCP } from "../mcp"

// workaround for zod not supporting async functions natively
// https://zod.dev/v4/changelog?id=zfunction
const createAsyncFunctionSchema = <T extends z.ZodFunction>(schema: T) =>
  z.custom<Parameters<T["implementAsync"]>[0]>((fn) => schema.implementAsync(fn as never))

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
      template: createAsyncFunctionSchema(
        z.function({
          output: z.promise(z.string()),
        }),
      ),
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
        template: () => PROMPT_INITIALIZE.replace("${path}", Instance.worktree),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        template: () => PROMPT_REVIEW.replace("${path}", Instance.worktree),
        subtask: true,
      },
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        template: () => command.template,
        subtask: command.subtask,
      }
    }
    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      result[name] = {
        name,
        description: prompt.description,
        template: async () => {
          const template = await MCP.getPrompt(
            prompt.client,
            prompt.name,
            prompt.arguments
              ? // substitute each argument with $1, $2, etc.
                Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
              : {},
          )
          return (
            template?.messages
              .map((message) => (message.content.type === "text" ? message.content.text : ""))
              .join("\n") || ""
          )
        },
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
