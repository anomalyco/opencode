import path from "path"
import os from "os"
import fs from "fs/promises"
import z from "zod"
import { Filesystem } from "../util/filesystem"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { type ModelMessage, type Tool as AITool, tool, jsonSchema, type ToolCallOptions, asSchema } from "ai"
import { SessionCompaction } from "./compaction"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { ProviderTransform } from "../provider/transform"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { defer } from "../util/defer"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { LSP } from "../lsp"
import { ReadTool } from "../tool/read"
import { FileTime } from "../file/time"
import { NotFoundError } from "@/storage/db"
import { Flag } from "../flag/flag"
import { ulid } from "ulid"
import { spawn } from "child_process"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { ConfigMarkdown } from "../config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { Shell } from "@/shell/shell"
import { Truncate } from "@/tool/truncate"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { QuickAssistant } from "@/quick-assistant"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

function toolOutput(result: { output: string; attachments?: Array<{ mime: string; url: string }> }) {
  const attachments = (result.attachments ?? []).filter((attachment) => {
    return attachment.url.startsWith("data:") && attachment.url.includes(",")
  })

  const media = (url: string): string => {
    // If not a data URL, return as-is
    if (!url.startsWith("data:")) return url

    const comma = url.indexOf(",")
    if (comma === -1) return url

    const prefix = url.slice(0, comma + 1) // e.g., "data:image/png;base64,"
    const body = url.slice(comma + 1)

    // If body is nested data URL, recursively extract and rebuild
    if (body.startsWith("data:")) {
      const extracted = media(body)
      // If extracted is a data URL, strip its prefix and use our prefix
      if (extracted.startsWith("data:")) {
        const extractedComma = extracted.indexOf(",")
        if (extractedComma !== -1) {
          return prefix + extracted.slice(extractedComma + 1)
        }
      }
      return prefix + extracted
    }

    // Body is pure base64, return complete data URL
    return prefix + body
  }

  if (attachments.length === 0) {
    return {
      type: "text" as const,
      value: result.output,
    }
  }

  return {
    type: "content" as const,
    value: [
      { type: "text" as const, text: result.output },
      ...attachments.map((attachment) => ({
        type: "media" as const,
        mediaType: attachment.mime,
        data: media(attachment.url),
      })),
    ],
  }
}

export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })

  function diag(message: string) {
    process.stderr.write(`[tcc-diagnostic] [aether-flow] ${message}\n`)
  }

  function safeText(value: unknown) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 220)
  }

  function summarizeSessionMessages(messages: MessageV2.WithParts[]) {
    return messages
      .slice(-6)
      .map((message) => {
        const parts = message.parts
          .map((part) => {
            if (part.type === "text") return `text:${part.text.length}`
            if (part.type === "reasoning") return `reasoning:${part.text.length}`
            if (part.type === "tool") {
              const state = part.state as {
                status: string
                input?: unknown
                output?: string
                error?: string
              }
              const inputKeys =
                state.input && typeof state.input === "object" ? Object.keys(state.input).slice(0, 5).join(",") : ""
              return `tool:${part.tool}:${state.status}:call=${part.callID}:out=${state.output?.length ?? 0}:err=${state.error ? 1 : 0}:keys=${inputKeys || "none"}`
            }
            return part.type
          })
          .join("|")
        const info = message.info as { id: string; role: string; finish?: string; error?: unknown }
        return `${info.role}:${info.id}:finish=${info.finish ?? "none"}:error=${info.error ? 1 : 0}:parts=${parts || "none"}`
      })
      .join(" ; ")
  }

  function summarizeModelMessages(messages: ModelMessage[]) {
    return messages
      .slice(-6)
      .map((message) => {
        const role = message.role
        const content = (message as { content?: unknown }).content
        const parts = Array.isArray(content)
          ? content
              .map((part) => {
                if (!part || typeof part !== "object") return typeof part
                const p = part as {
                  type?: string
                  toolName?: string
                  toolCallId?: string
                  text?: string
                  output?: unknown
                }
                if (p.type === "text") return `text:${p.text?.length ?? 0}`
                if (p.type === "tool-call") return `tool-call:${p.toolName ?? "none"}:${p.toolCallId ?? "none"}`
                if (p.type === "tool-result") {
                  const outputLen = typeof p.output === "string" ? p.output.length : JSON.stringify(p.output ?? "").length
                  return `tool-result:${p.toolName ?? "none"}:${p.toolCallId ?? "none"}:out=${outputLen}`
                }
                if (p.type === "reasoning") return `reasoning:${p.text?.length ?? 0}`
                return p.type ?? "unknown"
              })
              .join("|")
          : `text:${String(content ?? "").length}`
        return `${role}:parts=${parts || "none"}`
      })
      .join(" ; ")
  }

  async function hookPart(input: {
    sessionID: SessionID
    messageID: MessageID
    plugin: string
    hook: string
    stage: "before" | "after" | "error"
    error?: string
  }) {
    const now = Date.now()
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: input.messageID,
      sessionID: input.sessionID,
      type: "tool",
      callID: ulid(),
      tool: "hook",
      state: {
        status: "completed",
        input: {
          hook: input.plugin,
          hook_type: `${input.stage} ${input.hook}`,
          event: input.hook,
        },
        output: input.error ?? "",
        title: input.plugin,
        metadata: {
          hook: input.plugin,
          hook_type: `${input.stage} ${input.hook}`,
          event: input.hook,
          output: input.error ?? "",
        },
        time: {
          start: now,
          end: now,
        },
      },
      metadata: {
        hook: input.plugin,
        hook_type: `${input.stage} ${input.hook}`,
        event: input.hook,
        error: input.error,
      },
    })
  }

  function hookOpts(sessionID: SessionID, messageID: MessageID) {
    return {
      onInvoke: async (event: {
        plugin: string
        custom: boolean
        hook: string
        stage: "before" | "after" | "error"
        error?: string
      }) => {
        if (!event.custom) return
        try {
          await hookPart({
            sessionID,
            messageID,
            plugin: event.plugin,
            hook: event.hook,
            stage: event.stage,
            error: event.error,
          })
        } catch (err) {
          log.debug("skip hook timeline part", {
            sessionID,
            messageID,
            plugin: event.plugin,
            hook: event.hook,
            stage: event.stage,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    }
  }

  const state = Instance.state(
    () => {
      const data: Record<
        string,
        {
          abort: AbortController
          callbacks: {
            resolve(input: MessageV2.WithParts): void
            reject(reason?: any): void
          }[]
        }
      > = {}
      return data
    },
    async (current) => {
      for (const item of Object.values(current)) {
        item.abort.abort()
      }
    },
  )

  export function assertNotBusy(sessionID: SessionID) {
    const match = state()[sessionID]
    if (match) throw new Session.BusyError(sessionID)
  }

  export const PromptInput = z.object({
    sessionID: SessionID.zod,
    messageID: MessageID.zod.optional(),
    model: z
      .object({
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
      })
      .optional(),
    agent: z.string().optional(),
    noReply: z.boolean().optional(),
    tools: z
      .record(z.string(), z.boolean())
      .optional()
      .describe(
        "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
      ),
    format: MessageV2.Format.optional(),
    system: z.string().optional(),
    variant: z.string().optional(),
    command: z
      .object({
        name: z.string(),
        source: z.enum(["command", "mcp", "skill"]).optional(),
      })
      .optional(),
    parts: z.array(
      z.discriminatedUnion("type", [
        MessageV2.TextPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "TextPartInput",
          }),
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "FilePartInput",
          }),
        MessageV2.AgentPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "AgentPartInput",
          }),
        MessageV2.SubtaskPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "SubtaskPartInput",
          }),
      ]),
    ),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  export const prompt = fn(PromptInput, async (input) => {
    const session = await Session.get(input.sessionID)
    await SessionRevert.cleanup(session)

    const message = await createUserMessage(input)
    await Session.touch(input.sessionID)

    // this is backwards compatibility for allowing `tools` to be specified when
    // prompting
    const permissions: Permission.Ruleset = []
    for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
      permissions.push({
        permission: tool,
        action: enabled ? "allow" : "deny",
        pattern: "*",
      })
    }
    if (permissions.length > 0) {
      session.permission = permissions
      await Session.setPermission({ sessionID: session.id, permission: permissions })
    }

    if (input.noReply === true) {
      return message
    }

    return loop({ sessionID: input.sessionID })
  })

  export async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
    const parts: PromptInput["parts"] = [
      {
        type: "text",
        text: template,
      },
    ]
    const files = ConfigMarkdown.files(template)
    const seen = new Set<string>()
    await Promise.all(
      files.map(async (match) => {
        const name = match[1]
        if (seen.has(name)) return
        seen.add(name)
        const filepath = name.startsWith("~/")
          ? path.join(os.homedir(), name.slice(2))
          : path.resolve(Instance.worktree, name)

        const stats = await fs.stat(filepath).catch(() => undefined)
        if (!stats) {
          const agent = await Agent.get(name)
          if (agent) {
            parts.push({
              type: "agent",
              name: agent.name,
            })
          }
          return
        }

        if (stats.isDirectory()) {
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: "application/x-directory",
          })
          return
        }

        parts.push({
          type: "file",
          url: pathToFileURL(filepath).href,
          filename: name,
          mime: "text/plain",
        })
      }),
    )
    return parts
  }

  function start(sessionID: SessionID) {
    const s = state()
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
    }
    return controller.signal
  }

  function resume(sessionID: SessionID) {
    const s = state()
    if (!s[sessionID]) return

    return s[sessionID].abort.signal
  }

  async function finalizeAbort(sessionID: SessionID) {
    const now = Date.now()

    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role !== "assistant") continue

      let dirty = false

      for (const part of item.parts) {
        if (part.type !== "tool") continue
        if (part.state.status !== "pending" && part.state.status !== "running") continue

        dirty = true
        await Session.updatePart({
          ...part,
          state: {
            status: "error",
            input: part.state.input,
            error: "Tool execution aborted",
            metadata: "metadata" in part.state ? part.state.metadata : undefined,
            time: {
              start: part.state.status === "running" ? part.state.time.start : now,
              end: now,
            },
          },
        } satisfies MessageV2.ToolPart)
      }

      if (typeof item.info.time.completed === "number") continue

      dirty = true
      await Session.updateMessage({
        ...item.info,
        time: {
          ...item.info.time,
          completed: now,
        },
      })

      if (dirty) {
        log.info("finalize abort", {
          sessionID,
          messageID: item.info.id,
        })
      }
    }
  }

  export async function cancel(sessionID: SessionID) {
    log.info("cancel", { sessionID })
    console.log(`[aether-flow] backend-cancel-start session=${sessionID}`)
    diag(`stage=backend-cancel-start session=${sessionID}`)
    const s = state()
    const match = s[sessionID]
    if (match) {
      match.abort.abort()
      delete s[sessionID]
    }
    await finalizeAbort(sessionID)
    console.log(`[aether-flow] backend-cancel-before-idle session=${sessionID}`)
    diag(`stage=backend-cancel-before-idle session=${sessionID}`)
    await SessionStatus.set(sessionID, { type: "idle" })
    console.log(`[aether-flow] backend-cancel-after-idle session=${sessionID}`)
    diag(`stage=backend-cancel-after-idle session=${sessionID}`)
    return
  }

  export const LoopInput = z.object({
    sessionID: SessionID.zod,
    resume_existing: z.boolean().optional(),
  })
  export const loop = fn(LoopInput, async (input) => {
    const { sessionID, resume_existing } = input

    const abort = resume_existing ? resume(sessionID) : start(sessionID)
    if (!abort) {
      return new Promise<MessageV2.WithParts>((resolve, reject) => {
        const callbacks = state()[sessionID].callbacks
        callbacks.push({ resolve, reject })
      })
    }

    await using _ = defer(() => cancel(sessionID))

    // Structured output state
    // Note: On session resumption, state is reset but outputFormat is preserved
    // on the user message and will be retrieved from lastUser below
    let structuredOutput: unknown | undefined

    let step = 0
    const session = await Session.get(sessionID)
    while (true) {
      const loopStart = performance.now()
      await SessionStatus.set(sessionID, { type: "busy" })
      log.info("loop", { step, sessionID })
      log.info("tool-freeze prompt loop start", {
        sessionID,
        step,
        resumeExisting: resume_existing,
      })
      if (abort.aborted) break
      let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
      log.info("tool-freeze prompt messages ready", {
        sessionID,
        step,
        messages: msgs.length,
        took: Math.round(performance.now() - loopStart),
      })
      diag(
        `stage=prompt-messages-ready session=${sessionID} step=${step} messages=${msgs.length} took=${Math.round(performance.now() - loopStart)} tail="${safeText(summarizeSessionMessages(msgs))}"`,
      )

      let lastUser: MessageV2.User | undefined
      let lastAssistant: MessageV2.Assistant | undefined
      let lastFinished: MessageV2.Assistant | undefined
      let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        if (!lastUser && msg.info.role === "user") lastUser = msg.info as MessageV2.User
        if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as MessageV2.Assistant
        if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
          lastFinished = msg.info as MessageV2.Assistant
        if (lastUser && lastFinished) break
        const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
        if (task && !lastFinished) {
          tasks.push(...task)
        }
      }

      if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
      if (
        lastAssistant?.finish &&
        !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
        lastUser.id < lastAssistant.id
      ) {
        log.info("exiting loop", { sessionID })
        break
      }

      step++
      if (step === 1)
        ensureTitle({
          session,
          modelID: lastUser.model.modelID,
          providerID: lastUser.model.providerID,
          history: msgs,
        })

      const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch((e) => {
        if (Provider.ModelNotFoundError.isInstance(e)) {
          const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
          Bus.publish(Session.Event.Error, {
            sessionID,
            error: new NamedError.Unknown({
              message: `Model not found: ${e.data.providerID}/${e.data.modelID}.${hint}`,
            }).toObject(),
          })
        }
        throw e
      })
      const task = tasks.pop()

      // pending subtask
      // TODO: centralize "invoke tool" logic
      if (task?.type === "subtask") {
        const taskTool = await TaskTool.init()
        const taskModel = task.model ? await Provider.getModel(task.model.providerID, task.model.modelID) : model
        const assistantMessage = (await Session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: lastUser.id,
          sessionID,
          mode: task.agent,
          agent: task.agent,
          variant: lastUser.variant,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: taskModel.id,
          providerID: taskModel.providerID,
          time: {
            created: Date.now(),
          },
        })) as MessageV2.Assistant
        let part = (await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistantMessage.id,
          sessionID: assistantMessage.sessionID,
          type: "tool",
          callID: ulid(),
          tool: TaskTool.id,
          state: {
            status: "running",
            input: {
              prompt: task.prompt,
              description: task.description,
              subagent_type: task.agent,
              command: task.command,
            },
            time: {
              start: Date.now(),
            },
          },
        })) as MessageV2.ToolPart
        const taskArgs = {
          prompt: task.prompt,
          description: task.description,
          subagent_type: task.agent,
          command: task.command,
        }
        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: "task",
            sessionID,
            callID: part.id,
          },
          { args: taskArgs },
          hookOpts(sessionID, assistantMessage.id),
        )
        let executionError: Error | undefined
        const taskAgent = await Agent.get(task.agent)
        if (!taskAgent) {
          const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
          const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
          const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
          Bus.publish(Session.Event.Error, {
            sessionID,
            error: error.toObject(),
          })
          throw error
        }
        const taskCtx: Tool.Context = {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID: sessionID,
          abort,
          callID: part.callID,
          extra: { bypassAgentCheck: true },
          messages: msgs,
          async metadata(input) {
            part = (await Session.updatePart({
              ...part,
              type: "tool",
              state: {
                ...part.state,
                ...input,
              },
            } satisfies MessageV2.ToolPart)) as MessageV2.ToolPart
          },
          async ask(req) {
            await Permission.ask({
              ...req,
              sessionID: sessionID,
              ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
            })
          },
        }
        const result = await taskTool.execute(taskArgs, taskCtx).catch((error) => {
          executionError = error
          log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
          return undefined
        })
        const attachments = result?.attachments?.map((attachment) => ({
          ...attachment,
          id: PartID.ascending(),
          sessionID,
          messageID: assistantMessage.id,
        }))
        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: "task",
            sessionID,
            callID: part.id,
            args: taskArgs,
          },
          result,
          hookOpts(sessionID, assistantMessage.id),
        )
        assistantMessage.finish = "tool-calls"
        assistantMessage.time.completed = Date.now()
        await Session.updateMessage(assistantMessage)
        if (result && part.state.status === "running") {
          await Session.updatePart({
            ...part,
            state: {
              status: "completed",
              input: part.state.input,
              title: result.title,
              metadata: result.metadata,
              output: result.output,
              attachments,
              time: {
                ...part.state.time,
                end: Date.now(),
              },
            },
          } satisfies MessageV2.ToolPart)
        }
        if (!result) {
          await Session.updatePart({
            ...part,
            state: {
              status: "error",
              error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
              time: {
                start: part.state.status === "running" ? part.state.time.start : Date.now(),
                end: Date.now(),
              },
              metadata: "metadata" in part.state ? part.state.metadata : undefined,
              input: part.state.input,
            },
          } satisfies MessageV2.ToolPart)
        }

        if (task.command) {
          // Add synthetic user message to prevent certain reasoning models from erroring
          // If we create assistant messages w/ out user ones following mid loop thinking signatures
          // will be missing and it can cause errors for models like gemini for example
          const summaryUserMsg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID,
            role: "user",
            time: {
              created: Date.now(),
            },
            agent: lastUser.agent,
            model: lastUser.model,
          }
          await Session.updateMessage(summaryUserMsg)
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: summaryUserMsg.id,
            sessionID,
            type: "text",
            text: "Summarize the task tool output above and continue with your task.",
            synthetic: true,
          } satisfies MessageV2.TextPart)
        }

        continue
      }

      // pending compaction
      if (task?.type === "compaction") {
        const result = await SessionCompaction.process({
          messages: msgs,
          parentID: lastUser.id,
          abort,
          sessionID,
          auto: task.auto,
          overflow: task.overflow,
        })
        if (result === "stop") break
        continue
      }

      // context overflow, needs compaction
      if (
        lastFinished &&
        lastFinished.summary !== true &&
        (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
      ) {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
        })
        continue
      }

      // normal processing
      const normalStart = performance.now()
      log.info("tool-freeze prompt normal start", {
        sessionID,
        step,
        lastUser: lastUser.id,
        lastAssistant: lastAssistant?.id,
        lastFinished: lastFinished?.id,
      })
      diag(
        `stage=prompt-normal-start session=${sessionID} step=${step} lastUser=${lastUser.id} lastAssistant=${lastAssistant?.id ?? "none"} lastFinished=${lastFinished?.id ?? "none"} lastFinishedFinish=${lastFinished?.finish ?? "none"}`,
      )
      const agent = await Agent.get(lastUser.agent)
      if (!agent) {
        const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
        Bus.publish(Session.Event.Error, {
          sessionID,
          error: error.toObject(),
        })
        throw error
      }
      const maxSteps = agent.steps ?? Infinity
      const isLastStep = step >= maxSteps
      msgs = await insertReminders({
        messages: msgs,
        agent,
        session,
      })
      log.info("tool-freeze prompt normal context ready", {
        sessionID,
        step,
        agent: agent.name,
        messages: msgs.length,
        took: Math.round(performance.now() - normalStart),
      })

      const processor = SessionProcessor.create({
        assistantMessage: (await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: lastUser.id,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          variant: lastUser.variant,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
          sessionID,
        })) as MessageV2.Assistant,
        sessionID: sessionID,
        model,
        abort,
      })
      using _ = defer(() => InstructionPrompt.clear(processor.message.id))

      // Check if user explicitly invoked an agent via @ in this turn
      const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
      const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

      const resolveToolsStart = performance.now()
      const tools = await resolveTools({
        agent,
        session,
        model,
        tools: lastUser.tools,
        processor,
        bypassAgentCheck,
        messages: msgs,
      })
      log.info("tool-freeze prompt tools ready", {
        sessionID,
        step,
        count: Object.keys(tools).length,
        took: Math.round(performance.now() - resolveToolsStart),
        sinceNormalStart: Math.round(performance.now() - normalStart),
      })

      // Inject StructuredOutput tool if JSON schema mode enabled
      if (lastUser.format?.type === "json_schema") {
        tools["StructuredOutput"] = createStructuredOutputTool({
          schema: lastUser.format.schema,
          onSuccess(output) {
            structuredOutput = output
          },
        })
      }

      if (step === 1) {
        SessionSummary.summarize({
          sessionID: sessionID,
          messageID: lastUser.id,
        })
      }

      // Ephemerally wrap queued user messages with a reminder to stay on track
      if (step > 1 && lastFinished) {
        for (const msg of msgs) {
          if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
          for (const part of msg.parts) {
            if (part.type !== "text" || part.ignored || part.synthetic) continue
            if (!part.text.trim()) continue
            part.text = [
              "<system-reminder>",
              "The user sent the following message:",
              part.text,
              "",
              "Please address this message and continue with your tasks.",
              "</system-reminder>",
            ].join("\n")
          }
        }
      }

      const messagesTransformStart = performance.now()
      await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      log.info("tool-freeze prompt messages transform end", {
        sessionID,
        step,
        took: Math.round(performance.now() - messagesTransformStart),
        sinceNormalStart: Math.round(performance.now() - normalStart),
      })

      // Build system prompt, adding structured output instruction if needed
      const skills = await SystemPrompt.skills(agent)
      const system = [
        ...(await SystemPrompt.environment(model)),
        ...(skills ? [skills] : []),
        ...(await InstructionPrompt.system()),
      ]
      const format = lastUser.format ?? { type: "text" }
      if (format.type === "json_schema") {
        system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
      }
      log.info("tool-freeze prompt system ready", {
        sessionID,
        step,
        system: system.length,
        sinceNormalStart: Math.round(performance.now() - normalStart),
      })

      const responseBeforeStart = performance.now()
      await Plugin.trigger(
        "assistant.response.before",
        {
          sessionID,
          messageID: processor.message.id,
          parentID: lastUser.id,
          step,
          agent: agent.name,
          model: {
            providerID: model.providerID,
            modelID: model.id,
          },
        },
        {},
        hookOpts(sessionID, processor.message.id),
      )
      log.info("tool-freeze prompt response before end", {
        sessionID,
        step,
        messageID: processor.message.id,
        took: Math.round(performance.now() - responseBeforeStart),
        sinceNormalStart: Math.round(performance.now() - normalStart),
      })

      const modelMessages = MessageV2.toModelMessages(msgs, model)
      diag(
        `stage=prompt-model-messages-ready session=${sessionID} step=${step} count=${modelMessages.length} tail="${safeText(summarizeModelMessages(modelMessages))}"`,
      )
      log.info("tool-freeze prompt processor start", {
        sessionID,
        step,
        messageID: processor.message.id,
        messages: modelMessages.length,
        tools: Object.keys(tools).length,
        system: system.length,
        sinceNormalStart: Math.round(performance.now() - normalStart),
      })
      diag(
        `stage=prompt-processor-start session=${sessionID} step=${step} message=${processor.message.id} messages=${modelMessages.length} tools=${Object.keys(tools).length} system=${system.length} sinceNormalStart=${Math.round(performance.now() - normalStart)}`,
      )
      const processorStart = performance.now()
      const result = await processor.process({
        user: lastUser,
        agent,
        permission: session.permission,
        abort,
        sessionID,
        system: isLastStep ? [...system, MAX_STEPS] : system,
        messages: modelMessages,
        tools,
        model,
        toolChoice: format.type === "json_schema" ? "required" : undefined,
      })
      log.info("tool-freeze prompt processor end", {
        sessionID,
        step,
        messageID: processor.message.id,
        result,
        finish: processor.message.finish,
        took: Math.round(performance.now() - processorStart),
        sinceLoopStart: Math.round(performance.now() - loopStart),
      })
      diag(
        `stage=prompt-processor-end session=${sessionID} step=${step} message=${processor.message.id} result=${result} finish=${processor.message.finish ?? "none"} error=${processor.message.error ? 1 : 0} took=${Math.round(performance.now() - processorStart)} sinceLoopStart=${Math.round(performance.now() - loopStart)}`,
      )

      const responseAfterStart = performance.now()
      await Plugin.trigger(
        "assistant.response.after",
        {
          sessionID,
          messageID: processor.message.id,
          parentID: lastUser.id,
          step,
          agent: agent.name,
          model: {
            providerID: model.providerID,
            modelID: model.id,
          },
        },
        {
          finish: processor.message.finish,
          error: processor.message.error,
        },
        hookOpts(sessionID, processor.message.id),
      )
      log.info("tool-freeze prompt response after end", {
        sessionID,
        step,
        messageID: processor.message.id,
        took: Math.round(performance.now() - responseAfterStart),
        sinceLoopStart: Math.round(performance.now() - loopStart),
      })
      diag(
        `stage=prompt-response-after-end session=${sessionID} step=${step} message=${processor.message.id} took=${Math.round(performance.now() - responseAfterStart)} sinceLoopStart=${Math.round(performance.now() - loopStart)}`,
      )

      // If structured output was captured, save it and exit immediately
      // This takes priority because the StructuredOutput tool was called successfully
      if (structuredOutput !== undefined) {
        processor.message.structured = structuredOutput
        processor.message.finish = processor.message.finish ?? "stop"
        await Session.updateMessage(processor.message)
        break
      }

      // Check if model finished (finish reason is not "tool-calls" or "unknown")
      const modelFinished = processor.message.finish && !["tool-calls", "unknown"].includes(processor.message.finish)

      if (modelFinished && !processor.message.error) {
        if (format.type === "json_schema") {
          // Model stopped without calling StructuredOutput tool
          processor.message.error = new MessageV2.StructuredOutputError({
            message: "Model did not produce structured output",
            retries: 0,
          }).toObject()
          await Session.updateMessage(processor.message)
          break
        }
      }

      if (result === "stop") break
      if (result === "compact") {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
          overflow: !processor.message.finish,
        })
      }
      continue
    }
    SessionCompaction.prune({ sessionID })
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user") continue
      const queued = state()[sessionID]?.callbacks ?? []
      for (const q of queued) {
        q.resolve(item)
      }
      return item
    }
    throw new Error("Impossible")
  })

  async function lastModel(sessionID: SessionID) {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.model) return item.info.model
    }
    return Provider.defaultModel()
  }

  /** @internal Exported for testing */
  export async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
    messages: MessageV2.WithParts[]
  }) {
    using _ = log.time("resolveTools")
    const tools: Record<string, AITool> = {}

    const context = (args: any, options: ToolCallOptions): Tool.Context => ({
      sessionID: input.session.id,
      abort: options.abortSignal!,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck },
      agent: input.agent.name,
      messages: input.messages,
      metadata: async (val: { title?: string; metadata?: any }) => {
        const match = input.processor.partFromToolCall(options.toolCallId)
        if (match && match.state.status === "running") {
          await Session.updatePart({
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: {
                start: Date.now(),
              },
            },
          })
        }
      },
      async ask(req) {
        await Permission.ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
      },
    })

    for (const item of await ToolRegistry.tools(
      { modelID: ModelID.make(input.model.api.id), providerID: input.model.providerID },
      input.agent,
    )) {
      const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
      tools[item.id] = tool({
        id: item.id as any,
        description: item.description,
        inputSchema: jsonSchema(schema as any),
        async execute(args, options) {
          const ctx = context(args, options)
          const toolStart = performance.now()
          log.info("tool-freeze prompt tool execute start", {
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
            callID: ctx.callID,
            tool: item.id,
          })
          diag(
            `stage=prompt-tool-execute-start session=${ctx.sessionID} message=${input.processor.message.id} tool=${item.id} call=${ctx.callID}`,
          )
          await Plugin.trigger(
            "tool.execute.before",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
            },
            {
              args,
            },
            hookOpts(ctx.sessionID, input.processor.message.id),
          )
          log.info("tool-freeze prompt tool before end", {
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
            callID: ctx.callID,
            tool: item.id,
            took: Math.round(performance.now() - toolStart),
          })
          const executeStart = performance.now()
          const result = await item.execute(args, ctx)
          log.info("tool-freeze prompt tool execute result", {
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
            callID: ctx.callID,
            tool: item.id,
            took: Math.round(performance.now() - executeStart),
            total: Math.round(performance.now() - toolStart),
          })
          diag(
            `stage=prompt-tool-execute-result session=${ctx.sessionID} message=${input.processor.message.id} tool=${item.id} call=${ctx.callID} took=${Math.round(performance.now() - executeStart)} total=${Math.round(performance.now() - toolStart)}`,
          )
          const output = {
            ...result,
            attachments: result.attachments?.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
          }
          await Plugin.trigger(
            "tool.execute.after",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
              args,
            },
            output,
            hookOpts(ctx.sessionID, input.processor.message.id),
          )
          log.info("tool-freeze prompt tool after end", {
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
            callID: ctx.callID,
            tool: item.id,
            total: Math.round(performance.now() - toolStart),
          })
          diag(
            `stage=prompt-tool-after-end session=${ctx.sessionID} message=${input.processor.message.id} tool=${item.id} call=${ctx.callID} total=${Math.round(performance.now() - toolStart)}`,
          )
          return output
        },
        toModelOutput(result) {
          return toolOutput(result)
        },
      })
    }

    // Quick assistant cannot use MCP tools, so avoid blocking on MCP discovery.
    if (QuickAssistant.active(Instance.directory)) {
      return tools
    }

    for (const [key, item] of Object.entries(await MCP.tools())) {
      const execute = item.execute
      if (!execute) continue

      const transformed = ProviderTransform.schema(input.model, asSchema(item.inputSchema).jsonSchema)
      item.inputSchema = jsonSchema(transformed)
      // Wrap execute to add plugin hooks and format output
      item.execute = async (args, opts) => {
        const ctx = context(args, opts)

        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
          },
          {
            args,
          },
          hookOpts(ctx.sessionID, input.processor.message.id),
        )

        await ctx.ask({
          permission: key,
          metadata: {},
          patterns: ["*"],
          always: ["*"],
        })

        const result = await execute(args, opts)

        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
            args,
          },
          result,
          hookOpts(ctx.sessionID, input.processor.message.id),
        )

        const textParts: string[] = []
        const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []

        for (const contentItem of result.content) {
          if (contentItem.type === "text") {
            textParts.push(contentItem.text)
          } else if (contentItem.type === "image") {
            attachments.push({
              type: "file",
              mime: contentItem.mimeType,
              url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
            })
          } else if (contentItem.type === "resource") {
            const { resource } = contentItem
            if (resource.text) {
              textParts.push(resource.text)
            }
            if (resource.blob) {
              attachments.push({
                type: "file",
                mime: resource.mimeType ?? "application/octet-stream",
                url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                filename: resource.uri,
              })
            }
          }
        }

        const truncated = await Truncate.output(textParts.join("\n\n"), {}, input.agent)
        const metadata = {
          ...(result.metadata ?? {}),
          truncated: truncated.truncated,
          ...(truncated.truncated && { outputPath: truncated.outputPath }),
        }

        return {
          title: "",
          metadata,
          output: truncated.content,
          attachments: attachments.map((attachment) => ({
            ...attachment,
            id: PartID.ascending(),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
          content: result.content, // directly return content to preserve ordering when outputting to model
        }
      }
      tools[key] = item
    }

    return tools
  }

  /** @internal Exported for testing */
  export function createStructuredOutputTool(input: {
    schema: Record<string, any>
    onSuccess: (output: unknown) => void
  }): AITool {
    // Remove $schema property if present (not needed for tool input)
    const { $schema, ...toolSchema } = input.schema

    return tool({
      id: "StructuredOutput" as any,
      description: STRUCTURED_OUTPUT_DESCRIPTION,
      inputSchema: jsonSchema(toolSchema as any),
      async execute(args) {
        // AI SDK validates args against inputSchema before calling execute()
        input.onSuccess(args)
        return {
          output: "Structured output captured successfully.",
          title: "Structured Output",
          metadata: { valid: true },
        }
      },
      toModelOutput(result) {
        return {
          type: "text",
          value: result.output,
        }
      },
    })
  }

  async function createUserMessage(input: PromptInput) {
    const agentName = input.agent || (await Agent.defaultAgent())
    const agent = await Agent.get(agentName)
    if (!agent) {
      const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: error.toObject(),
      })
      throw error
    }

    const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const full =
      !input.variant && agent.variant
        ? await Provider.getModel(model.providerID, model.modelID).catch(() => undefined)
        : undefined
    const variant = input.variant ?? (agent.variant && full?.variants?.[agent.variant] ? agent.variant : undefined)

    const info: MessageV2.Info = {
      id: input.messageID ?? MessageID.ascending(),
      role: "user",
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      tools: input.tools,
      agent: agent.name,
      model,
      system: input.system,
      format: input.format,
      variant,
      command: input.command,
    }
    using _ = defer(() => InstructionPrompt.clear(info.id))

    type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
    const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
      ...part,
      id: part.id ? PartID.make(part.id) : PartID.ascending(),
    })

    const parts = await Promise.all(
      input.parts.map(async (part): Promise<Draft<MessageV2.Part>[]> => {
        if (part.type === "file") {
          // before checking the protocol we check if this is an mcp resource because it needs special handling
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })

            const pieces: Draft<MessageV2.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]

            try {
              const resourceContent = await MCP.readResource(clientName, uri)
              if (!resourceContent) {
                throw new Error(`Resource not found: ${clientName}/${uri}`)
              }

              // Handle different content types
              const contents = Array.isArray(resourceContent.contents)
                ? resourceContent.contents
                : [resourceContent.contents]

              for (const content of contents) {
                if ("text" in content && content.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: content.text as string,
                  })
                } else if ("blob" in content && content.blob) {
                  // Handle binary content if needed
                  const mimeType = "mimeType" in content ? content.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mimeType}]`,
                  })
                }
              }

              pieces.push({
                ...part,
                messageID: info.id,
                sessionID: input.sessionID,
              })
            } catch (error: unknown) {
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }

            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  {
                    ...part,
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }
              break
            case "file:":
              log.info("file", { mime: part.mime })
              // have to normalize, symbol search returns absolute paths
              // Decode the pathname since URL constructor doesn't automatically decode it
              const filepath = fileURLToPath(part.url)
              const s = Filesystem.stat(filepath)

              if (s?.isDirectory()) {
                part.mime = "application/x-directory"
              }

              if (part.mime === "text/plain") {
                let offset: number | undefined = undefined
                let limit: number | undefined = undefined
                const range = {
                  start: url.searchParams.get("start"),
                  end: url.searchParams.get("end"),
                }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  // some LSP servers (eg, gopls) don't give full range in
                  // workspace/symbol searches, so we'll try to find the
                  // symbol in the document to get the full range
                  if (start === end) {
                    const symbols = await LSP.documentSymbol(filePathURI).catch(() => [])
                    for (const symbol of symbols) {
                      let range: LSP.Range | undefined
                      if ("range" in symbol) {
                        range = symbol.range
                      } else if ("location" in symbol) {
                        range = symbol.location.range
                      }
                      if (range?.start?.line && range?.start?.line === start) {
                        start = range.start.line
                        end = range?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) {
                    limit = end - (offset - 1)
                  }
                }
                const args = { filePath: filepath, offset, limit }

                const pieces: Draft<MessageV2.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]

                await ReadTool.init()
                  .then(async (t) => {
                    const model = await Provider.getModel(info.model.providerID, info.model.modelID)
                    const readCtx: Tool.Context = {
                      sessionID: input.sessionID,
                      abort: new AbortController().signal,
                      agent: input.agent!,
                      messageID: info.id,
                      extra: { bypassCwdCheck: true, model },
                      messages: [],
                      metadata: async () => {},
                      ask: async () => {},
                    }
                    const result = await t.execute(args, readCtx)
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: result.output,
                    })
                    if (result.attachments?.length) {
                      pieces.push(
                        ...result.attachments.map((attachment) => ({
                          ...attachment,
                          synthetic: true,
                          filename: attachment.filename ?? part.filename,
                          messageID: info.id,
                          sessionID: input.sessionID,
                        })),
                      )
                    } else {
                      pieces.push({
                        ...part,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })
                    }
                  })
                  .catch((error) => {
                    log.error("failed to read file", { error })
                    const message = error instanceof Error ? error.message : error.toString()
                    Bus.publish(Session.Event.Error, {
                      sessionID: input.sessionID,
                      error: new NamedError.Unknown({
                        message,
                      }).toObject(),
                    })
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    })
                  })

                return pieces
              }

              if (part.mime === "application/x-directory") {
                const args = { filePath: filepath }
                const listCtx: Tool.Context = {
                  sessionID: input.sessionID,
                  abort: new AbortController().signal,
                  agent: input.agent!,
                  messageID: info.id,
                  extra: { bypassCwdCheck: true },
                  messages: [],
                  metadata: async () => {},
                  ask: async () => {},
                }
                const result = await ReadTool.init().then((t) => t.execute(args, listCtx))
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  },
                  {
                    ...part,
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }

              await FileTime.read(input.sessionID, filepath)
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                  synthetic: true,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url: `data:${part.mime};base64,` + (await Filesystem.readBytes(filepath)).toString("base64"),
                  mime: part.mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
          }
        }

        if (part.type === "agent") {
          // Check if this agent would be denied by task permission
          const perm = Permission.evaluate("task", part.name, agent.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            {
              ...part,
              messageID: info.id,
              sessionID: input.sessionID,
            },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              // An extra space is added here. Otherwise the 'Use' gets appended
              // to user's last word; making a combined word
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [
          {
            ...part,
            messageID: info.id,
            sessionID: input.sessionID,
          },
        ]
      }),
    ).then((x) => x.flat().map(assign))

    await Plugin.trigger(
      "chat.message",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: input.variant,
      },
      {
        message: info,
        parts,
      },
      hookOpts(input.sessionID, info.id),
    )

    const parsedInfo = MessageV2.Info.safeParse(info)
    if (!parsedInfo.success) {
      log.error("invalid user message before save", {
        sessionID: input.sessionID,
        messageID: info.id,
        agent: info.agent,
        model: info.model,
        issues: parsedInfo.error.issues,
      })
    }

    parts.forEach((part, index) => {
      const parsedPart = MessageV2.Part.safeParse(part)
      if (parsedPart.success) return
      log.error("invalid user part before save", {
        sessionID: input.sessionID,
        messageID: info.id,
        partID: part.id,
        partType: part.type,
        index,
        issues: parsedPart.error.issues,
        part,
      })
    })

    await Session.updateMessage(info)
    for (const part of parts) {
      await Session.updatePart(part)
    }

    return {
      info,
      parts,
    }
  }

  async function insertReminders(input: { messages: MessageV2.WithParts[]; agent: Agent.Info; session: Session.Info }) {
    const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
    if (!userMessage) return input.messages

    // Original logic when experimental plan mode is disabled
    if (!Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE) {
      if (input.agent.name === "plan") {
        userMessage.parts.push({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: PROMPT_PLAN,
          synthetic: true,
        })
      }
      const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
      if (wasPlan && input.agent.name === "build") {
        userMessage.parts.push({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: BUILD_SWITCH,
          synthetic: true,
        })
      }
      return input.messages
    }

    // New plan mode logic when flag is enabled
    const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")

    // Switching from plan mode to build mode
    if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
      const plan = Session.plan(input.session)
      const exists = await Filesystem.exists(plan)
      if (exists) {
        const part = await Session.updatePart({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text:
            BUILD_SWITCH + "\n\n" + `A plan file exists at ${plan}. You should execute on the plan defined within it`,
          synthetic: true,
        })
        userMessage.parts.push(part)
      }
      return input.messages
    }

    // Entering plan mode
    if (input.agent.name === "plan" && assistantMessage?.info.agent !== "plan") {
      const plan = Session.plan(input.session)
      const exists = await Filesystem.exists(plan)
      if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })
      const part = await Session.updatePart({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${exists ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.` : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`,
        synthetic: true,
      })
      userMessage.parts.push(part)
      return input.messages
    }
    return input.messages
  }

  export const ShellInput = z.object({
    sessionID: SessionID.zod,
    agent: z.string(),
    model: z
      .object({
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
      })
      .optional(),
    command: z.string(),
  })
  export type ShellInput = z.infer<typeof ShellInput>
  export async function shell(input: ShellInput) {
    const abort = start(input.sessionID)
    if (!abort) {
      throw new Session.BusyError(input.sessionID)
    }

    using _ = defer(() => {
      // If no queued callbacks, cancel (the default)
      const callbacks = state()[input.sessionID]?.callbacks ?? []
      if (callbacks.length === 0) {
        cancel(input.sessionID)
      } else {
        // Otherwise, trigger the session loop to process queued items
        loop({ sessionID: input.sessionID, resume_existing: true }).catch((error) => {
          log.error("session loop failed to resume after shell command", { sessionID: input.sessionID, error })
        })
      }
    })

    const session = await Session.get(input.sessionID)
    if (session.revert) {
      await SessionRevert.cleanup(session)
    }
    const agent = await Agent.get(input.agent)
    if (!agent) {
      const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: error.toObject(),
      })
      throw error
    }
    const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const userMsg: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      role: "user",
      agent: input.agent,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
    }
    await Session.updateMessage(userMsg)
    const userPart: MessageV2.Part = {
      type: "text",
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: input.sessionID,
      text: "The following tool was executed by the user",
      synthetic: true,
    }
    await Session.updatePart(userPart)

    const msg: MessageV2.Assistant = {
      id: MessageID.ascending(),
      sessionID: input.sessionID,
      parentID: userMsg.id,
      mode: input.agent,
      agent: input.agent,
      cost: 0,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      time: {
        created: Date.now(),
      },
      role: "assistant",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.modelID,
      providerID: model.providerID,
    }
    await Session.updateMessage(msg)
    const part: MessageV2.Part = {
      type: "tool",
      id: PartID.ascending(),
      messageID: msg.id,
      sessionID: input.sessionID,
      tool: "bash",
      callID: ulid(),
      state: {
        status: "running",
        time: {
          start: Date.now(),
        },
        input: {
          command: input.command,
        },
      },
    }
    await Session.updatePart(part)
    const shell = Shell.preferred()
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
    ).toLowerCase()

    const invocations: Record<string, { args: string[] }> = {
      nu: {
        args: ["-c", input.command],
      },
      fish: {
        args: ["-c", input.command],
      },
      zsh: {
        args: [
          "-c",
          "-l",
          `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
        ],
      },
      bash: {
        args: [
          "-c",
          "-l",
          `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
        ],
      },
      // Windows cmd
      cmd: {
        args: ["/c", input.command],
      },
      // Windows PowerShell
      powershell: {
        args: ["-NoProfile", "-Command", input.command],
      },
      pwsh: {
        args: ["-NoProfile", "-Command", input.command],
      },
      // Fallback: any shell that doesn't match those above
      //  - No -l, for max compatibility
      "": {
        args: ["-c", `${input.command}`],
      },
    }

    const matchingInvocation = invocations[shellName] ?? invocations[""]
    const args = matchingInvocation?.args

    const cwd = Instance.directory
    const shellEnv = await Plugin.trigger(
      "shell.env",
      { cwd, sessionID: input.sessionID, callID: part.callID },
      { env: {} },
      hookOpts(input.sessionID, msg.id),
    )
    const proc = spawn(shell, args, {
      cwd,
      detached: process.platform !== "win32",
      windowsHide: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...shellEnv.env,
        TERM: "dumb",
      },
    })

    let output = ""

    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        Session.updatePart(part)
      }
    })

    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        Session.updatePart(part)
      }
    })

    let aborted = false
    let exited = false

    const kill = () => Shell.killTree(proc, { exited: () => exited })

    if (abort.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill()
    }

    abort.addEventListener("abort", abortHandler, { once: true })

    await new Promise<void>((resolve) => {
      proc.on("close", () => {
        exited = true
        abort.removeEventListener("abort", abortHandler)
        resolve()
      })
    })

    if (aborted) {
      output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
    }
    msg.time.completed = Date.now()
    await Session.updateMessage(msg)
    if (part.state.status === "running") {
      part.state = {
        status: "completed",
        time: {
          ...part.state.time,
          end: Date.now(),
        },
        input: part.state.input,
        title: "",
        metadata: {
          output,
          description: "",
        },
        output,
      }
      await Session.updatePart(part)
    }
    return { info: msg, parts: [part] }
  }

  export const CommandInput = z.object({
    messageID: MessageID.zod.optional(),
    sessionID: SessionID.zod,
    agent: z.string().optional(),
    model: z.string().optional(),
    arguments: z.string(),
    command: z.string(),
    variant: z.string().optional(),
    parts: z
      .array(
        z.discriminatedUnion("type", [
          MessageV2.FilePart.omit({
            messageID: true,
            sessionID: true,
          }).partial({
            id: true,
          }),
        ]),
      )
      .optional(),
  })
  export type CommandInput = z.infer<typeof CommandInput>
  const bashRegex = /!`([^`]+)`/g
  // Match [Image N] as single token, quoted strings, or non-space sequences
  const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
  const placeholderRegex = /\$(\d+)/g
  const quoteTrimRegex = /^["']|["']$/g

  export function skillify(parts: PromptInput["parts"]) {
    const next: PromptInput["parts"] = []
    for (const part of parts) {
      if (part.type === "text") {
        next.push({
          ...part,
          synthetic: true,
          metadata: {
            ...part.metadata,
            kind: "skill-template",
          },
        })
        continue
      }
      next.push(part)
    }
    return next
  }
  /**
   * Regular expression to match @ file references in text
   * Matches @ followed by file paths, excluding commas, periods at end of sentences, and backticks
   * Does not match when preceded by word characters or backticks (to avoid email addresses and quoted references)
   */

  export async function command(input: CommandInput) {
    log.info("command", input)
    const command = await Command.get(input.command)
    if (!command) {
      const available = await Command.list().then((cmds) => cmds.map((c) => c.name))
      const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: error.toObject(),
      })
      throw error
    }
    const agentName = command.agent ?? input.agent ?? (await Agent.defaultAgent())

    const raw = input.arguments.match(argsRegex) ?? []
    const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

    const templateCommand = await command.template
    const isSkill = command.source === "skill"

    let template: string
    if (isSkill) {
      // Skills don't use $N placeholders — skip substitution to avoid
      // corrupting LaTeX / currency patterns like $1, $2 in SKILL.md content.
      // User arguments are appended via ARGUMENTS footer below.
      template = templateCommand
      if (input.arguments.trim()) {
        template = template + "\n\nARGUMENTS: " + input.arguments
      }
    } else {
      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      // Let the final placeholder swallow any extra arguments so prompts read naturally
      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      // If command doesn't explicitly handle arguments (no $N or $ARGUMENTS placeholders)
      // but user provided arguments, append them to the template
      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }
    }

    const shellMatches = ConfigMarkdown.shell(template)
    if (shellMatches.length > 0) {
      const sh = Shell.preferred()
      const results = await Promise.all(
        shellMatches.map(async ([, cmd]) => {
          const out = await Process.text([cmd], { shell: sh, nothrow: true })
          return out.text
        }),
      )
      let index = 0
      template = template.replace(bashRegex, () => results[index++])
    }
    template = template.trim()

    const taskModel = await (async () => {
      if (command.model) {
        return Provider.parseModel(command.model)
      }
      if (command.agent) {
        const cmdAgent = await Agent.get(command.agent)
        if (cmdAgent?.model) {
          return cmdAgent.model
        }
      }
      if (input.model) return Provider.parseModel(input.model)
      return await lastModel(input.sessionID)
    })()

    try {
      await Provider.getModel(taskModel.providerID, taskModel.modelID)
    } catch (e) {
      if (Provider.ModelNotFoundError.isInstance(e)) {
        const { providerID, modelID, suggestions } = e.data
        const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
        Bus.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
        })
      }
      throw e
    }
    const agent = await Agent.get(agentName)
    if (!agent) {
      const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: error.toObject(),
      })
      throw error
    }

    const templateParts = await resolvePromptParts(template)
    const isSubtask = (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
    let parts: typeof templateParts
    if (isSubtask) {
      parts = [
        {
          type: "subtask" as const,
          agent: agent.name,
          description: command.description ?? "",
          command: input.command,
          model: {
            providerID: taskModel.providerID,
            modelID: taskModel.modelID,
          },
          // TODO: how can we make task tool accept a more complex input?
          prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
        },
      ]
    } else if (isSkill) {
      // For skills: user arguments are displayed as the primary message,
      // the full skill template is sent as synthetic (hidden from UI, visible to LLM).
      const skillParts: typeof templateParts = []
      if (input.arguments.trim()) {
        skillParts.push({
          type: "text" as const,
          text: input.arguments,
        })
      }
      skillParts.push(...skillify(templateParts))
      parts = [...skillParts, ...(input.parts ?? [])]
    } else {
      parts = [...templateParts, ...(input.parts ?? [])]
    }

    const userAgent = isSubtask ? (input.agent ?? (await Agent.defaultAgent())) : agentName
    const userModel = isSubtask
      ? input.model
        ? Provider.parseModel(input.model)
        : await lastModel(input.sessionID)
      : taskModel

    await Plugin.trigger(
      "command.execute.before",
      {
        command: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
      },
      { parts },
      input.messageID ? hookOpts(input.sessionID, input.messageID) : undefined,
    )

    const result = (await prompt({
      sessionID: input.sessionID,
      messageID: input.messageID,
      model: userModel,
      agent: userAgent,
      parts,
      variant: input.variant,
      command: {
        name: input.command,
        source: command.source,
      },
    })) as MessageV2.WithParts

    Bus.publish(Command.Event.Executed, {
      name: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
      messageID: result.info.id,
    })

    return result
  }

  async function ensureTitle(input: {
    session: Session.Info
    history: MessageV2.WithParts[]
    providerID: ProviderID
    modelID: ModelID
  }) {
    const blocked = (model: Provider.Model) =>
      model.providerID === "anthropic" && (model.id === "claude-haiku-4-5" || model.id === "claude-haiku-4.5")
    const add = (list: Provider.Model[], model?: Provider.Model) => {
      if (!model || blocked(model)) return
      if (list.some((item) => item.providerID === model.providerID && item.id === model.id)) return
      list.push(model)
    }

    if (input.session.parentID) return
    if (!Session.isDefaultTitle(input.session.title)) return

    // Find first non-synthetic user message
    const firstRealUserIdx = input.history.findIndex(
      (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
    )
    if (firstRealUserIdx === -1) return

    const isFirst =
      input.history.filter((m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic))
        .length === 1
    if (!isFirst) return

    // Gather all messages up to and including the first real user message for context
    // This includes any shell/subtask executions that preceded the user's first prompt
    const contextMessages = input.history.slice(0, firstRealUserIdx + 1)
    const firstRealUser = contextMessages[firstRealUserIdx]

    // For subtask-only messages (from command invocations), extract the prompt directly
    // since toModelMessage converts subtask parts to generic "The following tool was executed by the user"
    const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
    const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

    const agent = await Agent.get("title")
    if (!agent) return
    const candidates: Provider.Model[] = []
    if (agent.model) {
      const model = await Provider.getModel(agent.model.providerID, agent.model.modelID).catch(() => undefined)
      add(candidates, model)
    }
    add(candidates, await Provider.getModel(input.providerID, input.modelID).catch(() => undefined))
    add(
      candidates,
      await Provider.getModel(ProviderID.make("AxonHub-anthropic"), ModelID.make("claude-haiku-4-5")).catch(
        () => undefined,
      ),
    )
    add(
      candidates,
      await Provider.getModel(ProviderID.make("AxonHub"), ModelID.make("gpt-5-nano")).catch(() => undefined),
    )
    add(candidates, await Provider.getSmallModel(input.providerID).catch(() => undefined))
    if (!candidates.length) return

    for (const model of candidates) {
      const result = await LLM.stream({
        agent,
        user: firstRealUser.info as MessageV2.User,
        system: [],
        small: false,
        tools: {},
        hooks: false,
        model,
        abort: new AbortController().signal,
        sessionID: input.session.id,
        retries: 1,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Generate a title for this conversation:\n" }],
          },
          ...(hasOnlySubtaskParts
            ? [
                {
                  role: "user" as const,
                  content: [{ type: "text" as const, text: subtaskParts.map((p) => p.prompt).join("\n") }],
                },
              ]
            : MessageV2.toModelMessages(contextMessages, model)),
        ],
      }).catch((error) => {
        log.warn("ensureTitle attempt failed", {
          providerID: model.providerID,
          modelID: model.id,
          error,
        })
        return undefined
      })
      if (!result) continue

      const text = await result.text.catch((error) => {
        log.warn("ensureTitle no text", {
          providerID: model.providerID,
          modelID: model.id,
          error,
        })
        return undefined
      })
      if (!text) continue

      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) continue

      const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      return Session.setTitle({ sessionID: input.session.id, title }).catch((err) => {
        if (NotFoundError.isInstance(err)) return
        throw err
      })
    }
  }

  export async function generateTitle(input: { sessionID: SessionID }) {
    const session = await Session.get(input.sessionID)
    const history = await Session.messages({ sessionID: input.sessionID })
    const blocked = (model: Provider.Model) =>
      model.providerID === "anthropic" && (model.id === "claude-haiku-4-5" || model.id === "claude-haiku-4.5")
    const add = (list: Provider.Model[], model?: Provider.Model) => {
      if (!model || blocked(model)) return
      if (list.some((item) => item.providerID === model.providerID && item.id === model.id)) return
      list.push(model)
    }

    // Find first non-synthetic user message
    const firstRealUserIdx = history.findIndex(
      (m: MessageV2.WithParts) =>
        m.info.role === "user" && !m.parts.every((p: MessageV2.Part) => "synthetic" in p && p.synthetic),
    )
    if (firstRealUserIdx === -1) throw new Error("No user messages found in session")

    const firstRealUser = history[firstRealUserIdx]

    // Extract text content from the user message
    const subtaskParts = firstRealUser.parts.filter(
      (p: MessageV2.Part) => p.type === "subtask",
    ) as MessageV2.SubtaskPart[]
    const hasOnlySubtaskParts =
      subtaskParts.length > 0 && firstRealUser.parts.every((p: MessageV2.Part) => p.type === "subtask")

    const textParts = firstRealUser.parts
      .filter((p: MessageV2.Part) => p.type === "text" && !("synthetic" in p && p.synthetic))
      .map((p) => (p as MessageV2.TextPart).text)
      .filter((t) => t.length > 0)

    const content = hasOnlySubtaskParts ? subtaskParts.map((p) => p.prompt).join("\n") : textParts.join("\n")

    if (!content) throw new Error("No text content found in user message")

    const agent = await Agent.get("title")
    if (!agent) throw new Error("Title agent not found")

    // Build a list of models to try in order:
    // 1. Title agent's configured model (if any)
    // 2. The session's original model (proven to work for chat)
    // 3. getSmallModel fallback from the session's provider
    const providerID = firstRealUser.info.role === "user" ? firstRealUser.info.model.providerID : ProviderID.anthropic
    const modelID =
      firstRealUser.info.role === "user" ? firstRealUser.info.model.modelID : ModelID.make("claude-3-5-sonnet-20241022")

    const candidates: Provider.Model[] = []
    if (agent.model) {
      add(candidates, await Provider.getModel(agent.model.providerID, agent.model.modelID).catch(() => undefined))
    }
    add(candidates, await Provider.getModel(providerID, modelID).catch(() => undefined))
    add(
      candidates,
      await Provider.getModel(ProviderID.make("AxonHub-anthropic"), ModelID.make("claude-haiku-4-5")).catch(
        () => undefined,
      ),
    )
    add(
      candidates,
      await Provider.getModel(ProviderID.make("AxonHub"), ModelID.make("gpt-5-nano")).catch(() => undefined),
    )
    add(candidates, await Provider.getSmallModel(providerID).catch(() => undefined))

    if (candidates.length === 0) throw new Error("No available model for title generation")

    const msg = "Generate a title for this conversation:\n" + content
    let lastError: unknown

    for (const model of candidates) {
      log.info("generateTitle", {
        sessionID: input.sessionID,
        providerID: model.providerID,
        modelID: model.id,
        contentLength: content.length,
        attempt: candidates.indexOf(model) + 1,
        total: candidates.length,
      })

      try {
        const result = await LLM.stream({
          agent,
          user: firstRealUser.info as MessageV2.User,
          system: [],
          small: false,
          tools: {},
          hooks: false,
          model,
          abort: new AbortController().signal,
          sessionID: input.sessionID,
          retries: 1,
          messages: [{ role: "user", content: [{ type: "text", text: msg }] }],
        })

        const text = await result.text

        if (!text) {
          lastError = new Error("Empty output from " + model.providerID + "/" + model.id)
          log.warn("generateTitle empty output, trying next", {
            providerID: model.providerID,
            modelID: model.id,
          })
          continue
        }

        const cleaned = text
          .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0)

        if (!cleaned) {
          lastError = new Error("Generated title is empty after cleaning from " + model.providerID + "/" + model.id)
          continue
        }

        const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
        return Session.setTitle({ sessionID: input.sessionID, title })
      } catch (err) {
        lastError = err
        log.warn("generateTitle attempt failed, trying next", {
          providerID: model.providerID,
          modelID: model.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    log.error("generateTitle all attempts failed", { error: lastError })
    throw lastError ?? new Error("Failed to generate title")
  }
}
