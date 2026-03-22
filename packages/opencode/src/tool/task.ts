import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { Instance } from "@/project/instance"
import { ModelID, ProviderID } from "@/provider/schema"

const dynamicAgentConfig = z
  .object({
    prompt: z.string().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    color: z.string().optional(),
    steps: z.number().int().positive().optional(),
    permission: z.record(z.string(), z.any()).optional(),
    options: z.record(z.string(), z.any()).optional(),
  })
  .strict()

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  subagent_description: z
    .string()
    .describe("Optional specialization for an ad hoc dynamic subagent")
    .optional(),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
  model: z.string().describe('Optional model override in the format "provider/model"').optional(),
  variant: z.string().describe("Optional reasoning or thinking level override").optional(),
  agent_config: dynamicAgentConfig.describe("Internal dynamic task agent configuration").optional(),
})

function parseModel(model: string) {
  const separator = model.indexOf("/")
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error(`Invalid model "${model}". Expected "provider/model".`)
  }

  return {
    providerID: ProviderID.make(model.slice(0, separator)),
    modelID: ModelID.make(model.slice(separator + 1)),
  }
}

function buildDynamicAgentPrompt(input: {
  name: string
  description: string
  workingDirectory: string
  projectRoot: string
  prompt?: string
}) {
  return [
    ...(input.prompt ? [input.prompt, ""] : []),
    `You are @${input.name}, a dynamic subagent.`,
    `Specialization: ${input.description}`,
    "",
    `Current working directory: ${input.workingDirectory}`,
    ...(input.projectRoot !== input.workingDirectory ? [`Project root: ${input.projectRoot}`] : []),
    "",
    "Treat the specialization as authoritative for this run.",
    "Resolve relative paths from the current working directory shown above.",
    "Do not invent absolute filesystem paths. If the task gives a relative project path, use that exact relative path unless you verify a different path exists first.",
  ].join("\n")
}

async function buildDynamicAgent(params: z.infer<typeof parameters>) {
  if (!params.subagent_description) return

  const general = await Agent.get("general")
  if (!general) {
    throw new Error('Dynamic subagents require the native "general" agent to be available.')
  }

  return Agent.Info.parse({
    ...general,
    name: params.subagent_type,
    description: params.subagent_description,
    mode: "subagent",
    hidden: true,
    prompt: buildDynamicAgentPrompt({
      name: params.subagent_type,
      description: params.subagent_description,
      workingDirectory: Instance.directory,
      projectRoot: Instance.worktree,
      prompt: params.agent_config?.prompt,
    }),
    temperature: params.agent_config?.temperature ?? general.temperature,
    topP: params.agent_config?.top_p ?? general.topP,
    color: params.agent_config?.color ?? general.color,
    steps: params.agent_config?.steps ?? general.steps,
    options: {
      ...general.options,
      ...(params.agent_config?.options ?? {}),
    },
    permission: params.agent_config?.permission
      ? Permission.merge(general.permission, Permission.fromConfig(params.agent_config.permission))
      : general.permission,
  })
}

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  const list = accessibleAgents.toSorted((a, b) => a.name.localeCompare(b.name))

  const description = DESCRIPTION.replace(
    "{agents}",
    list
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()
      const dynamicAgent = await buildDynamicAgent(params)
      const agent = dynamicAgent ?? (await Agent.get(params.subagent_type))

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(SessionID.make(params.task_id)).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const model =
        (params.model ? parseModel(params.model) : undefined) ??
        agent.model ?? {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        }
      const variant = params.variant ?? agent.variant

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          ...(variant ? { variant } : {}),
        },
      })

      const messageID = MessageID.ascending()

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        agentContext: dynamicAgent,
        ...(variant ? { variant } : {}),
        tools: {
          todowrite: false,
          todoread: false,
          ...(hasTaskPermission ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          ...(variant ? { variant } : {}),
        },
        output,
      }
    },
  }
})
