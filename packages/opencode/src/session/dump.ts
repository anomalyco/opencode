import { mkdir } from "fs/promises"
import path from "path"
import { type ModelMessage, type Tool as AITool, jsonSchema, tool } from "ai"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { Layer } from "effect"
import { mergeDeep, pipe } from "remeda"
import type { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Config } from "@/config"
import { makeRuntime } from "@/effect/run-service"
import { Flag } from "@/flag/flag"
import { Identifier } from "@/id/id"
import { InstallationVersion } from "@/installation/version"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Provider, ProviderTransform } from "@/provider"
import { MessageV2 } from "@/session/message-v2"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt, STRUCTURED_OUTPUT_SYSTEM_PROMPT } from "@/session/prompt"
import { SystemPrompt } from "@/session/system"
import * as Session from "@/session/session"
import { MessageID, SessionID } from "@/session/schema"

const authRuntime = makeRuntime(Auth.Service, Auth.defaultLayer as Layer.Layer<Auth.Service, never, never>)
const configRuntime = makeRuntime(Config.Service, Config.defaultLayer as Layer.Layer<Config.Service, never, never>)
const pluginRuntime = makeRuntime(Plugin.Service, Plugin.defaultLayer as Layer.Layer<Plugin.Service, never, never>)
const providerRuntime = makeRuntime(
  Provider.Service,
  Provider.defaultLayer as Layer.Layer<Provider.Service, never, never>,
)
const sessionRuntime = makeRuntime(Session.Service, Session.defaultLayer as Layer.Layer<Session.Service, never, never>)
const systemPromptRuntime = makeRuntime(
  SystemPrompt.Service,
  SystemPrompt.defaultLayer as Layer.Layer<SystemPrompt.Service, never, never>,
)

type DumpContent = {
  timestamps: {
    generated_at: number
    generated_at_iso: string
  }
  model: {
    id: string
    name: string
    providerID: string
    apiID: string
    variant?: string
  }
  system: string[]
  messages: ModelMessage[]
  options: {
    temperature: number | undefined
    topP: number | undefined
    topK: number | undefined
    maxOutputTokens: number | undefined
    providerOptions: Record<string, any>
  }
  request: {
    tools: Record<string, { description: string | undefined; inputSchema: unknown }>
    activeTools: string[]
    toolChoice: "auto" | "required" | "none" | undefined
    headers: Record<string, string | undefined>
    maxRetries: number
    abort: {
      present: boolean
      aborted: boolean
    }
    experimentalTelemetry: {
      isEnabled: boolean | undefined
      functionId: string
      metadata: {
        userId: string
        sessionId: SessionID
      }
    }
  }
}

function defaultDumpDir() {
  const root = Instance.project.vcs ? Instance.worktree : Instance.directory
  return path.join(root, ".opencode", "dumps")
}

function resolveDumpDir(setting: boolean | string | undefined) {
  if (typeof setting !== "string" || !setting.trim()) return defaultDumpDir()
  if (path.isAbsolute(setting)) return setting
  const root = Instance.project.vcs ? Instance.worktree : Instance.directory
  return path.join(root, setting)
}

function format(content: DumpContent) {
  const out: string[] = []

  out.push("=== METADATA ===")
  out.push(`generated_at: ${content.timestamps.generated_at_iso}`)
  out.push(`provider: ${content.model.providerID}`)
  out.push(`model: ${content.model.id}`)
  out.push(`api_id: ${content.model.apiID}`)
  if (content.model.variant) out.push(`variant: ${content.model.variant}`)

  out.push("\n=== SYSTEM PROMPT ===")
  out.push(content.system.join("\n\n"))

  out.push("\n=== MESSAGES ===")
  for (const [index, message] of content.messages.entries()) {
    out.push(`\n[Message ${index}] role: ${message.role}`)
    out.push(typeof message.content === "string" ? message.content : JSON.stringify(message.content, null, 2))
  }

  out.push("\n=== TOOLS ===")
  out.push(JSON.stringify(content.request.tools, null, 2))

  out.push("\n=== REQUEST OPTIONS ===")
  out.push(JSON.stringify({ options: content.options, request: content.request }, null, 2))

  return out.join("\n")
}

export namespace ContextDump {
  export async function assemble(input: {
    sessionID: SessionID
    model: Provider.Model
    agent: Agent.Info
    toolChoice?: "auto" | "required" | "none"
    retries?: number
    small?: boolean
    abort?: AbortSignal
  }) {
    let messages = MessageV2.filterCompacted(MessageV2.stream(input.sessionID))
    const sessionInfo = await sessionRuntime.runPromise((svc) => svc.get(input.sessionID))
    messages = await SessionPrompt.insertReminders({
      messages,
      agent: input.agent,
      session: sessionInfo,
    })

    const lastUser = messages.findLast((message) => message.info.role === "user")
    if (!lastUser || lastUser.info.role !== "user") {
      throw new Error("No user message found for context dump")
    }
    const user = lastUser.info

    await pluginRuntime.runPromise((svc) => svc.trigger("experimental.chat.messages.transform", {}, { messages }))

    const [cfg, language, providerInfo, authInfo, skills, instructions, modelMessages] = await Promise.all([
      configRuntime.runPromise((svc) => svc.get()),
      providerRuntime.runPromise((svc) => svc.getLanguage(input.model)),
      providerRuntime.runPromise((svc) => svc.getProvider(input.model.providerID)),
      authRuntime.runPromise((svc) => svc.get(input.model.providerID)),
      systemPromptRuntime.runPromise((svc) => svc.skills(input.agent)),
      Instruction.system(),
      MessageV2.toModelMessages(messages, input.model),
    ])

    const env = [
      [
        `You are powered by the model named ${input.model.api.id}. The exact model ID is ${input.model.providerID}/${input.model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${Instance.project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
      ].join("\n"),
    ]
    const system = LLM.buildSystem({
      agent: input.agent,
      model: input.model,
      user,
      system: [
        ...env,
        ...(skills ? [skills] : []),
        ...instructions,
        ...(user.format?.type === "json_schema" ? [STRUCTURED_OUTPUT_SYSTEM_PROMPT] : []),
      ],
    })
    await pluginRuntime.runPromise((svc) =>
      svc.trigger("experimental.chat.system.transform", { sessionID: input.sessionID, model: input.model }, { system }),
    )
    LLM.rejoinSystemForCaching(system)

    const variant =
      !input.small && input.model.variants && user.model.variant ? input.model.variants[user.model.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: providerInfo.options,
        })
    const options = pipe(base, mergeDeep(input.model.options), mergeDeep(input.agent.options), mergeDeep(variant))
    const isOpenaiOauth = providerInfo.id === "openai" && authInfo?.type === "oauth"
    if (isOpenaiOauth) options.instructions = system.join("\n")

    const params = await pluginRuntime.runPromise((svc) =>
      svc.trigger(
        "chat.params",
        {
          sessionID: input.sessionID,
          agent: input.agent.name,
          model: input.model,
          provider: providerInfo,
          message: user,
        },
        {
          temperature: input.model.capabilities.temperature
            ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
            : undefined,
          topP: input.agent.topP ?? ProviderTransform.topP(input.model),
          topK: ProviderTransform.topK(input.model),
          maxOutputTokens: ProviderTransform.maxOutputTokens(input.model),
          options,
        },
      ),
    )

    const { headers } = await pluginRuntime.runPromise((svc) =>
      svc.trigger(
        "chat.headers",
        {
          sessionID: input.sessionID,
          agent: input.agent.name,
          model: input.model,
          provider: providerInfo,
          message: user,
        },
        { headers: {} },
      ),
    )

    const handle = await SessionProcessor.create({
      assistantMessage: {
        id: MessageID.make(Identifier.ascending("message")),
        parentID: user.id,
        role: "assistant",
        mode: input.agent.name,
        agent: input.agent.name,
        variant: user.model.variant,
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: input.model.id,
        providerID: input.model.providerID,
        time: { created: Date.now() },
        sessionID: input.sessionID,
      },
      sessionID: input.sessionID,
      model: input.model,
    })

    const allTools = await SessionPrompt.resolveTools({
      agent: input.agent,
      model: input.model,
      session: sessionInfo,
      tools: user.tools,
      processor: handle,
      bypassAgentCheck: lastUser.parts.some((part) => part.type === "agent"),
      messages,
    })
    if (user.format?.type === "json_schema") {
      allTools.StructuredOutput = SessionPrompt.createStructuredOutputTool({
        schema: user.format.schema,
        onSuccess() {},
      })
    }

    const tools = LLM.resolveTools({
      tools: allTools,
      agent: input.agent,
      permission: sessionInfo.permission,
      user,
    })
    const isLiteLLMProxy =
      providerInfo.options?.litellmProxy === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")
    if (
      (isLiteLLMProxy || input.model.providerID.includes("github-copilot")) &&
      Object.keys(tools).length === 0 &&
      LLM.hasToolCalls(modelMessages)
    ) {
      tools._noop = tool({
        description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            reason: { type: "string", description: "Unused" },
          },
        }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    const requestMessages =
      isOpenaiOauth || language instanceof GitLabWorkflowLanguageModel
        ? modelMessages
        : [
            ...system.map(
              (content): ModelMessage => ({
                role: "system",
                content,
              }),
            ),
            ...modelMessages,
          ]
    const transformedMessages = ProviderTransform.message(requestMessages, input.model, options)
    const toolset = Object.fromEntries(
      Object.entries(tools).map(([name, item]) => {
        const value = item as AITool & { inputSchema?: unknown }
        return [
          name,
          {
            description: value.description,
            inputSchema: value.inputSchema,
          },
        ]
      }),
    ) as DumpContent["request"]["tools"]

    return {
      timestamps: {
        generated_at: Date.now(),
        generated_at_iso: new Date().toISOString(),
      },
      model: {
        id: input.model.id,
        name: input.model.name,
        providerID: input.model.providerID,
        apiID: input.model.api.id,
        variant: user.model.variant,
      },
      system,
      messages: transformedMessages,
      options: {
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        maxOutputTokens: params.maxOutputTokens,
        providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      },
      request: {
        tools: toolset,
        activeTools: Object.keys(tools).filter((name) => name !== "invalid"),
        toolChoice: input.toolChoice ?? (user.format?.type === "json_schema" ? "required" : undefined),
        headers: {
          ...(input.model.providerID.startsWith("opencode")
            ? {
                "x-opencode-project": Instance.project.id,
                "x-opencode-session": input.sessionID,
                "x-opencode-request": user.id,
                "x-opencode-client": Flag.OPENCODE_CLIENT,
              }
            : {
                "x-session-affinity": input.sessionID,
                ...(sessionInfo.parentID ? { "x-parent-session-id": sessionInfo.parentID } : {}),
                "User-Agent": `opencode/${InstallationVersion}`,
              }),
          ...input.model.headers,
          ...headers,
        },
        maxRetries: input.retries ?? 0,
        abort: {
          present: !!input.abort,
          aborted: input.abort?.aborted ?? false,
        },
        experimentalTelemetry: {
          isEnabled: cfg.experimental?.openTelemetry,
          functionId: "session.llm",
          metadata: {
            userId: cfg.username ?? "unknown",
            sessionId: input.sessionID,
          },
        },
      },
    } satisfies DumpContent
  }

  export async function write(input: {
    sessionID: SessionID
    content: DumpContent
    format: "text" | "json"
  }) {
    const config = await configRuntime.runPromise((svc) => svc.get())
    const dir = resolveDumpDir(config.experimental?.dump_context)
    await mkdir(dir, { recursive: true })

    const stamp = input.content.timestamps.generated_at_iso.replace(/[:T]/g, "-").replace(/\.\d{3}Z$/, "Z")
    const ext = input.format === "json" ? ".json" : ".txt"
    const file = path.join(dir, `${input.sessionID}-${stamp}${ext}`)
    await Bun.write(file, input.format === "json" ? JSON.stringify(input.content, null, 2) : format(input.content))
    return file
  }
}
