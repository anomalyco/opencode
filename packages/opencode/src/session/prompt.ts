import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"

import { type Tool as AITool, tool, jsonSchema, type ModelMessage } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import { MAX_STEPS_PROMPT } from "@opencode-ai/core/session/runner/max-steps"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@opencode-ai/core/shell"
import { ShellID } from "@/tool/shell/id"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { eq } from "drizzle-orm"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import { LLMEvent } from "@opencode-ai/llm"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)
const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024
const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

function mcpResourceBase64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

function formatMcpResourceBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
  // They are not pending work and must not trigger an assistant-prefill request.
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

// runLoop entry guard (hank): count consecutive assistant messages & pass through
function validateStrictTurnTaking(rawMsgs: SessionV1.WithParts[]): number {
  if (!rawMsgs || rawMsgs.length < 2) return 0
  let count = 0
  for (let i = 1; i < rawMsgs.length; i++) {
    // guards are for signal, not a crutch; provider 400s should surface the root cause not be hidden in memory ... find it, fix it
    if (rawMsgs[i - 1].info.role === "assistant" && rawMsgs[i].info.role === "assistant") count++
  }
  // return the count for tracing
  return count
}

// diagnostic helper (chasmic): does the post-compaction state still owe the
// user an answer? Compaction is a context-reduction step, not itself the final
// answer. A genuine pending continuation exists when there is an auto-continuation
// user ("Continue if you have next steps...") not yet conclusively answered, or an
// in-flight (non-conclusive) assistant turn. When compaction cleanly produced a
// summary that directly answers the last user (no continueMsg, no dangling tool
// work), there is nothing left to continue — chiron's early-exit would return.
// This detector is a canary for the producer gap: if the producer fails to emit a
// continueMsg after interrupting an in-flight turn, we surface it here instead of
// silently dropping the pending work.
export function hasPendingUserContinuation(msgs: SessionV1.WithParts[]): boolean {
  const { user, assistant, tasks } = MessageV2.latest(msgs)
  if (!user) return false
  if (tasks.length > 0) return true
  // No assistant turn yet → the (only) user is unanswered → pending.
  if (!assistant) return true
  // The latest assistant directly answers the LAST user: conclusive "stop" means
  // done; "length"/"tool-calls"/unset means the model still owes work.
  if (assistant.parentID === user.id) return assistant.finish !== "stop"
  // The latest assistant answers an OLDER user → the last user is unanswered → pending.
  return true
}

// B3b (fork B, adapter-compatible representation): The AI SDK
// `toModelMessagesEffect` emits a completed tool turn as ONE assistant message
// carrying both a `tool-call` and its `tool-result` content part. The
// `@ai-sdk/openai-compatible` adapter drops `tool-result` parts that live
// INSIDE an assistant message during wire serialization, leaving a dangling
// `tool_calls` (provider-400 risk). This helper post-processes the
// provider-format message list (localized to the request path) to NORMALIZE
// the wire: it hoists `tool-result` parts OUT OF assistant messages into the
// adapter-compatible shape — an assistant message with `tool_calls` followed
// by a separate `role: "tool"` message carrying the result.
type ContentPartLike = { type: string } & Record<string, unknown>

export function normalizeToolResultsFromAssistants(msgs: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const msg of msgs) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
      out.push(msg)
      continue
    }
    const content = msg.content as ContentPartLike[]
    const toolResults = content.filter((p) => p.type === "tool-result")
    const nonResults = content.filter((p) => p.type !== "tool-result")
    if (toolResults.length === 0) {
      out.push(msg)
      continue
    }
    // assistant message keeps text/reasoning/tool-call (drops the in-assistant tool-result)
    out.push({ ...msg, content: nonResults } as ModelMessage)
    // group tool-results into one role:"tool" message (preserving call order)
    out.push({ role: "tool", content: toolResults } as ModelMessage)
  }
  return out
}

// C2 — last-resort wire-format boundary repair (Phase 4: The Anvil). Runs on the
// wire right before streamText, in the SAME contained request path as B3b's
// normalize (NOT the shared toModelMessagesEffect, preserving the B3a rejection).
//
// PRINCIPLE: guards do NOT mutate. This is NOT a guard — it is a bounded,
// last-resort repair that DISCARDS ONLY a provably-contentless assistant. It
// never merges, never fabricates content, and never touches a real turn.
//
// WHY it exists: the Anvil proved the failure deterministically. A `finish=length`
// assistant with no content (no tool-result for B3b to hoist), separated from the
// next assistant by a user that renders to NO wire message, produces two adjacent
// assistant messages — the shape the provider rejects. The ROOT CAUSE is that
// toModelMessagesEffect silently DROPS a user with no renderable parts (its
// `userMessage.parts.length > 0` guard), removing the separator. The proper fix is
// at that source (priority 1, under scope); this pass is the thin safety net until
// it lands, and it discards ONLY the empty leading assistant that represents that
// dropped separator — it never removes meaningful content and never edits a real
// turn into a different shape.
//
// Discard predicate: the leading assistant must have NO tool-call part AND no
// non-whitespace text part (i.e. is contentless — an empty/truncated turn). If it
// carries any real content it is preserved untouched, even if adjacent.
export function dropContentlessAdjacentAssistant(msgs: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  const contentless = (m: ModelMessage): boolean => {
    if (!Array.isArray(m.content)) return false
    const parts = m.content as ContentPartLike[]
    const hasToolCall = parts.some((p) => p.type === "tool-call")
    const hasText = parts.some((p) => p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0)
    return !hasToolCall && !hasText
  }
  const isAssist = (m: ModelMessage | undefined): m is ModelMessage =>
    !!m && m.role === "assistant" && Array.isArray(m.content)
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const next = msgs[i + 1]
    // if a contentless assistant is immediately followed by another assistant,
    // it represents the dropped user separator / empty truncated turn — discard
    // it (no real content is lost). Otherwise pass it through untouched.
    if (isAssist(msg) && contentless(msg) && isAssist(next)) continue
    out.push(msg)
  }
  return out
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const { db } = database
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* Effect.logInfo("prompt: cancel", { "session.id": sessionID })
      yield* state.cancel(sessionID)
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionV1.WithParts[]
      providerID: ProviderV2.ID
      modelID: ModelV2.ID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: SessionV1.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError("prompt: failed to generate title", { error: Cause.squash(cause) }),
          ),
        )
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: SessionV1.SubtaskPart
      model: Provider.Model
      lastUser: SessionV1.User
      sessionID: SessionID
      session: Session.Info
      msgs: SessionV1.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: SessionV1.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: SessionV1.ToolPart = yield* sessions.updatePart({
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
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies SessionV1.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            return Effect.logError("prompt: subtask execution failed", {
              error,
              agent: task.agent,
              description: task.description,
            })
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies SessionV1.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies SessionV1.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: SessionV1.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: SessionV1.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: SessionV1.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const started = Date.now()
            const part: SessionV1.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              const completed = Date.now()
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  if (part.state.status === "running") {
                    part.state.metadata = { output }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ModelV2.ID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: SessionV1.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
      }

      const current = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (
        current.agent !== info.agent ||
        current.model?.providerID !== info.model.providerID ||
        current.model?.id !== info.model.modelID ||
        (current.model?.variant === "default" ? undefined : current.model?.variant) !== info.model.variant
      ) {
        yield* sessions.setAgentModel({
          sessionID: input.sessionID,
          agent: info.agent,
          model: {
            id: info.model.modelID,
            providerID: info.model.providerID,
            variant: info.model.variant ?? "default",
          },
          time: info.time.created,
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionV1.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            yield* Effect.logInfo("prompt: mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<SessionV1.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if (!c || typeof c !== "object") continue
                if ("text" in c && typeof c.text === "string" && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && typeof c.blob === "string" && c.blob) {
                  const mime = "mimeType" in c && typeof c.mimeType === "string" ? c.mimeType : part.mime
                  const filename = "uri" in c && typeof c.uri === "string" ? c.uri : part.filename
                  const size = mcpResourceBase64Size(c.blob)
                  if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) is not a supported attachment type]`,
                    })
                    continue
                  }
                  if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) exceeds ${formatMcpResourceBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
                    })
                    continue
                  }
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary MCP resource attached: ${filename ?? uri} (${mime})]`,
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "file",
                    mime,
                    filename,
                    url: `data:${mime};base64,${c.blob}`,
                  })
                }
              }
            } else {
              const error = Cause.squash(exit.cause)
              yield* Effect.logError("prompt: failed to read MCP resource", { error, clientName, uri })
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
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              break
            case "file:": {
              yield* Effect.logInfo("prompt: file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<SessionV1.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("prompt: failed to read file", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("prompt: failed to read directory", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
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
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = yield* Effect.forEach(resolvedParts, (part) =>
        part.type === "file" && part.mime.startsWith("image/")
          ? image.normalize(part).pipe(
              Effect.catchIf(
                (error) => error instanceof Image.ResizerUnavailableError,
                () => Effect.succeed(part),
              ),
            )
          : Effect.succeed(part),
      )

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        yield* Effect.logError("prompt: invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      for (const [index, part] of parts.entries()) {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) continue
        yield* Effect.logError("prompt: invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      }

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)

      return { info, parts }
    }, Effect.scoped)

    const prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error> = Effect.fn(
      "SessionPrompt.prompt",
    )(function* (input: PromptInput) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)

      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }

      if (input.noReply === true) return message
      return yield* loop({ sessionID: input.sessionID })
    })

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const runLoop: (sessionID: SessionID) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID) {
        const ctx = yield* InstanceState.context
        let structured: unknown
        let step = 0
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)

        // track consecutive compaction overflow failures to break the retry loop
        const MAX_COMPACTION_OVERFLOW = 1
        let compactionOverflowCount = 0

        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* Effect.logInfo("prompt: loop", { "session.id": sessionID, step })

          let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
            Effect.provideService(Database.Service, database),
          )

          // runLoop entry guards

          const msgsCountedAssistentsBeforeEntrance = validateStrictTurnTaking(msgs)
          const msgsMappedBeforeEntrance = msgs.map((m) => m.info.role)

          if (msgsCountedAssistentsBeforeEntrance > 0) {
            // log the detection of invalid consecutive assistant messages at the entrace
            yield* Effect.logDebug(
              "prompt: triage: step=" +
                step +
                " runLoop entry guard (hank): detected invalid consecutive assistant messages (not good)",
              {
                messages: msgs.length,
                msgsCountedAssistentsBeforeEntrance,
                msgsMappedBeforeEntrance,
                sessionID,
              },
            )
          } else {
            // log that all assistant messages are valid upon entry
            yield* Effect.logDebug(
              "prompt: triage: step=" +
                step +
                " runLoop entry guard (hank): all assistant messages are valid; no consecutive assistant messages detected (good)",
              {
                messages: msgs.length,
                sessionID,
              },
            )
          }

          // log the (primary) conversation tail
          yield* Effect.logDebug("prompt: triage: step=" + step + " conversation tail (asclepius)", {
            roles: msgs.slice(-5).map((m: SessionV1.WithParts) => ({
              finish: m.info.role === "assistant" ? m.info.finish : undefined,
              id: m.info.id,
              role: m.info.role,
            })),
            sessionID,
          })

          // handle.process() makes the exit decision and returns "stop" when the stream produced a conclusive finish (not tool-calls) [below]
          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)

          // guard against an invalid stream state missing a user origin message
          if (!lastUser)
            throw new Error("runLoop entry guard (kalfu): invalid stream state rejected (user message not found)")

          // early exit guard (chiron): if the last assistant is already finished
          // conclusively (no tool calls, not length), no tasks remain, and the
          // user was answered, break immediately instead of entering the
          // processor. Chiron is the healer who knows when treatment is complete
          // and the patient can be discharged — the analog to Asclepius
          // (medicine god), caduceus (the healer's staff / herald's staff),
          // hank & blart (the boundary guards).
          // This handles seed()-style scenarios where history already contains
          // a completed response. Only applies when the assistant has no active
          // tool parts — orphaned interrupted tools are excluded.
          //
          // Phase 2 (structural check, not ID ordering): "the user was answered"
          // is verified structurally via lastAssistant.parentID === lastUser.id
          // (the latest assistant is a direct response to the last user), instead
          // of the monotonic-ID comparison lastAssistant.id > lastUser.id.
          if (
            lastAssistant &&
            lastAssistant.finish &&
            lastAssistant.finish !== "tool-calls" &&
            lastAssistant.finish !== "length" &&
            lastAssistant.parentID === lastUser.id &&
            tasks.length === 0
          ) {
            const lastMsg = msgs.find((m) => m.info.id === lastAssistant.id)
            const hasActiveToolParts =
              lastMsg?.parts.some((p): p is SessionV1.ToolPart => p.type === "tool" && !isOrphanedInterruptedTool(p)) ??
              false
            if (!hasActiveToolParts) {
              yield* Effect.logDebug(
                "prompt: triage: step=" +
                  step +
                  " early exit guard (chiron): last assistant already finished conclusively; no active tools; returning",
                {
                  finish: lastAssistant.finish,
                  lastAssistantID: lastAssistant.id,
                  lastUserID: lastUser.id,
                  parentID: lastAssistant.parentID,
                  sessionID,
                },
              )
              if (lastMsg) return lastMsg
              break
            }
          }

          step++
          if (step === 1)
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          const task = tasks.pop()

          if (task && task.type === "subtask") {
            // log subtask handling
            yield* Effect.logDebug("prompt: triage: step=" + step + " task type=subtask", {
              messages: msgs.length,
              sessionID,
              tasks: tasks.length,
              taskAgent: task.agent,
              taskDescription:
                task.description?.length > 80 ? task.description.substring(0, 80) + "..." : task.description,
            })
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }

          if (task && task.type === "compaction") {
            // log compaction handling
            yield* Effect.logDebug("prompt: triage: step=" + step + " task type=compaction", {
              messages: msgs.length,
              sessionID,
              tasks: tasks.length,
              taskAuto: task.auto,
              taskOverflow: task.overflow,
            })
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            if (result.outcome === "stop") {
              // log compaction stop result (with the errored signal)
              yield* Effect.logDebug("prompt: triage: step=" + step + " task type=compaction result=stop", {
                sessionID,
                taskAuto: task.auto,
                taskOverflow: task.overflow,
                errored: result.errored,
              })
              // Phase 0b regression fix (2026-08-02): a non-overflow compaction
              // `stop` must NOT unconditionally break. Breaking on a SUCCESSFUL
              // compaction (summary written, errored=false) abandoned a still-
              // pending user — the loop `break` left the pending user unanswered
              // and the operator had to re-prompt (ses_03cbe6aebffesU2wcJSIvKtFF8).
              // We now break ONLY on a GENUINE compaction error (errored=true), and
              // only for the non-overflow case (a failed re-run of a still-too-large
              // context is a wasteful round-trip). A successful stop continues so the
              // fresh summary's pending user gets answered. Overflow keeps its bounded
              // retry via MAX_COMPACTION_OVERFLOW.
              if (!task.overflow && result.errored) {
                yield* Effect.logDebug(
                  "prompt: triage: step=" +
                    step +
                    " task type=compaction result=stop (non-overflow, errored, breaking)",
                  { sessionID, step },
                )
                break
              }
              if (!task.overflow) {
                // successful compaction (errored=false). Re-derive the fresh
                // post-compaction state to decide whether ANY pending continuation
                // genuinely remains. A clean-stop compaction that produced a
                // summary directly answering the last user (no continueMsg, no
                // dangling tool work) is TERMINAL — we break here instead of
                // doing a pointless continue that would immediately early-exit
                // via chiron and confuse the operator ("returned to user input").
                // We only continue when a real pending continuation exists.
                const post = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
                  Effect.provideService(Database.Service, database),
                )
                const pending = hasPendingUserContinuation(post)
                const lastUserAfter = MessageV2.latest(post).user?.id
                const lastAssistantAfter = MessageV2.latest(post).assistant
                yield* Effect.logDebug(
                  "prompt: triage: step=" +
                    step +
                    " task type=compaction result=stop (non-overflow, success) - evaluating pending continuation (chasmic)",
                  {
                    sessionID,
                    step,
                    postMessages: post.length,
                    lastUserAfter,
                    lastAssistantFinish: lastAssistantAfter?.finish,
                    pendingContinuation: pending,
                  },
                )
                if (!pending) {
                  yield* Effect.logDebug(
                    "prompt: triage: step=" +
                      step +
                      " task type=compaction result=stop (non-overflow, success, no pending continuation; breaking)",
                    { sessionID, step, postMessages: post.length },
                  )
                  break
                }
                yield* Effect.logDebug(
                  "prompt: triage: step=" +
                    step +
                    " task type=compaction result=stop (non-overflow, success, pending continuation detected; continuing to answer it)",
                  { sessionID, step, postMessages: post.length },
                )
                compactionOverflowCount = 0
                continue
              }
              compactionOverflowCount++
              if (compactionOverflowCount > MAX_COMPACTION_OVERFLOW) {
                // log that max overflow is what broke the loop
                yield* Effect.logInfo(
                  "prompt: compaction: step=" + step + " max overflow retries reached, breaking loop",
                  {
                    compactionOverflowCount,
                    messages: msgs.length,
                    sessionID,
                    step,
                  },
                )
                break
              }
              // log overflow retry state
              yield* Effect.logDebug("prompt: compaction: step=" + step + " overflow retry, continuing", {
                compactionOverflowCount,
                maxRetries: MAX_COMPACTION_OVERFLOW,
                messages: msgs.length,
                sessionID,
              })
              continue
            }
            yield* Effect.logDebug("prompt: triage: step=" + step + " task type=compaction completed", {
              sessionID,
            })
            compactionOverflowCount = 0
            continue
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            // log that compaction overflow was triggered
            yield* Effect.logDebug("prompt: triage: step=" + step + " compaction overflow triggered", {
              lastFinishedTokens: lastFinished.tokens,
              sessionID,
            })
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }

          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const maxSteps = agent.steps ?? Infinity
          const isLastStep = step >= maxSteps

          // log the step counter and maxSteps for tracing
          yield* Effect.logDebug("prompt: triage: step=" + step + " maxSteps and isLastStep", {
            isLastStep,
            maxSteps,
            sessionID,
          })

          msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
            Effect.provideService(RuntimeFlags.Service, flags),
            Effect.provideService(FSUtil.Service, fsys),
            Effect.provideService(Session.Service, sessions),
          )

          // use the current assistant message (same parentID, no completed time)
          let msg: SessionV1.Assistant | undefined
          for (const m of msgs) {
            if (m.info.role === "assistant") {
              const info = m.info as SessionV1.Assistant
              if (info.parentID === lastUser.id && !info.time?.completed) {
                msg = info
                break
              }
            }
          }

          if (!msg) {
            msg = {
              agent: agent.name,
              cost: 0,
              id: MessageID.ascending(),
              mode: agent.name,
              modelID: model.id,
              parentID: lastUser.id,
              path: { cwd: ctx.directory, root: ctx.worktree },
              providerID: model.providerID,
              role: "assistant",
              sessionID,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: Date.now() },
              variant: lastUser.model.variant,
            }
            yield* sessions.updateMessage(msg)
          }

          // prevent memory leaks & overflows ... stale database parts cause dangling assistant messages
          const withParts = msgs.find((m) => m.info.role === "assistant" && m.info.id === msg.id)

          // DIAGNOSTIC (channel = "caduceus-threaded"): detect the scenario where
          // a continuation iteration reuses an assistant that still carries tool
          // parts. The assistant's completed tool parts are preserved so B3b can
          // split them into the adapter-compatible `assistant(tool_calls)` +
          // `role:"tool"`(result) wire shape; stale pending/running tool parts
          // (no result yet) are dropped to avoid a dangling tool_calls. Log the
          // occurrence to inform future provider-specific refinements.
          if (
            step > 1 &&
            withParts?.parts.some((p) => p.type === "tool") &&
            model.api.npm === "@ai-sdk/openai-compatible"
          ) {
            yield* Effect.logDebug(
              "prompt: caduceus-threaded: continuation preserving completed tool parts for B3b split",
              {
                "session.id": sessionID,
                modelID: model.id,
                providerID: model.providerID,
                partCount: withParts.parts.length,
                step,
              },
            )
          }

          // Structural filter (fork B, caduceus-preserve): keep the reused
          // assistant's non-tool parts (text/reasoning) AND completed/errored
          // tool parts so the prior tool result survives to B3b serialization.
          // Only drop tool parts that have no result yet (pending/running),
          // which would otherwise render as a dangling tool_calls.
          //
          // Phase 3c (Caduceus Echo Fix): mark each PRESERVED tool part
          // providerExecuted: true so `toModelMessagesEffect` renders every tool
          // turn as a single self-contained assistant message (tool-call +
          // tool-result in one message). Without this, some turns render as one
          // message and others as two (assistant + tool), producing consecutive
          // assistants at the wire tail and a provider 400. The flag keeps the
          // rendering consistent so the B3b split hoists results correctly.
          if (withParts?.parts.length) {
            withParts.parts = withParts.parts.filter((part) => {
              if (part.type !== "tool") return true
              if (part.state.status === "pending" || part.state.status === "running") return false
              part.metadata = { ...(part.metadata ?? {}), providerExecuted: true }
              return true
            })
          }

          // log the (following) conversation tail
          yield* Effect.logDebug("prompt: triage: step=" + step + " conversation tail (caduceus)", {
            roles: msgs.slice(-5).map((m: SessionV1.WithParts) => ({
              finish: m.info.role === "assistant" ? m.info.finish : undefined,
              id: m.info.id,
              role: m.info.role,
            })),
            sessionID,
          })

          const finalizeInterruptedAssistant = Effect.gen(function* () {
            if (msg.time.completed) return
            msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
              providerID: msg.providerID,
              aborted: true,
            })
            msg.time.completed = Date.now()
            yield* sessions.updateMessage(msg)
          })

          const handle = yield* processor
            .create({
              assistantMessage: msg,
              sessionID,
              model,
              step,
            })
            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
            const promptOps = yield* ops()

            const tools = yield* SessionTools.resolve({
              agent,
              session,
              model,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
              promptOps,
            }).pipe(
              Effect.provideService(Plugin.Service, plugin),
              Effect.provideService(Permission.Service, permission),
              Effect.provideService(ToolRegistry.Service, registry),
              Effect.provideService(MCP.Service, mcp),
              Effect.provideService(Truncate.Service, truncate),
              Effect.provideService(RuntimeFlags.Service, flags),
            )

            if (lastUser.format?.type === "json_schema") {
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output
                },
              })
            }

            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            const [skills, env, instructions, mcpInstructions, modelMsgsRaw] = yield* Effect.all([
              sys.skills(agent),
              sys.environment(model),
              instruction.system().pipe(Effect.orDie),
              sys.mcp(agent, session.permission),
              MessageV2.toModelMessagesEffect(msgs, model),
            ])

            // B3b: hoist in-assistant tool-results into separate role:"tool"
            // messages so the openai-compatible adapter serializes a completed
            // tool turn without a dangling tool_calls.
            const modelMsgs = normalizeToolResultsFromAssistants(modelMsgsRaw)

            // C2 (last-resort, Phase 4: The Anvil): drop a contentless assistant
            // that sits adjacent to the next assistant (it represents a dropped
            // user separator / empty truncated turn). This is a bounded DISCARD
            // of provably-empty content only — never a merge, never a fabrication,
            // never touching a real turn. Guards stay detection-only; this is the
            // minimal post-normalize shape repair until the source renderer is fixed.
            const boundedModelMsgs = dropContentlessAdjacentAssistant(modelMsgs)

            // runLoop exit guard (blart): detect ANY consecutive assistant
            // messages across the ENTIRE provider-format list (not just the tail).
            // Phase 3c: the previous tail-only check was a false negative — it
            // passed when the wire list had an assistant,assistant pair mid-list
            // (e.g. tailRoles=["tool","assistant","tool"] at step 3), yet the
            // provider 400ed. Blart must make the failure visible in logs, not
            // the provider's 400, so we scan the full list for adjacency. It scans
            // the MERGED list (boundedModelMsgs) — after C2 the invariant should
            // always hold, so blart becomes a canary that logs if a NEW adjacency
            // source slips past the gate rather than a thing that merely reports
            // the very failure the gate prevents.
            const consecutiveAssistantIndices: number[] = []
            for (let i = 1; i < boundedModelMsgs.length; i++) {
              if (boundedModelMsgs[i - 1].role === "assistant" && boundedModelMsgs[i].role === "assistant") {
                consecutiveAssistantIndices.push(i)
              }
            }
            if (consecutiveAssistantIndices.length > 0) {
              // Sharpened blart (SNR, not SNL): for each consecutive assistant
              // pair, record enough to pinpoint the crux — is the LEADING
              // assistant a bare tool-call (tool-call part with NO following
              // role:"tool" result)? A tool whose output is truthfully null/empty
              // can fail to pair, leaving a dangling tool-call as a bare assistant
              // adjacent to the next assistant. That is exactly the shape the
              // provider rejects. Logging the leading assistant's tool-call part(s)
              // turns "there's a pair" into "this specific tool-call is dangling."
              // NOTE: after the C2 gate this should be unreachable — if blart fires
              // here, a NEW adjacency source slipped past the lifeboat.
              const pairDetail = consecutiveAssistantIndices.map((i) => {
                const leading = boundedModelMsgs[i - 1] as { role: string; content?: unknown }
                const leadingContent = Array.isArray(leading.content)
                  ? (leading.content as Array<{ type?: string; toolName?: string; toolCallId?: string }>)
                  : []
                const toolCalls = leadingContent.filter((p) => p.type === "tool-call")
                return {
                  index: i,
                  leadingHasToolCall: toolCalls.length > 0,
                  toolCallNames: toolCalls.map((p) => p.toolName),
                  toolCallIds: toolCalls.map((p) => p.toolCallId),
                }
              })
              // log the detection of consecutive assistant messages on exit
              yield* Effect.logDebug(
                "prompt: triage: step=" +
                  step +
                  " runLoop exit guard (blart): detected invalid consecutive assistant messages in the provider-format (not good)",
                {
                  consecutiveCount: consecutiveAssistantIndices.length,
                  consecutiveIndices: consecutiveAssistantIndices,
                  pairDetail,
                  messages: msgs.length,
                  modelMessages: boundedModelMsgs.length,
                  sessionID,
                  tailRoles: boundedModelMsgs.slice(-3).map((m) => m.role),
                },
              )
            } else {
              // log that all provider-format assistant messages are valid upon exit
              yield* Effect.logDebug(
                "prompt: triage: step=" +
                  step +
                  " runLoop exit guard (blart): all provider-format assistant messages are valid; no consecutive assistant messages detected in the provider-format (good)",
                {
                  messages: msgs.length,
                  modelMessages: boundedModelMsgs.length,
                  sessionID,
                },
              )
            }

            // the provider requires the final message to have alternating turns and will reject consecutive assistants with a 400
            // C2 (lifeboat): the wire that reaches the provider is the bounded list
            // (post-merge), guaranteeing no consecutive assistants regardless of a
            // dropped user separator.
            let finalMessages = boundedModelMsgs

            if (isLastStep) {
              finalMessages = [...finalMessages, { role: "assistant", content: MAX_STEPS_PROMPT }]

              // log the final message size context
              yield* Effect.logDebug("prompt: triage: step=" + step + " isLastStep: MAX_STEPS_PROMPT appended", {
                finalMessagesAfter: finalMessages.length,
                finalMessagesBefore: finalMessages.length - 1,
                lastRoleBefore: finalMessages.at(-2)?.role,
                messages: msgs.length,
                sessionID,
                tailRoles: finalMessages.slice(-3).map((m) => m.role),
              })
            } else {
              // log the final message size context sans MAX_STEPS_PROMPT
              yield* Effect.logDebug("prompt: triage: step=" + step + " isLastStep: MAX_STEPS_PROMPT not appended", {
                finalMessages: finalMessages.length,
                messages: msgs.length,
                sessionID,
                tailRoles: finalMessages.slice(-3).map((m) => m.role),
              })
            }

            const system = [
              ...env,
              ...instructions,
              ...(mcpInstructions ? [mcpInstructions] : []),
              ...(skills ? [skills] : []),
            ]
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
            const result = yield* handle.process({
              user: lastUser,
              agent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system,
              messages: finalMessages,
              tools,
              model,
              toolChoice: format.type === "json_schema" ? "required" : undefined,
            })

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              // Surface any content-filter finish (e.g. Anthropic stop_reason:
              // refusal) as an error. These turns may have produced no visible
              // output at all — previously the session went idle silently — or
              // partial text that was cut off by the provider's filter.
              if (handle.message.finish === "content-filter") {
                handle.message.error = new SessionV1.ContentFilterError({
                  message: "The response was blocked by the provider's content filter",
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                yield* events.publish(Session.Event.Error, { sessionID, error: handle.message.error })
                return "break" as const
              }
              if (format.type === "json_schema") {
                handle.message.error = new SessionV1.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            if (result === "stop") {
              // log the stop outcome
              yield* Effect.logDebug("prompt: triage: step=" + step + " handle.process returned result=stop", {
                handleMessageFinish: handle.message.finish,
                modelID: model.id,
                modelProviderID: model.providerID,
                sessionID,
              })

              // if finish is stop but the assistant still has pending or running
              // tool parts, the loop must continue to deliver tool results. load
              // from the db because the stream may have added tools there.
              if (handle.message.finish === "stop") {
                const parts = yield* MessageV2.parts(handle.message.id).pipe(
                  Effect.provideService(Database.Service, database),
                )
                const hasUnexecutedTools = parts.some(
                  (part) =>
                    part.type === "tool" &&
                    !isOrphanedInterruptedTool(part) &&
                    !part.metadata?.providerExecuted &&
                    (part.state.status === "pending" || part.state.status === "running"),
                )
                if (hasUnexecutedTools) {
                  yield* Effect.logDebug(
                    "prompt: triage: step=" + step + " finish=stop but unexecuted tools in db, continuing",
                    { sessionID, step },
                  )
                  return "continue" as const
                }
              }

              // A user message may have arrived NEXT in the sequence during this
              // iteration (e.g. via a queued prompt.prompt call) — one whose message
              // ID sorts after the assistant we just finished, meaning this turn did
              // NOT answer it. If so, continue the loop so that next user gets its own
              // LLM call. ("next" is structural — position in the sequence after this
              // turn — not a time-based value judgment such as "fresh" or "later".)
              const nextMsgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
                Effect.provideService(Database.Service, database),
              )
              const { user: nextUser } = MessageV2.latest(nextMsgs)
              if (nextUser && handle.message.id < nextUser.id) {
                yield* Effect.logDebug(
                  "prompt: triage: step=" + step + " stop finish but next user msg needs processing, continuing",
                  { sessionID, step, handleMessageID: handle.message.id, nextUserID: nextUser.id },
                )
                return "continue" as const
              }

              return "break" as const
            }
            if (result === "compact") {
              // log the compact outcome
              yield* Effect.logDebug("prompt: triage: step=" + step + " handle.process returned result=compact", {
                auto: true,
                lastUserAgent: lastUser.agent,
                lastUserModel: lastUser.model,
                messages: msgs.length,
                modelID: model.id,
                overflow: !handle.message.finish,
                sessionID,
              })
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
            }
            // log that the loop will continue for another iteration
            yield* Effect.logDebug("prompt: triage: step=" + step + " handle.process returned continue", {
              handleMessageFinish: handle.message.finish,
              handleMessageError: !!handle.message.error,
              messages: msgs.length,
              modelID: model.id,
              sessionID,
            })
            return "continue" as const
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant),
          )
          if (outcome === "break") {
            // log the break outcome
            yield* Effect.logDebug("prompt: triage: step=" + step + " outcome=break", {
              messages: msgs.length,
              sessionID,
            })
            // only run once on exit, not on every "continue" iteration, to prevent consecutive assistants from accumulating and overflowing the context
            if (!msg.time.completed) {
              msg.time.completed = Date.now()
              msg.finish = msg.finish ?? handle.message.finish ?? "stop"
              if (msg.finish === "content-filter" && !msg.error) {
                msg.error = new SessionV1.ContentFilterError({
                  message: "The response was blocked by the provider's content filter",
                }).toObject()
              }
              yield* sessions.updateMessage(msg)
              // log the message finalization
              yield* Effect.logDebug("prompt: triage: step=" + step + " finalize: MessageUpdated published", {
                completed: msg.time.completed,
                finish: msg.finish,
                messageID: msg.id,
                sessionID,
              })
            }
            break
          }
          // log the continue outcome
          yield* Effect.logDebug("prompt: triage: step=" + step + " outcome=continue", {
            messages: msgs.length,
            sessionID,
          })
          continue
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        return yield* lastAssistant(sessionID)
      },
    )

    const loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      return yield* state.ensureRunning(input.sessionID, lastAssistant(input.sessionID), runLoop(input.sessionID))
    })

    const shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      const ready = yield* Latch.make()
      return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* Effect.logInfo("prompt: command", {
        "session.id": input.sessionID,
        command: input.command,
        agent: input.agent,
      })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const inputFiles = new Set(
        input.parts?.filter((part) => new URL(part.url).protocol === "file:").map((part) => fileURLToPath(part.url)),
      )
      const uniqueTemplateParts = templateParts.filter(
        (part) => part.type !== "file" || !inputFiles.has(fileURLToPath(part.url)),
      )
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...uniqueTemplateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

const ModelRef = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(SessionV1.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  parts: Schema.Array(
    Schema.Union([
      SessionV1.TextPartInput,
      SessionV1.FilePartInput,
      SessionV1.AgentPartInput,
      SessionV1.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(SessionV1.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    SessionStatus.node,
    Session.node,
    Agent.node,
    Provider.node,
    SessionProcessor.node,
    SessionCompaction.node,
    Plugin.node,
    Command.node,
    Config.node,
    Permission.node,
    FSUtil.node,
    MCP.node,
    LSP.node,
    ToolRegistry.node,
    Truncate.node,
    Image.node,
    CrossSpawnSpawner.node,
    Instruction.node,
    SessionRunState.node,
    SessionRevert.node,
    SessionSummary.node,
    SystemPrompt.node,
    LLM.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
    Database.node,
  ],
})

export * as SessionPrompt from "./prompt"
