import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, type ModelMessage } from "ai"
import PROMPT_GENERATE from "./generate.txt"
import PROMPT_ORCHESTRATOR from "../session/prompt/orchestrator.txt"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { mergeDeep } from "remeda"
import { Log } from "../util/log"

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.union([z.literal("subagent"), z.literal("primary"), z.literal("all")]),
      builtIn: z.boolean(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: z.object({
        edit: Config.Permission,
        bash: z.record(z.string(), Config.Permission),
        webfetch: Config.Permission.optional(),
        doom_loop: Config.Permission.optional(),
        external_directory: Config.Permission.optional(),
      }),
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      prompt: z.string().optional(),
      tools: z.record(z.string(), z.boolean()),
      options: z.record(z.string(), z.any()),
      // NEW: Kilo Code-style orchestration features (all optional for backward compatibility)
      roleDefinition: z.string().optional(),
      fileTypeRestrictions: z.array(z.string()).optional(),
      canSwitchFrom: z.array(z.string()).optional(),
      requiresApproval: z.boolean().optional(),
      capabilities: z
        .object({
          canCreateSubtasks: z.boolean(),
          canSwitchModes: z.boolean(),
          canModifyFiles: z.boolean(),
          canExecuteCommands: z.boolean(),
        })
        .optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()
    const defaultTools = cfg.tools ?? {}
    const defaultPermission: Info["permission"] = {
      edit: "allow",
      bash: {
        "*": "allow",
      },
      webfetch: "allow",
      doom_loop: "ask",
      external_directory: "ask",
    }
    const agentPermission = mergeAgentPermissions(defaultPermission, cfg.permission ?? {})

    const planPermission = mergeAgentPermissions(
      {
        edit: "deny",
        bash: {
          "cut*": "allow",
          "diff*": "allow",
          "du*": "allow",
          "file *": "allow",
          "find * -delete*": "ask",
          "find * -exec*": "ask",
          "find * -fprint*": "ask",
          "find * -fls*": "ask",
          "find * -fprintf*": "ask",
          "find * -ok*": "ask",
          "find *": "allow",
          "git diff*": "allow",
          "git log*": "allow",
          "git show*": "allow",
          "git status*": "allow",
          "git branch": "allow",
          "git branch -v": "allow",
          "grep*": "allow",
          "head*": "allow",
          "less*": "allow",
          "ls*": "allow",
          "more*": "allow",
          "pwd*": "allow",
          "rg*": "allow",
          "sort --output=*": "ask",
          "sort -o *": "ask",
          "sort*": "allow",
          "stat*": "allow",
          "tail*": "allow",
          "tree -o *": "ask",
          "tree*": "allow",
          "uniq*": "allow",
          "wc*": "allow",
          "whereis*": "allow",
          "which*": "allow",
          "*": "ask",
        },
        webfetch: "allow",
      },
      cfg.permission ?? {},
    )

    const result: Record<string, Info> = {
      general: {
        name: "general",
        description:
          "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.",
        roleDefinition: "Full-capability implementation agent with all tools",
        tools: {
          todoread: false,
          todowrite: false,
          switch_mode: true,
          complete_task: true,
          ...defaultTools,
        },
        options: {},
        permission: agentPermission,
        capabilities: {
          canCreateSubtasks: true,
          canSwitchModes: true,
          canModifyFiles: true,
          canExecuteCommands: true,
        },
        mode: "subagent",
        builtIn: true,
      },
      build: {
        name: "build",
        tools: { ...defaultTools },
        options: {},
        permission: agentPermission,
        mode: "primary",
        builtIn: true,
      },
      plan: {
        name: "plan",
        description: "Read-only planning and analysis agent for architecture design and planning",
        roleDefinition: "Strategic planner who analyzes and designs without making changes",
        options: {},
        permission: planPermission,
        tools: {
          switch_mode: true,
          complete_task: true,
          ...defaultTools,
        },
        capabilities: {
          canCreateSubtasks: false,
          canSwitchModes: true,
          canModifyFiles: false,
          canExecuteCommands: false,
        },
        mode: "primary",
        builtIn: true,
      },
      architect: {
        name: "architect",
        description: "System design and architecture specialist (markdown-only editing)",
        roleDefinition: "Architecture and design specialist who documents designs in markdown",
        tools: {
          read: true,
          write: true, // But filtered by fileTypeRestrictions
          edit: true, // But filtered by fileTypeRestrictions
          glob: true,
          grep: true,
          list: true,
          bash: false,
          switch_mode: true,
          complete_task: true,
          todowrite: true,
          todoread: true,
          ...defaultTools,
        },
        fileTypeRestrictions: [".md", ".txt", ".json"],
        options: {},
        permission: {
          edit: "allow",
          bash: {
            "git status*": "allow",
            "git log*": "allow",
            "git diff*": "allow",
            "*": "deny",
          },
          webfetch: "allow",
        },
        capabilities: {
          canCreateSubtasks: false,
          canSwitchModes: true,
          canModifyFiles: true,
          canExecuteCommands: false,
        },
        mode: "primary",
        builtIn: true,
      },
      orchestrator: {
        name: "orchestrator",
        description: "Orchestrates complex workflows by coordinating specialized agents",
        roleDefinition: "Strategic workflow coordinator who delegates to specialized modes",
        tools: {
          ...defaultTools,
          // Orchestrator-specific overrides (MUST be after defaultTools to take precedence)
          write: false,
          edit: false,
          bash: false,
          task: true,
          switch_mode: true,
          complete_task: false, // Orchestrator doesn't complete itself
          read: true,
          glob: true,
          grep: true,
          todowrite: true,
          todoread: true,
        },
        options: {},
        permission: {
          edit: "deny",
          bash: {
            "git status*": "allow",
            "git log*": "allow",
            "git diff*": "allow",
            "*": "deny",
          },
          webfetch: "allow",
        },
        capabilities: {
          canCreateSubtasks: true,
          canSwitchModes: true,
          canModifyFiles: false,
          canExecuteCommands: false,
        },
        mode: "primary",
        builtIn: true,
        temperature: 0.3,
        // Model auto-selected based on agent permissions (see prompt.ts resolveModel)
        // Read-only agents automatically use small/cheap models
        prompt: PROMPT_ORCHESTRATOR,
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
          permission: agentPermission,
          options: {},
          tools: {},
          builtIn: false,
        }
      const { name, model, prompt, tools, description, temperature, top_p, mode, permission, color, ...extra } = value
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
      item.tools = {
        ...defaultTools,
        ...item.tools,
      }
      if (description) item.description = description
      if (temperature != undefined) item.temperature = temperature
      if (top_p != undefined) item.topP = top_p
      if (mode) item.mode = mode
      if (color) item.color = color
      // just here for consistency & to prevent it from being added as an option
      if (name) item.name = name

      if (permission ?? cfg.permission) {
        item.permission = mergeAgentPermissions(cfg.permission ?? {}, permission ?? {})
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
    const log = Log.create({ service: "agent.generate" })
    const defaultModel = await Provider.defaultModel()
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const system = SystemPrompt.header(defaultModel.providerID)
    system.push(PROMPT_GENERATE)
    const existing = await list()

    try {
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
    } catch (error) {
      log.error("Failed to generate agent configuration", {
        description: input.description,
        error: error instanceof Error ? error.message : String(error),
      })

      // Return fallback agent configuration
      return {
        identifier: "custom-agent",
        whenToUse: "For general purpose tasks when other agents are not suitable",
        systemPrompt: `You are a helpful assistant specialized in ${input.description}. Provide clear, accurate, and helpful responses.`,
      }
    }
  }
}

function mergeAgentPermissions(basePermission: any, overridePermission: any): Agent.Info["permission"] {
  if (typeof basePermission.bash === "string") {
    basePermission.bash = {
      "*": basePermission.bash,
    }
  }
  if (typeof overridePermission.bash === "string") {
    overridePermission.bash = {
      "*": overridePermission.bash,
    }
  }
  const merged = mergeDeep(basePermission ?? {}, overridePermission ?? {}) as any
  let mergedBash
  if (merged.bash) {
    if (typeof merged.bash === "string") {
      mergedBash = {
        "*": merged.bash,
      }
    } else if (typeof merged.bash === "object") {
      mergedBash = mergeDeep(
        {
          "*": "allow",
        },
        merged.bash,
      )
    }
  }

  const result: Agent.Info["permission"] = {
    edit: merged.edit ?? "allow",
    webfetch: merged.webfetch ?? "allow",
    bash: mergedBash ?? { "*": "allow" },
    doom_loop: merged.doom_loop,
    external_directory: merged.external_directory,
  }

  return result
}
