import { App } from "../app/app"
import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, type ModelMessage } from "ai"
import PROMPT_GENERATE from "./generate.txt"
import { SystemPrompt } from "../session/system"
import { mergeDeep } from "remeda"

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.union([z.literal("subagent"), z.literal("primary"), z.literal("all")]),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      permission: z.object({
        edit: Config.Permission,
        bash: z.record(z.string(), Config.Permission),
        webfetch: Config.Permission.optional(),
      }),
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      prompt: z.string().optional(),
      tools: z.record(z.boolean()),
      options: z.record(z.string(), z.any()),
    })
    .openapi({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = App.state("agent", async () => {
    const cfg = await Config.get()
    const defaultPermission: Info["permission"] = {
      edit: "allow",
      bash: {
        "*": "allow",
      },
      webfetch: "allow",
    }
    const result: Record<string, Info> = {
      general: {
        name: "general",
        description:
          "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.",
        tools: {
          todoread: false,
          todowrite: false,
        },
        options: {},
        permission: defaultPermission,
        mode: "subagent",
      },
      build: {
        name: "build",
        tools: {},
        options: {},
        permission: defaultPermission,
        mode: "primary",
      },
      plan: {
        name: "plan",
        options: {},
        permission: defaultPermission,
        tools: {
          write: false,
          edit: false,
          patch: false,
        },
        mode: "primary",
      },
    }
    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: defaultPermission,
          options: {},
          tools: {},
        }
      const { model, prompt, tools, description, temperature, top_p, mode, permission, ...extra } = value
      item.options = {
        ...item.options,
        ...extra,
      }
      if (model) item.model = Provider.parseModel(model)
      if (prompt) item.prompt = prompt
      if (tools)
        item.tools = {
          ...item.tools,
          ...tools,
        }
      if (description) item.description = description
      if (temperature != undefined) item.temperature = temperature
      if (top_p != undefined) item.topP = top_p
      if (mode) item.mode = mode

      if (permission ?? cfg.permission) {
        const merged = mergeDeep(cfg.permission ?? {}, permission ?? {})
        if (merged.edit) item.permission.edit = merged.edit
        if (merged.webfetch) item.permission.webfetch = merged.webfetch
        if (merged.bash) {
          if (typeof merged.bash === "string") {
            item.permission.bash = {
              "*": merged.bash,
            }
          }
          // if granular permissions are provided, default to "ask"
          if (typeof merged.bash === "object") {
            item.permission.bash = mergeDeep(
              {
                "*": "ask",
              },
              merged.bash,
            )
          }
        }
      }
    }
    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }

  export async function generate(input: { description: string }) {
    const defaultModel = await Provider.defaultModel()
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const system = SystemPrompt.header(defaultModel.providerID)
    system.push(PROMPT_GENERATE)
    const existing = await list()
    const result = await generateObject({
      temperature: 0.3,
      prompt: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: model.language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    })
    return result.object
  }
}
