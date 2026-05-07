import path from "path"
import os from "os"
import z from "zod"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { SessionCompaction } from "./compaction"
import { Bus } from "../bus"
import { ProviderTransform } from "../provider/transform"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import { Flag } from "../flag/flag"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { ConfigMarkdown } from "../config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@/shell/shell"
import { AppFileSystem } from "@/filesystem"
import { Truncate } from "@/tool/truncate"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Deferred, Effect, Exit, Layer, Option, Scope, Context } from "effect"
import { EffectLogger } from "@/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { SessionPending } from "./pending"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

  export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })
  const elog = EffectLogger.create({ service: "session.prompt" })

  export interface Interface {
    readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
    readonly isForegroundStarting: (sessionID: SessionID) => Effect.Effect<boolean>
    readonly prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts, unknown>
    readonly promptAsync: (input: PromptInput) => Effect.Effect<void, unknown>
    readonly enqueuePrompt: (input: PromptInput) => Effect.Effect<void, unknown>
    readonly activatePending: (sessionID: SessionID) => Effect.Effect<void>
    readonly snapshotPendingDraft: (
      sessionID: SessionID,
      draft: SessionPending.Draft,
    ) => Effect.Effect<SessionPending.Draft>
    readonly loop: (input: z.infer<typeof LoopInput>) => Effect.Effect<MessageV2.WithParts, unknown>
    readonly shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts, unknown>
    readonly command: (input: CommandInput) => Effect.Effect<MessageV2.WithParts, unknown>
    readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const status = yield* SessionStatus.Service
      const sessions = yield* Session.Service
      const agents = yield* Agent.Service
      const provider = yield* Provider.Service
      const processor = yield* SessionProcessor.Service
      const compaction = yield* SessionCompaction.Service
      const plugin = yield* Plugin.Service
      const commands = yield* Command.Service
      const permission = yield* Permission.Service
      const fsys = yield* AppFileSystem.Service
      const mcp = yield* MCP.Service
      const lsp = yield* LSP.Service
      const filetime = yield* FileTime.Service
      const registry = yield* ToolRegistry.Service
      const truncate = yield* Truncate.Service
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const scope = yield* Scope.Scope
      const instruction = yield* Instruction.Service
      const state = yield* SessionRunState.Service
      const revert = yield* SessionRevert.Service
      const sys = yield* SystemPrompt.Service
      const llm = yield* LLM.Service
      const pending = yield* SessionPending.Service

      const run = {
        promise: <A, E>(effect: Effect.Effect<A, E>) =>
          Effect.runPromise(effect.pipe(Effect.provide(EffectLogger.layer))),
        fork: <A, E>(effect: Effect.Effect<A, E>) => Effect.runFork(effect.pipe(Effect.provide(EffectLogger.layer))),
      }
      type AssistantWithParts = MessageV2.WithParts & { info: MessageV2.Assistant }
      type PromptResultEffect = Effect.Effect<MessageV2.WithParts, unknown, never>
      type AssistantResultEffect = Effect.Effect<AssistantWithParts, unknown, never>
      type ForegroundStart = {
        accepted: Deferred.Deferred<void, unknown>
        result: Deferred.Deferred<MessageV2.WithParts, unknown>
      }
      type ForegroundStartupReservation = symbol
      const queuePumpRunning = new Set<SessionID>()
      const foregroundStarting = new Map<SessionID, ForegroundStartupReservation>()
      const foregroundStartupCancelled = new Set<ForegroundStartupReservation>()
      type NoReplyPendingState = "pending" | "running-queue" | "running-steer"
      const noReplyPendingItems = new Map<
        string,
        {
          sessionID: SessionID
          state: NoReplyPendingState
        }
      >()

      const clearNoReplyPendingItem = Effect.fn("SessionPrompt.clearNoReplyPendingItem")(function* (itemID: string) {
        noReplyPendingItems.delete(itemID)
      })

      const clearRunningNoReplySteers = Effect.fn("SessionPrompt.clearRunningNoReplySteers")(function* (
        sessionID: SessionID,
      ) {
        for (const [itemID, item] of noReplyPendingItems.entries()) {
          if (item.sessionID !== sessionID || item.state !== "running-steer") continue
          yield* clearNoReplyPendingItem(itemID)
        }
      })

      const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
        yield* elog.info("cancel", { sessionID })
        const reservation = foregroundStarting.get(sessionID)
        if (reservation) foregroundStartupCancelled.add(reservation)
        yield* state.cancel(sessionID)
        yield* pending.refresh(sessionID)
      })

      const isForegroundStarting = Effect.fn("SessionPrompt.isForegroundStarting")(function* (sessionID: SessionID) {
        return foregroundStarting.has(sessionID)
      })

      const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
        const ctx = yield* InstanceState.context
        const parts: PromptInput["parts"] = [{ type: "text", text: template }]
        const files = ConfigMarkdown.files(template)
        const seen = new Set<string>()
        yield* Effect.forEach(
          files,
          Effect.fnUntraced(function* (match) {
            const name = match[1]
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
        history: MessageV2.WithParts[]
        providerID: ProviderID
        modelID: ModelID
      }) {
        if (input.session.parentID) return
        if (!Session.isDefaultTitle(input.session.title)) return

        const real = (m: MessageV2.WithParts) =>
          m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
        const idx = input.history.findIndex(real)
        if (idx === -1) return
        if (input.history.filter(real).length !== 1) return

        const context = input.history.slice(0, idx + 1)
        const firstUser = context[idx]
        if (!firstUser || firstUser.info.role !== "user") return
        const firstInfo = firstUser.info

        const subtasks = firstUser.parts.filter((p): p is MessageV2.SubtaskPart => p.type === "subtask")
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
            Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
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
          .pipe(Effect.catchCause((cause) => elog.error("failed to generate title", { error: Cause.squash(cause) })))
      })

      const insertReminders = Effect.fn("SessionPrompt.insertReminders")(function* (input: {
        messages: MessageV2.WithParts[]
        agent: Agent.Info
        session: Session.Info
      }) {
        const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
        if (!userMessage) return input.messages

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

        const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
        if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
          const plan = Session.plan(input.session)
          if (!(yield* fsys.existsSafe(plan))) return input.messages
          const part = yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text:
              BUILD_SWITCH + "\n\n" + `A plan file exists at ${plan}. You should execute on the plan defined within it`,
            synthetic: true,
          })
          userMessage.parts.push(part)
          return input.messages
        }

        if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

        const plan = Session.plan(input.session)
        const exists = yield* fsys.existsSafe(plan)
        if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
        const part = yield* sessions.updatePart({
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
      })

      const resolveTools = Effect.fn("SessionPrompt.resolveTools")(function* (input: {
        agent: Agent.Info
        model: Provider.Model
        session: Session.Info
        tools?: Record<string, boolean>
        processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
        bypassAgentCheck: boolean
        messages: MessageV2.WithParts[]
      }) {
        using _ = log.time("resolveTools")
        const tools: Record<string, AITool> = {}

        const context = (args: any, options: ToolExecutionOptions): Tool.Context => ({
          sessionID: input.session.id,
          abort: options.abortSignal!,
          messageID: input.processor.message.id,
          callID: options.toolCallId,
          extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps },
          agent: input.agent.name,
          messages: input.messages,
          metadata: (val) =>
            input.processor.updateToolCall(options.toolCallId, (match) => {
              if (!["running", "pending"].includes(match.state.status)) return match
              return {
                ...match,
                state: {
                  title: val.title,
                  metadata: val.metadata,
                  status: "running",
                  input: args,
                  time: { start: Date.now() },
                },
              }
            }),
          ask: (req) =>
            permission
              .ask({
                ...req,
                sessionID: input.session.id,
                tool: { messageID: input.processor.message.id, callID: options.toolCallId },
                ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })

        for (const item of yield* registry.tools({
          modelID: ModelID.make(input.model.api.id),
          providerID: input.model.providerID,
          agent: input.agent,
        })) {
          const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
          tools[item.id] = tool({
            id: item.id as any,
            description: item.description,
            inputSchema: jsonSchema(schema as any),
            execute(args, options) {
              return run.promise(
                Effect.gen(function* () {
                  const ctx = context(args, options)
                  yield* plugin.trigger(
                    "tool.execute.before",
                    { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
                    { args },
                  )
                  const result = yield* item.execute(args, ctx)
                  const output = {
                    ...result,
                    attachments: result.attachments?.map((attachment) => ({
                      ...attachment,
                      id: PartID.ascending(),
                      sessionID: ctx.sessionID,
                      messageID: input.processor.message.id,
                    })),
                  }
                  yield* plugin.trigger(
                    "tool.execute.after",
                    { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
                    output,
                  )
                  if (options.abortSignal?.aborted) {
                    yield* input.processor.completeToolCall(options.toolCallId, output)
                  }
                  return output
                }),
              )
            },
          })
        }

        for (const [key, item] of Object.entries(yield* mcp.tools())) {
          const execute = item.execute
          if (!execute) continue

          const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
          const transformed = ProviderTransform.schema(input.model, schema)
          item.inputSchema = jsonSchema(transformed)
          item.execute = (args, opts) =>
            run.promise(
              Effect.gen(function* () {
                const ctx = context(args, opts)
                yield* plugin.trigger(
                  "tool.execute.before",
                  { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
                  { args },
                )
                yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
                const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.promise(() =>
                  execute(args, opts),
                )
                yield* plugin.trigger(
                  "tool.execute.after",
                  { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
                  result,
                )

                const textParts: string[] = []
                const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
                for (const contentItem of result.content) {
                  if (contentItem.type === "text") textParts.push(contentItem.text)
                  else if (contentItem.type === "image") {
                    attachments.push({
                      type: "file",
                      mime: contentItem.mimeType,
                      url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                    })
                  } else if (contentItem.type === "resource") {
                    const { resource } = contentItem
                    if (resource.text) textParts.push(resource.text)
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

                const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
                const metadata = {
                  ...(result.metadata ?? {}),
                  truncated: truncated.truncated,
                  ...(truncated.truncated && { outputPath: truncated.outputPath }),
                }

                const output = {
                  title: "",
                  metadata,
                  output: truncated.content,
                  attachments: attachments.map((attachment) => ({
                    ...attachment,
                    id: PartID.ascending(),
                    sessionID: ctx.sessionID,
                    messageID: input.processor.message.id,
                  })),
                  content: result.content,
                }
                if (opts.abortSignal?.aborted) {
                  yield* input.processor.completeToolCall(opts.toolCallId, output)
                }
                return output
              }),
            )
          tools[key] = item
        }

        return tools
      })

      const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
        task: MessageV2.SubtaskPart
        model: Provider.Model
        lastUser: MessageV2.User
        sessionID: SessionID
        session: Session.Info
        msgs: MessageV2.WithParts[]
      }) {
        const { task, model, lastUser, sessionID, session, msgs } = input
        const ctx = yield* InstanceState.context
        const { task: taskTool } = yield* registry.named()
        const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
        const assistantMessage: MessageV2.Assistant = yield* sessions.updateMessage({
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
        let part: MessageV2.ToolPart = yield* sessions.updatePart({
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
          yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
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
                } satisfies MessageV2.ToolPart)
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
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.failCause(cause)
              }
              const defect = Cause.squash(cause)
              error = defect instanceof Error ? defect : new Error(String(defect))
              log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
              return Effect.void
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
                  } satisfies MessageV2.ToolPart)
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
          } satisfies MessageV2.ToolPart)
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
          } satisfies MessageV2.ToolPart)
        }

        if (!task.command) return

        const summaryUserMsg: MessageV2.User = {
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
        } satisfies MessageV2.TextPart)
      })

      const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput) {
        const { ctx, msg, part } = yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* lastModel(input.sessionID))
            const userMsg: MessageV2.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: MessageV2.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: MessageV2.Assistant = {
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
            const part: MessageV2.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: "bash",
              callID: ulid(),
              state: {
                status: "running",
                time: { start: Date.now() },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            return { ctx, msg, part }
          }),
        )

        const sh = Shell.preferred()
        const shellName = (
          process.platform === "win32" ? path.win32.basename(sh, ".exe") : path.basename(sh)
        ).toLowerCase()
        const invocations: Record<string, { args: string[] }> = {
          nu: { args: ["-c", input.command] },
          fish: { args: ["-c", input.command] },
          zsh: {
            args: [
              "-l",
              "-c",
              `
                __oc_cwd=$PWD
                [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
                [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
                cd "$__oc_cwd"
                eval ${JSON.stringify(input.command)}
              `,
            ],
          },
          bash: {
            args: [
              "-l",
              "-c",
              `
                __oc_cwd=$PWD
                shopt -s expand_aliases
                [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
                cd "$__oc_cwd"
                eval ${JSON.stringify(input.command)}
              `,
            ],
          },
          cmd: { args: ["/c", input.command] },
          powershell: { args: ["-NoProfile", "-Command", input.command] },
          pwsh: { args: ["-NoProfile", "-Command", input.command] },
          "": { args: ["-c", input.command] },
        }

        const args = (invocations[shellName] ?? invocations[""]).args
        const cwd = ctx.directory
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

        let output = ""
        let aborted = false

        const finish = Effect.uninterruptible(
          Effect.gen(function* () {
            if (aborted) {
              output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
            }
            if (!msg.time.completed) {
              msg.time.completed = Date.now()
              yield* sessions.updateMessage(msg)
            }
            if (part.state.status === "running") {
              part.state = {
                status: "completed",
                time: { ...part.state.time, end: Date.now() },
                input: part.state.input,
                title: "",
                metadata: { output, description: "" },
                output,
              }
              yield* sessions.updatePart(part)
            }
          }),
        )

        const exit = yield* Effect.gen(function* () {
          const handle = yield* spawner.spawn(cmd)
          yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
            Effect.sync(() => {
              output += chunk
              if (part.state.status === "running") {
                part.state.metadata = { output, description: "" }
                void run.fork(sessions.updatePart(part))
              }
            }),
          )
          yield* handle.exitCode
        }).pipe(
          Effect.scoped,
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              aborted = true
            }),
          ),
          Effect.orDie,
          Effect.ensuring(finish),
          Effect.exit,
        )

        if (Exit.isFailure(exit)) {
          if (aborted || Cause.hasInterruptsOnly(exit.cause)) {
            return { info: msg, parts: [part] }
          }
          return yield* Effect.failCause(exit.cause)
        }

        return { info: msg, parts: [part] }
      })

      const getModel = Effect.fn("SessionPrompt.getModel")(function* (
        providerID: ProviderID,
        modelID: ModelID,
        sessionID: SessionID,
      ) {
        const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
        if (Exit.isSuccess(exit)) return exit.value
        const err = Cause.squash(exit.cause)
        if (Provider.ModelNotFoundError.isInstance(err)) {
          const hint = err.data.suggestions?.length ? ` Did you mean: ${err.data.suggestions.join(", ")}?` : ""
          yield* bus.publish(Session.Event.Error, {
            sessionID,
            error: new NamedError.Unknown({
              message: `Model not found: ${err.data.providerID}/${err.data.modelID}.${hint}`,
            }).toObject(),
          })
        }
        return yield* Effect.failCause(exit.cause)
      })

      const lastModel = Effect.fnUntraced(function* (sessionID: SessionID) {
        const match = yield* sessions.findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
        return yield* provider.defaultModel()
      })

      const resolvePromptIdentity = Effect.fn("SessionPrompt.resolvePromptIdentity")(function* (input: PromptInput) {
        const agentName = input.agent || (yield* agents.defaultAgent())
        const ag = yield* agents.get(agentName)
        if (!ag) {
          const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
          const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
          const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
          yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
          throw error
        }

        const model = input.model ?? ag.model ?? (yield* lastModel(input.sessionID))
        const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
        const full =
          !input.variant && ag.variant && same
            ? yield* provider.getModel(model.providerID, model.modelID).pipe(Effect.catchDefect(() => Effect.void))
            : undefined
        const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)
        return { agentName: ag.name, model, variant }
      })

      const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
        const { agentName, model, variant } = yield* resolvePromptIdentity(input)

        const info: MessageV2.User = {
          id: input.messageID ?? MessageID.ascending(),
          role: "user",
          sessionID: input.sessionID,
          time: { created: Date.now() },
          tools: input.tools,
          agent: agentName,
          model: {
            providerID: model.providerID,
            modelID: model.modelID,
            variant,
          },
          system: input.system,
          format: input.format,
        }
        const currentAgent = yield* agents.get(info.agent)
        if (!currentAgent) {
          throw new Error(`Agent not found while creating message: "${info.agent}"`)
        }

        yield* Effect.addFinalizer(() => instruction.clear(info.id))

        type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
        const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
          ...part,
          id: part.id ? PartID.make(part.id) : PartID.ascending(),
        })

        const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<MessageV2.Part>[]> = Effect.fn(
          "SessionPrompt.resolveUserPart",
        )(function* (part) {
          if (part.type === "file") {
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
              const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
              if (Exit.isSuccess(exit)) {
                const content = exit.value
                if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
                const items = Array.isArray(content.contents) ? content.contents : [content.contents]
                for (const c of items) {
                  if ("text" in c && c.text) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: c.text,
                    })
                  } else if ("blob" in c && c.blob) {
                    const mime = "mimeType" in c ? c.mimeType : part.mime
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary content: ${mime}]`,
                    })
                  }
                }
                pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
              } else {
                const error = Cause.squash(exit.cause)
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
                    { ...part, messageID: info.id, sessionID: input.sessionID },
                  ]
                }
                break
              case "file:": {
                log.info("file", { mime: part.mime })
                const filepath = fileURLToPath(part.url)
                if (yield* fsys.isDir(filepath)) part.mime = "application/x-directory"

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

                if (part.mime === "text/plain") {
                  let offset: number | undefined
                  let limit: number | undefined
                  const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                  if (range.start != null) {
                    const filePathURI = part.url.split("?")[0]
                    let start = parseInt(range.start)
                    let end = range.end ? parseInt(range.end) : undefined
                    if (start === end) {
                      const symbols = yield* lsp
                        .documentSymbol(filePathURI)
                        .pipe(Effect.catch(() => Effect.succeed([])))
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
                  const pieces: Draft<MessageV2.Part>[] = [
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
                      pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
                    }
                  } else {
                    const error = Cause.squash(exit.cause)
                    log.error("failed to read file", { error })
                    const message = error instanceof Error ? error.message : String(error)
                    yield* bus.publish(Session.Event.Error, {
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

                if (part.mime === "application/x-directory") {
                  const args = { filePath: filepath }
                  const exit = yield* execRead(args).pipe(Effect.exit)
                  if (Exit.isFailure(exit)) {
                    const error = Cause.squash(exit.cause)
                    log.error("failed to read directory", { error })
                    const message = error instanceof Error ? error.message : String(error)
                    yield* bus.publish(Session.Event.Error, {
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
                    { ...part, messageID: info.id, sessionID: input.sessionID },
                  ]
                }

                yield* filetime.read(input.sessionID, filepath)
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
                      `data:${part.mime};base64,` +
                      Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                    mime: part.mime,
                    filename: part.filename!,
                    source: part.source,
                  },
                ]
              }
            }
          }

          if (part.type === "agent") {
            const perm = Permission.evaluate("task", part.name, currentAgent.permission)
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

        const parts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
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
          { message: info, parts },
        )

        const parsed = MessageV2.Info.safeParse(info)
        if (!parsed.success) {
          log.error("invalid user message before save", {
            sessionID: input.sessionID,
            messageID: info.id,
            agent: info.agent,
            model: info.model,
            issues: parsed.error.issues,
          })
        }
        parts.forEach((part, index) => {
          const p = MessageV2.Part.safeParse(part)
          if (p.success) return
          log.error("invalid user part before save", {
            sessionID: input.sessionID,
            messageID: info.id,
            partID: part.id,
            partType: part.type,
            index,
            issues: p.error.issues,
            part,
          })
        })

        yield* sessions.updateMessage(info)
        for (const part of parts) yield* sessions.updatePart(part)

        return { info, parts }
      }, Effect.scoped)

      const submitPromptInput = Effect.fn("SessionPrompt.submitPromptInput")(function* (input: PromptInput) {
        const session = yield* sessions.get(input.sessionID)
        yield* revert.cleanup(session)
        yield* sessions.touch(input.sessionID)

        const permissions: Permission.Ruleset = []
        for (const [t, enabled] of Object.entries(input.tools ?? {})) {
          permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
        }
        if (permissions.length > 0) {
          session.permission = permissions
          yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
        }

        return yield* createUserMessage(input)
      })

      const foregroundBlockedByPending = (pendingInfo: SessionPending.Info) =>
        pendingInfo.steer.length > 0 || (pendingInfo.queue.length > 0 && !pendingInfo.paused)

      const foregroundShouldResumePausedQueue = (pendingInfo: SessionPending.Info) =>
        pendingInfo.paused && pendingInfo.steer.length === 0 && pendingInfo.queue.length > 0

      const ensureForegroundStartupOpen = Effect.fn("SessionPrompt.ensureForegroundStartupOpen")(function* (
        sessionID: SessionID,
      ) {
        if (yield* state.isStopRequested(sessionID)) {
          throw new SessionPending.ConflictError({
            sessionID,
            message: "Session is paused or has pending follow-ups; resolve or resume them before sending a new prompt",
          })
        }
        const pendingInfo = yield* pending.get(sessionID)
        if (foregroundBlockedByPending(pendingInfo)) {
          throw new SessionPending.ConflictError({
            sessionID,
            message: "Session is paused or has pending follow-ups; resolve or resume them before sending a new prompt",
          })
        }
      })

      const promptComposerFromParts = (parts: PromptInput["parts"]): SessionPending.Composer["prompt"] => {
        const result: SessionPending.Composer["prompt"] = []
        let cursor = 0
        const nextRange = (content: string) => {
          const start = cursor
          const end = start + content.length
          cursor = end
          return { start, end }
        }

        for (const part of parts) {
          switch (part.type) {
            case "text": {
              const range = nextRange(part.text)
              result.push({ type: "text", content: part.text, ...range })
              break
            }
            case "agent": {
              const content = `@${part.name}`
              const range = nextRange(content)
              result.push({ type: "agent", content, name: part.name, ...range })
              break
            }
            case "file": {
              if (part.mime?.startsWith("image/") && part.url.startsWith("data:")) {
                result.push({
                  type: "image",
                  id: part.id ?? PartID.ascending(),
                  filename: part.filename ?? "image",
                  mime: part.mime,
                  dataUrl: part.url,
                })
                break
              }
              const content = part.filename ?? part.url
              const range = nextRange(content)
              result.push({
                type: "file",
                content,
                path: part.url.startsWith("file:") ? fileURLToPath(part.url) : part.url,
                ...range,
              })
              break
            }
            case "subtask": {
              const content = part.description || part.prompt || `/${part.command}`
              const range = nextRange(content)
              result.push({ type: "text", content, ...range })
              break
            }
          }
        }

        return result
      }

      const pendingPreview = (prompt: SessionPending.Composer["prompt"]) => {
        const preview = prompt
          .map((part) => {
            if (part.type === "image") return `[image:${part.filename}]`
            return part.content
          })
          .join("")
          .trim()
        return preview || "Pending message"
      }

      const pendingPreviewFromRequestParts = (parts: PromptInput["parts"]) => {
        const text = parts
          .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
          .join("")
          .trim()
        if (text) return text
        return pendingPreview(promptComposerFromParts(parts))
      }

      const buildPendingPromptDraft = (
        input: PromptInput,
        resolved?: { agentName: string; model: NonNullable<PromptInput["model"]>; variant?: string },
      ): SessionPending.Draft => {
        const composer = {
          prompt: promptComposerFromParts(input.parts),
          context: [],
        } satisfies SessionPending.Composer

        return {
          kind: "prompt",
          preview: pendingPreviewFromRequestParts(input.parts),
          composer,
          request: {
            messageID: input.messageID,
            model: resolved?.model ?? input.model,
            agent: resolved?.agentName ?? input.agent,
            tools: input.tools,
            format: input.format,
            system: input.system,
            variant: resolved?.variant ?? input.variant,
            parts: structuredClone(input.parts),
          },
        }
      }

      const buildPendingCommandDraft = (input: CommandInput): SessionPending.Draft => {
        const content = `/${input.command}${input.arguments ? ` ${input.arguments}` : ""}`
        return {
          kind: "command",
          preview: content,
          composer: {
            prompt: [{ type: "text", content, start: 0, end: content.length }],
            context: [],
          },
          request: {
            agent: input.agent,
            model: input.model,
            arguments: input.arguments,
            command: input.command,
            variant: input.variant,
            parts: structuredClone(input.parts),
          },
        }
      }

      const snapshotPendingDraft = Effect.fn("SessionPrompt.snapshotPendingDraft")(function* (
        sessionID: SessionID,
        draft: SessionPending.Draft,
      ) {
        if (draft.kind === "prompt") {
          const resolved = yield* resolvePromptIdentity({
            sessionID,
            messageID: draft.request.messageID,
            model: draft.request.model,
            agent: draft.request.agent,
            tools: draft.request.tools,
            format: draft.request.format,
            system: draft.request.system,
            variant: draft.request.variant,
            parts: structuredClone(draft.request.parts),
          })
          return {
            ...structuredClone(draft),
            request: {
              ...structuredClone(draft.request),
              model: resolved.model,
              agent: resolved.agentName,
              variant: resolved.variant,
            },
          } satisfies SessionPending.Draft
        }
        const prepared = yield* buildCommandPrompt(
          {
            sessionID,
            ...draft.request,
          },
          { triggerBeforeHook: false },
        )
        return {
          ...structuredClone(draft),
          request: {
            ...structuredClone(draft.request),
            resolved: {
              model: prepared.model,
              agent: prepared.agent,
              variant: prepared.variant,
              parts: structuredClone(prepared.parts),
            },
          },
        } satisfies SessionPending.Draft
      })

      const addBusyPendingItemWithinLock = Effect.fn("SessionPrompt.addBusyPendingItemWithinLock")(function* (
        sessionID: SessionID,
        draft: SessionPending.Draft,
        options?: { noReply?: boolean },
      ) {
        const lane: SessionPending.Lane = (yield* state.isPromptRunning(sessionID)) ? "steer" : "queue"
        const itemID = options?.noReply === true ? ulid() : undefined
        const next = yield* pending.addPreparedWithinLock({
          sessionID,
          lane,
          draft,
          id: itemID,
        })
        if (options?.noReply !== true) return
        const item = [...next.steer, ...next.queue].find((entry) => entry.id === itemID)
        if (!item) {
          throw new Error(`Failed to find pending item ${itemID} after enqueue`)
        }
        noReplyPendingItems.set(item.id, {
          sessionID,
          state: "pending",
        })
      })

      const enqueuePrompt = Effect.fn("SessionPrompt.enqueuePrompt")(function* (input: PromptInput) {
        yield* ensureSubscriptions()
        const resolved = yield* resolvePromptIdentity(input)
        const draft = buildPendingPromptDraft(input, resolved)
        // The async prompt API always creates the next normal turn. Explicit
        // steer behavior stays on the dedicated pending-add / steer path.
        yield* pending.addPrepared({ sessionID: input.sessionID, lane: "queue", draft })
      })

      const ensureForegroundPromptAvailable = Effect.fn("SessionPrompt.ensureForegroundPromptAvailable")(function* (
        sessionID: SessionID,
        options?: { reservation?: ForegroundStartupReservation },
      ) {
        if (options?.reservation && foregroundStarting.get(sessionID) !== options.reservation) {
          throw new SessionPending.ConflictError({
            sessionID,
            message: "Session foreground startup reservation is no longer active",
          })
        }
        if (!options?.reservation && foregroundStarting.has(sessionID)) {
          throw new SessionPending.ConflictError({
            sessionID,
            message: "Session is starting a prompt; use prompt_async or pending follow-ups instead",
          })
        }
        if (yield* state.isStopRequested(sessionID)) {
          throw new SessionPending.ConflictError({
            sessionID,
            message: "Session is paused or has pending follow-ups; resolve or resume them before sending a new prompt",
          })
        }
        if ((yield* state.busyKind(sessionID)) !== "idle") {
          throw new SessionPending.ConflictError({
            sessionID,
            message: "Session is busy; use prompt_async or pending follow-ups instead",
          })
        }

        const pendingInfo = yield* pending.get(sessionID)
        if (foregroundBlockedByPending(pendingInfo)) {
          throw new SessionPending.ConflictError({
            sessionID,
            message: "Session is paused or has pending follow-ups; resolve or resume them before sending a new prompt",
          })
        }
      })

      const clearForegroundStartupReservation = (
        sessionID: SessionID,
        reservation: ForegroundStartupReservation,
      ) => {
        foregroundStartupCancelled.delete(reservation)
        if (foregroundStarting.get(sessionID) !== reservation) return
        foregroundStarting.delete(sessionID)
      }

      const beginForegroundStartupReservation = (sessionID: SessionID) => {
        if (foregroundStarting.has(sessionID)) {
          throw new SessionPending.ConflictError({
            sessionID,
            message: "Session is starting a prompt; use prompt_async or pending follow-ups instead",
          })
        }
        const reservation = Symbol(sessionID)
        foregroundStarting.set(sessionID, reservation)
        return reservation
      }

      const startForegroundPrompt: (
        input: PromptInput,
        options?: { reservation?: ForegroundStartupReservation },
      ) => Effect.Effect<ForegroundStart, unknown, never> = Effect.fn("SessionPrompt.startForegroundPrompt")(function* (
        input: PromptInput,
        options?: { reservation?: ForegroundStartupReservation },
      ) {
        const accepted = yield* Deferred.make<void, unknown>()
        const result = yield* Deferred.make<MessageV2.WithParts, unknown>()
        let submitted = false
        let resumePausedQueueAfterResult = false
        const reservation = options?.reservation ?? beginForegroundStartupReservation(input.sessionID)

        yield* state
          .ensureRunning(
            input.sessionID,
            foregroundFallback(input),
            Effect.gen(function* () {
              const started = yield* pending.withLock(
                input.sessionID,
                Effect.gen(function* () {
                  if (foregroundStarting.get(input.sessionID) !== reservation) {
                    return { started: false, resumePausedQueue: false }
                  }
                  if (foregroundStartupCancelled.has(reservation)) {
                    return { started: false, resumePausedQueue: false }
                  }
                  const pendingInfo = yield* pending.get(input.sessionID)
                  const resumePausedQueue = foregroundShouldResumePausedQueue(pendingInfo)
                  yield* ensureForegroundStartupOpen(input.sessionID)
                  if (foregroundStartupCancelled.has(reservation)) {
                    return { started: false, resumePausedQueue: false }
                  }
                  yield* submitPromptInput(input)
                  return { started: true, resumePausedQueue }
                }),
              )
              if (!started.started) {
                return yield* foregroundFallback(input)
              }
              submitted = true
              resumePausedQueueAfterResult = started.resumePausedQueue
              if (resumePausedQueueAfterResult) {
                yield* pending.resume(input.sessionID).pipe(Effect.ignore)
                resumePausedQueueAfterResult = false
              }
              yield* Deferred.succeed(accepted, undefined)
              clearForegroundStartupReservation(input.sessionID, reservation)
              const result = yield* runLoop(input.sessionID)
              const latestPending = yield* pending.get(input.sessionID)
              resumePausedQueueAfterResult ||= foregroundShouldResumePausedQueue(latestPending)
              return result
            }).pipe(
              Effect.onExit((exit) =>
                Effect.gen(function* () {
                  if (!submitted) {
                    if (Exit.isFailure(exit)) {
                      yield* Deferred.failCause(accepted, exit.cause).pipe(Effect.ignore)
                    } else {
                      yield* Deferred.succeed(accepted, undefined).pipe(Effect.ignore)
                    }
                  }
                }),
              ),
            ),
          )
          .pipe(
            Effect.onExit((exit) =>
              Effect.gen(function* () {
                clearForegroundStartupReservation(input.sessionID, reservation)
                if (!submitted) {
                  yield* state.setPromptRunning(input.sessionID, false)
                  yield* pending.refresh(input.sessionID)
                }
                if (submitted && Exit.isSuccess(exit)) {
                  yield* Effect.gen(function* () {
                    const latestPending = yield* pending.get(input.sessionID)
                    if (resumePausedQueueAfterResult || foregroundShouldResumePausedQueue(latestPending)) {
                      yield* pending.resume(input.sessionID)
                    }
                  }).pipe(Effect.ignore)
                }
                yield* Deferred.done(result, exit)
              }).pipe(Effect.ignore),
            ),
          )
          .pipe(Effect.forkIn(scope))

        return { accepted, result }
      })

      const startReservedForegroundPrompt: (
        input: PromptInput,
        reservation: ForegroundStartupReservation,
      ) => Effect.Effect<ForegroundStart, unknown, never> = Effect.fn(
        "SessionPrompt.startReservedForegroundPrompt",
      )(function* (input: PromptInput, reservation: ForegroundStartupReservation) {
          const started = yield* Effect.gen(function* () {
            yield* ensureForegroundPromptAvailable(input.sessionID, { reservation })
            return yield* startForegroundPrompt(input, { reservation })
          }).pipe(Effect.exit)
          if (Exit.isFailure(started)) {
            clearForegroundStartupReservation(input.sessionID, reservation)
            return yield* Effect.failCause(started.cause)
          }
          return started.value
        })

      const prompt: (input: PromptInput) => PromptResultEffect = Effect.fn("SessionPrompt.prompt")(function* (
        input: PromptInput,
      ) {
        yield* ensureSubscriptions()
        if (input.noReply === true) {
          const submitted = yield* pending.withLock(
            input.sessionID,
            Effect.gen(function* () {
              const pendingInfo = yield* pending.get(input.sessionID)
              const resumePausedQueue = foregroundShouldResumePausedQueue(pendingInfo)
              yield* ensureForegroundPromptAvailable(input.sessionID)
              const message = yield* submitPromptInput(input)
              return { message, resumePausedQueue }
            }),
          )
          if (submitted.resumePausedQueue) {
            yield* pending.resume(input.sessionID)
          }
          return submitted.message
        }
        const foregroundRun = yield* pending.withLock(
          input.sessionID,
          Effect.gen(function* () {
            const reservation = beginForegroundStartupReservation(input.sessionID)
            return yield* startReservedForegroundPrompt(input, reservation)
          }),
        )
        yield* pending.refresh(input.sessionID)
        return yield* Effect.gen(function* () {
          yield* Deferred.await(foregroundRun.accepted)
          return yield* Deferred.await(foregroundRun.result)
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              run.fork(cancel(input.sessionID))
            }),
          ),
        )
      })

      const promptAsync = Effect.fn("SessionPrompt.promptAsync")(function* (input: PromptInput) {
        yield* ensureSubscriptions()
        if (input.noReply === true) {
          const resolved = yield* resolvePromptIdentity(input)
          const nextTurnDraft = buildPendingPromptDraft(input, resolved)
          const resumePausedQueue = yield* pending.withLock(
            input.sessionID,
            Effect.gen(function* () {
              const pendingInfo = yield* pending.get(input.sessionID)
              const resumePausedQueue = foregroundShouldResumePausedQueue(pendingInfo)
              const stopRequested = yield* state.isStopRequested(input.sessionID)
              if (stopRequested) {
                throw new SessionPending.ConflictError({
                  sessionID: input.sessionID,
                  message: "Session is paused or has pending follow-ups; resolve or resume them before sending a new prompt",
                })
              }
              if (foregroundBlockedByPending(pendingInfo)) {
                throw new SessionPending.ConflictError({
                  sessionID: input.sessionID,
                  message: "Session is paused or has pending follow-ups; resolve or resume them before sending a new prompt",
                })
              }
              if (foregroundStarting.has(input.sessionID) || (yield* state.busyKind(input.sessionID)) !== "idle") {
                yield* addBusyPendingItemWithinLock(input.sessionID, nextTurnDraft, { noReply: true })
                return false
              }
              yield* submitPromptInput(input)
              return resumePausedQueue
            }),
          )
          if (resumePausedQueue) {
            yield* pending.resume(input.sessionID)
          }
          return
        }
        const resolved = yield* resolvePromptIdentity(input)
        const nextTurnDraft = buildPendingPromptDraft(input, resolved)
        const run = yield* pending.withLock(
          input.sessionID,
          Effect.gen(function* () {
            const alreadyStarting = foregroundStarting.has(input.sessionID)
            if (alreadyStarting) {
              const pendingInfo = yield* pending.get(input.sessionID)
              const stopRequested = yield* state.isStopRequested(input.sessionID)
              if (stopRequested) {
                throw new SessionPending.ConflictError({
                  sessionID: input.sessionID,
                  message: "Session is paused or has pending follow-ups; resolve or resume them before sending a new prompt",
                })
              }
              if (foregroundBlockedByPending(pendingInfo)) {
                throw new SessionPending.ConflictError({
                  sessionID: input.sessionID,
                  message: "Session is paused or has pending follow-ups; resolve or resume them before sending a new prompt",
                })
              }
              yield* pending.addPreparedWithinLock({
                sessionID: input.sessionID,
                lane: "queue",
                draft: nextTurnDraft,
              })
              return "enqueued" as const
            }
            const reservation = beginForegroundStartupReservation(input.sessionID)
            const started = yield* Effect.gen(function* () {
              const pendingInfo = yield* pending.get(input.sessionID)
              const stopRequested = yield* state.isStopRequested(input.sessionID)
              if (stopRequested) {
                throw new SessionPending.ConflictError({
                  sessionID: input.sessionID,
                  message: "Session is paused or has pending follow-ups; resolve or resume them before sending a new prompt",
                })
              }
              if (foregroundBlockedByPending(pendingInfo)) {
                throw new SessionPending.ConflictError({
                  sessionID: input.sessionID,
                  message: "Session is paused or has pending follow-ups; resolve or resume them before sending a new prompt",
                })
              }
              const busyKind = yield* state.busyKind(input.sessionID)
              if (busyKind !== "idle") {
                yield* pending.addPreparedWithinLock({
                  sessionID: input.sessionID,
                  lane: "queue",
                  draft: nextTurnDraft,
                })
                return "enqueued" as const
              }
              return yield* startReservedForegroundPrompt(input, reservation)
            }).pipe(Effect.exit)
            if (Exit.isFailure(started)) {
              clearForegroundStartupReservation(input.sessionID, reservation)
              return yield* Effect.failCause(started.cause)
            }
            if (started.value === "enqueued") clearForegroundStartupReservation(input.sessionID, reservation)
            return started.value
          }),
        )

        if (run === "enqueued") {
          return
        }

        yield* pending.refresh(input.sessionID)
        yield* Deferred.await(run.accepted)
        yield* Deferred.await(run.result).pipe(
          Effect.catch((error: unknown) =>
            bus.publish(Session.Event.Error, {
              sessionID: input.sessionID,
              error: new NamedError.Unknown({ message: error instanceof Error ? error.message : String(error) }).toObject(),
            }),
          ),
          Effect.forkIn(scope),
        )
      })

      const requireAssistantMessage = Effect.fnUntraced(function* (message: MessageV2.WithParts) {
        if (message.info.role === "assistant") {
          return message as AssistantWithParts
        }
        throw new Error("Expected assistant message")
      })

      const abortedAssistantFallback = (
        sessionID: SessionID,
        options?: {
          agent?: string
          model?: { providerID: ProviderID; modelID: ModelID }
          parentID?: MessageID
          message?: string
          parts?: MessageV2.Part[]
        },
      ): AssistantResultEffect =>
        Effect.gen(function* () {
          const session = yield* sessions.get(sessionID)
          const ctx = yield* InstanceState.context
          const defaultAgent = options?.agent ?? (yield* agents.defaultAgent())
          const defaultModel = options?.model ?? (yield* lastModel(sessionID))
          const now = Date.now()
          return {
            info: {
              id: MessageID.ascending(),
              sessionID,
              role: "assistant" as const,
              time: { created: now, completed: now },
              error: new MessageV2.AbortedError({
                message: options?.message ?? "Session canceled before assistant reply was available",
              }).toObject(),
              parentID: options?.parentID ?? MessageID.ascending(),
              modelID: defaultModel.modelID,
              providerID: defaultModel.providerID,
              mode: "default",
              agent: defaultAgent,
              path: {
                cwd: session.directory,
                root: ctx.worktree,
              },
              cost: 0,
              tokens: {
                input: 0,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
            parts: options?.parts ?? [],
          } satisfies AssistantWithParts
        })

      const lastAssistant: (sessionID: SessionID) => AssistantResultEffect = (sessionID) =>
        Effect.gen(function* () {
          const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user")
          if (Option.isSome(match)) return yield* requireAssistantMessage(match.value)
          const msgs = yield* sessions.messages({ sessionID, limit: 1 })
          if (msgs.length > 0) {
            const last = msgs[0]
            if (last.info.role === "assistant") return yield* requireAssistantMessage(last)
            return yield* abortedAssistantFallback(sessionID, {
              agent: last.info.agent,
              model: last.info.model,
              parentID: last.info.id,
            })
          }
          return yield* abortedAssistantFallback(sessionID)
        })

      const shellFallback = (input: ShellInput): AssistantResultEffect =>
        Effect.gen(function* () {
          const match = yield* sessions.findMessage(input.sessionID, (m) => m.info.role !== "user")
          if (Option.isSome(match)) {
            const assistant = yield* requireAssistantMessage(match.value)
            const now = Date.now()
            return {
              ...assistant,
              info: {
                ...assistant.info,
                time: assistant.info.time.completed ? assistant.info.time : { ...assistant.info.time, completed: now },
              },
              parts: assistant.parts.map((part) => {
                if (part.type !== "tool" || part.tool !== "bash" || part.state.status !== "running") return part
                return {
                  ...part,
                  state: {
                    status: "completed",
                    time: { start: part.state.time.start, end: now },
                    input: part.state.input,
                    title: "",
                    metadata: {
                      output: "\n\n<metadata>\nUser aborted the command\n</metadata>",
                      description: "",
                    },
                    output: "\n\n<metadata>\nUser aborted the command\n</metadata>",
                  },
                } satisfies MessageV2.ToolPart
              }),
            }
          }
          const shellAgent = yield* agents.get(input.agent)
          const model = input.model ?? shellAgent?.model ?? (yield* provider.defaultModel())
          const parentID = input.messageID ?? MessageID.ascending()
          const assistant = yield* abortedAssistantFallback(input.sessionID, {
            agent: input.agent,
            model,
            parentID,
            message: "User aborted the command",
          })
          const toolPart: MessageV2.ToolPart = {
            type: "tool",
            id: PartID.ascending(),
            messageID: assistant.info.id,
            sessionID: input.sessionID,
            tool: "bash",
            callID: ulid(),
            state: {
              status: "completed",
              time: { start: Date.now(), end: Date.now() },
              input: { command: input.command },
              title: "",
              metadata: {
                output: "\n\n<metadata>\nUser aborted the command\n</metadata>",
                description: "",
              },
              output: "\n\n<metadata>\nUser aborted the command\n</metadata>",
            },
          }
          return {
            ...assistant,
            parts: [toolPart],
          }
        })

      const fallbackMessage = Effect.fnUntraced(function* (sessionID: SessionID) {
        const msgs = yield* sessions.messages({ sessionID, limit: 1 })
        if (msgs.length > 0) return msgs[0]
        return {
          info: {
            id: MessageID.ascending(),
            sessionID,
            role: "user" as const,
            time: { created: Date.now() },
            agent: "build",
            model: {
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test"),
            },
          },
          parts: [],
        } satisfies MessageV2.WithParts
      })

      const foregroundFallback = Effect.fnUntraced(function* (input: PromptInput) {
        const assistant = yield* sessions.findMessage(input.sessionID, (m) => m.info.role === "assistant")
        if (Option.isSome(assistant)) return yield* requireAssistantMessage(assistant.value)
        const session = yield* sessions.get(input.sessionID)
        const ctx = yield* InstanceState.context
        const { agentName, model, variant } = yield* resolvePromptIdentity(input)
        const now = Date.now()
        return {
          info: {
            id: MessageID.ascending(),
            sessionID: input.sessionID,
            role: "assistant" as const,
            time: { created: now, completed: now },
            error: new MessageV2.AbortedError({ message: "Prompt canceled before startup completed" }).toObject(),
            parentID: MessageID.ascending(),
            modelID: model.modelID,
            providerID: model.providerID,
            mode: "default",
            agent: agentName,
            path: {
              cwd: session.directory,
              root: ctx.worktree,
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            ...(variant ? { variant } : {}),
          },
          parts: [],
        } satisfies AssistantWithParts
      })

      const runLoop: (sessionID: SessionID) => AssistantResultEffect = Effect.fn("SessionPrompt.run")(function* (
        sessionID: SessionID,
      ) {
        yield* state.setPromptRunning(sessionID, true)
        yield* pending.refresh(sessionID)
        return yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const slog = elog.with({ sessionID })
            let structured: unknown | undefined
            let step = 0
            let promptTurnOpen = true
            const executedSteerCommands: Array<{ name: string; arguments: string }> = []
            const session = yield* sessions.get(sessionID)
            const closePromptTurn = Effect.fnUntraced(function* () {
              if (!promptTurnOpen) return
              promptTurnOpen = false
              yield* state.setPromptRunning(sessionID, false)
              yield* pending.refresh(sessionID)
            })

            while (true) {
              yield* status.set(sessionID, { type: "busy" })
              yield* slog.info("loop", { step })

              while (true) {
                const claimedSteer = yield* Effect.uninterruptibleMask((restore) =>
                  Effect.gen(function* () {
                    const steer = yield* pending.takeSteer(sessionID)
                    if (!steer) return undefined
                    const noReplySteer = noReplyPendingItems.get(steer.id)
                    if (noReplySteer) noReplySteer.state = "running-steer"
                    const dispatch = yield* restore(
                      pending.dispatchClaimed(
                        sessionID,
                        steer,
                        submitPendingItem(sessionID, steer, { noReply: true }).pipe(Effect.exit),
                      ).pipe(
                        Effect.onInterrupt(() =>
                          Effect.gen(function* () {
                            if (noReplySteer) noReplySteer.state = "pending"
                            yield* pending.restore(sessionID, steer)
                          }),
                        ),
                      ),
                    )
                    return {
                      steer,
                      noReplySteer,
                      dispatch,
                    }
                  }),
                )
                if (!claimedSteer) break
                const { steer, noReplySteer, dispatch } = claimedSteer
                if (Option.isNone(dispatch)) {
                  if (noReplySteer) noReplySteer.state = "pending"
                  break
                }
                if (steer.draft.kind === "command") {
                  executedSteerCommands.push({
                    name: steer.draft.request.command,
                    arguments: steer.draft.request.arguments,
                  })
                }
                const result = dispatch.value
                if (Exit.isFailure(result)) {
                  yield* pending.restore(sessionID, steer)
                  yield* pending.pause(sessionID, { promoteSteers: true })
                  if (noReplySteer) {
                    yield* clearNoReplyPendingItem(steer.id)
                  }
                  return yield* Effect.failCause(result.cause)
                }
              }

              let msgs = yield* MessageV2.filterCompactedEffect(sessionID)

              let lastUser: MessageV2.User | undefined
              let lastAssistant: MessageV2.Assistant | undefined
              let lastFinished: MessageV2.Assistant | undefined
              let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
              for (let i = msgs.length - 1; i >= 0; i--) {
                const msg = msgs[i]
                if (!lastUser && msg.info.role === "user") lastUser = msg.info
                if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info
                if (!lastFinished && msg.info.role === "assistant" && msg.info.finish) lastFinished = msg.info
                if (lastUser && lastFinished) break
                const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
                if (task && !lastFinished) tasks.push(...task)
              }

              if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

              const lastAssistantMsg = msgs.findLast(
                (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
              )
              // Some providers return "stop" even when the assistant message contains tool calls.
              // Keep the loop running so tool results can be sent back to the model.
              // Skip provider-executed tool parts — those were fully handled within the
              // provider's stream (e.g. DWS Agent Platform) and don't need a re-loop.
              const hasToolCalls =
                lastAssistantMsg?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

              if (
                lastAssistant?.finish &&
                !["tool-calls"].includes(lastAssistant.finish) &&
                !hasToolCalls &&
                lastUser.id < lastAssistant.id
              ) {
                yield* closePromptTurn()
                yield* slog.info("exiting loop")
                break
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

              if (task?.type === "subtask") {
                yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
                continue
              }

              if (task?.type === "compaction") {
                const result = yield* compaction.process({
                  messages: msgs,
                  parentID: lastUser.id,
                  sessionID,
                  auto: task.auto,
                  overflow: task.overflow,
                })
                if (result === "stop") {
                  yield* closePromptTurn()
                  break
                }
                continue
              }

              if (
                lastFinished &&
                lastFinished.summary !== true &&
                (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
              ) {
                yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
                continue
              }

              const agent = yield* agents.get(lastUser.agent)
              if (!agent) {
                const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
                const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
                const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
                yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
                throw error
              }
              const maxSteps = agent.steps ?? Infinity
              const isLastStep = step >= maxSteps
              msgs = yield* insertReminders({ messages: msgs, agent, session })

              const msg: MessageV2.Assistant = {
                id: MessageID.ascending(),
                parentID: lastUser.id,
                role: "assistant",
                mode: agent.name,
                agent: agent.name,
                variant: lastUser.model.variant,
                path: { cwd: ctx.directory, root: ctx.worktree },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                modelID: model.id,
                providerID: model.providerID,
                time: { created: Date.now() },
                sessionID,
              }
              yield* sessions.updateMessage(msg)
              const handle = yield* processor.create({
                assistantMessage: msg,
                sessionID,
                model,
              })

              const outcome: "break" | "continue" = yield* Effect.gen(function* () {
                const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
                const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

                const tools = yield* resolveTools({
                  agent,
                  session,
                  model,
                  tools: lastUser.tools,
                  processor: handle,
                  bypassAgentCheck,
                  messages: msgs,
                })

                if (lastUser.format?.type === "json_schema") {
                  tools["StructuredOutput"] = createStructuredOutputTool({
                    schema: lastUser.format.schema,
                    onSuccess(output) {
                      structured = output
                    },
                  })
                }

                if (step === 1) SessionSummary.summarize({ sessionID, messageID: lastUser.id })

                if (step > 1 && lastFinished) {
                  for (const m of msgs) {
                    if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
                    for (const p of m.parts) {
                      if (p.type !== "text" || p.ignored || p.synthetic) continue
                      if (!p.text.trim()) continue
                      p.text = [
                        "<system-reminder>",
                        "The user sent the following message:",
                        p.text,
                        "",
                        "Please address this message and continue with your tasks.",
                        "</system-reminder>",
                      ].join("\n")
                    }
                  }
                }

                yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

                const [skills, env, instructions, modelMsgs] = yield* Effect.all([
                  sys.skills(agent),
                  Effect.sync(() => sys.environment(model)),
                  instruction.system().pipe(Effect.orDie),
                  MessageV2.toModelMessagesEffect(msgs, model),
                ])
                const system = [...env, ...(skills ? [skills] : []), ...instructions]
                const format = lastUser.format ?? { type: "text" as const }
                if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
                const result = yield* handle.process({
                  user: lastUser,
                  agent,
                  permission: session.permission,
                  sessionID,
                  parentSessionID: session.parentID,
                  system,
                  messages: [
                    ...modelMsgs,
                    ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : []),
                  ],
                  tools,
                  model,
                  toolChoice: format.type === "json_schema" ? "required" : undefined,
                })

                if (structured !== undefined) {
                  handle.message.structured = structured
                  handle.message.finish = handle.message.finish ?? "stop"
                  yield* sessions.updateMessage(handle.message)
                  yield* closePromptTurn()
                  return "break" as const
                }

                const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
                if (finished && !handle.message.error) {
                  if (format.type === "json_schema") {
                    handle.message.error = new MessageV2.StructuredOutputError({
                      message: "Model did not produce structured output",
                      retries: 0,
                    }).toObject()
                    yield* sessions.updateMessage(handle.message)
                    yield* closePromptTurn()
                    return "break" as const
                  }
                }

                if (result === "stop") {
                  yield* closePromptTurn()
                  return "break" as const
                }
                if (result === "compact") {
                  yield* compaction.create({
                    sessionID,
                    agent: lastUser.agent,
                    model: lastUser.model,
                    auto: true,
                    overflow: !handle.message.finish,
                  })
                }
                return "continue" as const
              }).pipe(Effect.ensuring(instruction.clear(handle.message.id)))
              if (outcome === "break") {
                yield* closePromptTurn()
                break
              }
              continue
            }

            yield* closePromptTurn()
            yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
            const assistant = yield* lastAssistant(sessionID)
            if (executedSteerCommands.length > 0 && !assistant.info.error) {
              yield* Effect.forEach(
                executedSteerCommands,
                (command) =>
                  bus.publish(Command.Event.Executed, {
                    name: command.name,
                    sessionID,
                    arguments: command.arguments,
                    messageID: assistant.info.id,
                  }),
                { discard: true },
              )
            }
            return assistant
          }).pipe(
            Effect.onExit(() => clearRunningNoReplySteers(sessionID)),
            Effect.ensuring(state.setPromptRunning(sessionID, false).pipe(Effect.andThen(pending.refresh(sessionID)))),
          )
      })

      const loop: (input: z.infer<typeof LoopInput>) => PromptResultEffect = Effect.fn(
        "SessionPrompt.loop",
      )(function* (input: z.infer<typeof LoopInput>) {
        yield* ensureSubscriptions()
        return yield* state.ensureRunning(input.sessionID, lastAssistant(input.sessionID), runLoop(input.sessionID))
      })

      const shell: (input: ShellInput) => PromptResultEffect = Effect.fn("SessionPrompt.shell")(
        function* (input: ShellInput) {
          yield* ensureSubscriptions()
          return yield* state.startShell(input.sessionID, shellFallback(input), shellImpl(input))
        },
      )

      const applyCommandBeforeHook = Effect.fn("SessionPrompt.applyCommandBeforeHook")(function* (
        sessionID: SessionID,
        request: {
          command: string
          arguments: string
        },
        prepared: PromptInput,
      ) {
        const parts = structuredClone(prepared.parts)
        yield* plugin.trigger(
          "command.execute.before",
          { command: request.command, sessionID, arguments: request.arguments },
          { parts },
        )
        return {
          ...prepared,
          parts,
        } satisfies PromptInput
      })

      const buildCommandPrompt = Effect.fn("SessionPrompt.buildCommandPrompt")(function* (
        input: CommandInput,
        options?: { triggerBeforeHook?: boolean },
      ) {
        const cmd = yield* commands.get(input.command)
        if (!cmd) {
          const available = (yield* commands.list()).map((c) => c.name)
          const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
          const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
          yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
          throw error
        }
        const agentName = cmd.agent ?? input.agent ?? (yield* agents.defaultAgent())

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
          const sh = Shell.preferred()
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
          return yield* lastModel(input.sessionID)
        })

        yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

        const agent = yield* agents.get(agentName)
        if (!agent) {
          const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
          const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
          const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
          yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
          throw error
        }

        const templateParts = yield* resolvePromptParts(template)
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
          : [...templateParts, ...(input.parts ?? [])]

        const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultAgent())) : agentName
        const userModel = isSubtask
          ? input.model
            ? Provider.parseModel(input.model)
            : yield* lastModel(input.sessionID)
          : taskModel

        const prepared = {
          sessionID: input.sessionID,
          messageID: input.messageID,
          model: userModel,
          agent: userAgent,
          parts,
          variant: input.variant,
        } satisfies PromptInput

        if (options?.triggerBeforeHook === false) return prepared
        return yield* applyCommandBeforeHook(
          input.sessionID,
          { command: input.command, arguments: input.arguments },
          prepared,
        )
      })

      const runCommand = Effect.fn("SessionPrompt.runCommand")(function* (
        input: CommandInput,
        options?: { noReply?: boolean },
      ) {
        const prepared = yield* buildCommandPrompt(input)
        const result = yield* prompt({
          ...prepared,
          noReply: options?.noReply,
        })
        if (options?.noReply !== true) {
          yield* bus.publish(Command.Event.Executed, {
            name: input.command,
            sessionID: input.sessionID,
            arguments: input.arguments,
            messageID: result.info.id,
          })
        }
        return result
      })

      const commandPromptFromDraft = Effect.fn("SessionPrompt.commandPromptFromDraft")(function* (
        sessionID: SessionID,
        request: Extract<SessionPending.Draft, { kind: "command" }>["request"],
      ) {
        if (request.resolved) {
          return yield* applyCommandBeforeHook(
            sessionID,
            { command: request.command, arguments: request.arguments },
            {
              sessionID,
              model: request.resolved.model,
              agent: request.resolved.agent,
              parts: structuredClone(request.resolved.parts),
              variant: request.resolved.variant,
            } satisfies PromptInput,
          )
        }

        return yield* buildCommandPrompt({
          sessionID,
          ...request,
        })
      })

      const submitPendingItem: (
        sessionID: SessionID,
        item: SessionPending.Item,
        options?: { noReply?: boolean },
      ) => PromptResultEffect = Effect.fn("SessionPrompt.submitPendingItem")(function* (
        sessionID: SessionID,
        item: SessionPending.Item,
        options?: { noReply?: boolean },
      ) {
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            if (item.draft.kind === "prompt") {
              const request = {
                ...item.draft.request,
                sessionID,
                noReply: options?.noReply,
              } satisfies PromptInput
              if (options?.noReply === true) return yield* submitPromptInput(request)
              return yield* prompt(request)
            }
            const prepared = yield* restore(commandPromptFromDraft(sessionID, item.draft.request))
            const request = {
              ...prepared,
              noReply: options?.noReply,
            } satisfies PromptInput
            const result =
              options?.noReply === true ? yield* submitPromptInput(request) : yield* prompt(request)
            if (options?.noReply !== true) {
              yield* bus.publish(Command.Event.Executed, {
                name: item.draft.request.command,
                sessionID,
                arguments: item.draft.request.arguments,
                messageID: result.info.id,
              })
            }
            return result
          }),
        )
      })

      const startQueuedPendingItem = Effect.fn("SessionPrompt.startQueuedPendingItem")(function* (
        sessionID: SessionID,
        item: SessionPending.Item,
      ) {
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            if (item.draft.kind === "prompt") {
              const latestAssistant = (yield* sessions.messages({ sessionID })).findLast(
                (message) => message.info.role === "assistant",
              )
              const draftMessageID = item.draft.request.messageID
              const messageID =
                draftMessageID && (!latestAssistant || latestAssistant.info.id < draftMessageID)
                  ? draftMessageID
                  : MessageID.ascending()
              yield* submitPromptInput({
                ...item.draft.request,
                sessionID,
                messageID,
              })
              return undefined
            }

            const prepared = yield* restore(commandPromptFromDraft(sessionID, item.draft.request))
            const message = yield* submitPromptInput(prepared)
            return {
              name: item.draft.request.command,
              arguments: item.draft.request.arguments,
              userMessageID: message.info.id,
            }
          }),
        )
      })

      const runNextQueuedPendingItem: (sessionID: SessionID) => PromptResultEffect = Effect.fn(
        "SessionPrompt.runNextQueuedPendingItem",
      )(function* (sessionID: SessionID) {
        const claimedQueue = yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const item = yield* pending.takeQueueClaimed(sessionID)
            if (!item) return undefined
            const noReplyQueue = noReplyPendingItems.get(item.id)
            if (noReplyQueue) noReplyQueue.state = "running-queue"
            const dispatch = yield* restore(
              pending.dispatchClaimed(
                sessionID,
                item,
                startQueuedPendingItem(sessionID, item).pipe(Effect.exit),
              ).pipe(
                Effect.onInterrupt(() =>
                  Effect.gen(function* () {
                    if (noReplyQueue) noReplyQueue.state = "pending"
                    yield* pending.restore(sessionID, item)
                  }),
                ),
              ),
            )
            return {
              item,
              noReplyQueue,
              dispatch,
            }
          }),
        )
        if (!claimedQueue) return yield* fallbackMessage(sessionID)

        const { item, noReplyQueue, dispatch } = claimedQueue
        if (Option.isNone(dispatch)) {
          if (noReplyQueue) noReplyQueue.state = "pending"
          yield* status.set(sessionID, { type: "idle" })
          yield* pending.refresh(sessionID)
          return yield* fallbackMessage(sessionID)
        }
        if (Exit.isFailure(dispatch.value)) {
          yield* status.set(sessionID, { type: "idle" })
          yield* pending.refresh(sessionID)
          yield* pending.restore(sessionID, item)
          yield* pending.pause(sessionID)
          yield* clearNoReplyPendingItem(item.id)
          return yield* Effect.failCause(dispatch.value.cause)
        }
        if (noReplyQueue) {
          yield* clearNoReplyPendingItem(item.id)
          yield* status.set(sessionID, { type: "idle" })
          yield* pending.refresh(sessionID)
          return yield* fallbackMessage(sessionID)
        }

        const result = yield* runLoop(sessionID).pipe(Effect.exit)
        if (Exit.isFailure(result)) {
          yield* pending.pause(sessionID)
          yield* clearNoReplyPendingItem(item.id)
          return yield* Effect.failCause(result.cause)
        }

        if (dispatch.value.value) {
          if (
            result.value.info.parentID === dispatch.value.value.userMessageID &&
            typeof result.value.info.time.completed === "number" &&
            !result.value.info.error
          ) {
            yield* bus.publish(Command.Event.Executed, {
              name: dispatch.value.value.name,
              sessionID,
              arguments: dispatch.value.value.arguments,
              messageID: result.value.info.id,
            })
          }
        }

        yield* clearNoReplyPendingItem(item.id)
        return result.value
      })

      const pumpPendingQueue: (sessionID: SessionID) => Effect.Effect<void, unknown> = Effect.fn(
        "SessionPrompt.pumpPendingQueue",
      )(function* (sessionID: SessionID) {
        if (queuePumpRunning.has(sessionID)) return
        queuePumpRunning.add(sessionID)
        try {
          if (yield* state.isStopRequested(sessionID)) return
          if (foregroundStarting.has(sessionID)) return
          const info = yield* pending.get(sessionID)
          if (info.paused || info.steer.length > 0 || info.queue.length === 0) return
          const currentStatus = yield* status.get(sessionID)
          if (currentStatus.type !== "idle") return
          yield* state.ensureRunning(sessionID, fallbackMessage(sessionID), runNextQueuedPendingItem(sessionID))
        } finally {
          queuePumpRunning.delete(sessionID)
          const info = yield* pending.get(sessionID)
          const currentStatus = yield* status.get(sessionID)
          if (
            !(yield* state.isStopRequested(sessionID)) &&
            !foregroundStarting.has(sessionID) &&
            !info.paused &&
            info.steer.length === 0 &&
            info.queue.length > 0 &&
            currentStatus.type === "idle"
          ) {
            yield* pumpPendingQueue(sessionID)
          }
        }
      })

      const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
        yield* ensureSubscriptions()
        yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
        return yield* runCommand(input)
      })

      const promptOps: TaskPromptOps = {
        cancel: (sessionID) => run.fork(cancel(sessionID)),
        resolvePromptParts: (template) => resolvePromptParts(template),
        prompt: (input) => prompt(input),
      }

      const pumpWithErrorHandling = (sessionID: SessionID) =>
        pumpPendingQueue(sessionID).pipe(
          Effect.catch((error: unknown) =>
            bus.publish(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({ message: error instanceof Error ? error.message : String(error) }).toObject(),
            }),
          ),
        )

      const activatePending = Effect.fn("SessionPrompt.activatePending")(function* (sessionID: SessionID) {
        yield* ensureSubscriptions()
        const info = yield* pending.get(sessionID)
        if (info.paused || info.steer.length > 0 || info.queue.length === 0) return
        const current = yield* status.get(sessionID)
        if (current.type !== "idle") return
        run.fork(pumpWithErrorHandling(sessionID))
      })

      const loopWithErrorHandling = (sessionID: SessionID) =>
        loop({ sessionID }).pipe(
          Effect.catch((error: unknown) =>
            bus.publish(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({ message: error instanceof Error ? error.message : String(error) }).toObject(),
            }),
          ),
        )

      const subscriptions = yield* InstanceState.make<void, never, never>(() =>
        Effect.gen(function* () {
          const offStatus = yield* bus.subscribeCallback(
            SessionStatus.Event.Status,
            InstanceState.bind((evt) => {
              run.fork(
                Effect.gen(function* () {
                  if (evt.properties.status.type !== "idle") return
                  const info = yield* pending.get(evt.properties.sessionID)
                  if (info.steer.length > 0) {
                    yield* pending.promoteSteersToQueue(evt.properties.sessionID)
                    return
                  }
                  yield* pumpWithErrorHandling(evt.properties.sessionID)
                }),
              )
            }),
          )

          const offPending = yield* bus.subscribeCallback(
            SessionPending.Event.Updated,
            InstanceState.bind((evt) => {
              run.fork(
                Effect.gen(function* () {
                  for (const [itemID, item] of noReplyPendingItems.entries()) {
                    if (item.sessionID !== evt.properties.sessionID || item.state !== "pending") continue
                    const steer = evt.properties.pending.steer.some((item) => item.id === itemID)
                    const queue = evt.properties.pending.queue.some((item) => item.id === itemID)
                    if (steer || queue) {
                      if (
                        (steer && !evt.properties.pending.paused) ||
                        (queue && !evt.properties.pending.paused)
                      ) {
                        continue
                      }
                      yield* clearNoReplyPendingItem(itemID)
                      continue
                    }
                    yield* clearNoReplyPendingItem(itemID)
                  }
                  if (evt.properties.pending.paused || evt.properties.pending.steer.length > 0) return
                  const current = yield* status.get(evt.properties.sessionID)
                  if (current.type !== "idle") return
                  yield* pumpWithErrorHandling(evt.properties.sessionID)
                }),
              )
            }),
          )

          yield* Effect.addFinalizer(
            () =>
              Effect.sync(() => {
                offPending()
                offStatus()
              }),
          )
        }),
      )

      const ensureSubscriptions = Effect.fn("SessionPrompt.ensureSubscriptions")(function* () {
        yield* InstanceState.get(subscriptions)
      })

      return Service.of({
        cancel,
        isForegroundStarting,
        prompt,
        promptAsync,
        enqueuePrompt,
        activatePending,
        snapshotPendingDraft,
        loop,
        shell,
        command,
        resolvePromptParts,
      })
    }),
  )

  export const defaultLayer = Layer.suspend(() =>
    layer.pipe(
      Layer.provide(SessionRunState.defaultLayer),
      Layer.provide(SessionPending.defaultLayer),
      Layer.provide(SessionStatus.defaultLayer),
      Layer.provide(SessionCompaction.defaultLayer),
      Layer.provide(SessionProcessor.defaultLayer),
      Layer.provide(Command.defaultLayer),
      Layer.provide(Permission.defaultLayer),
      Layer.provide(MCP.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(FileTime.defaultLayer),
      Layer.provide(ToolRegistry.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(
        Layer.mergeAll(
          Agent.defaultLayer,
          SystemPrompt.defaultLayer,
          LLM.defaultLayer,
          Bus.layer,
          CrossSpawnSpawner.defaultLayer,
        ),
      ),
    ),
  )
  const { runPromise } = makeRuntime(Service, defaultLayer)

  const PromptInputPart = z.discriminatedUnion("type", [
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
  ])

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
    parts: z.array(PromptInputPart),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  export async function prompt(input: PromptInput) {
    return runPromise((svc) => svc.prompt(PromptInput.parse(input)))
  }

  export async function promptAsync(input: PromptInput) {
    return runPromise((svc) => svc.promptAsync(PromptInput.parse(input)))
  }

  export async function enqueuePrompt(input: PromptInput) {
    return runPromise((svc) => svc.enqueuePrompt(PromptInput.parse(input)))
  }

  export async function activatePending(sessionID: SessionID) {
    return runPromise((svc) => svc.activatePending(SessionID.zod.parse(sessionID)))
  }

  export async function resolvePromptParts(template: string) {
    return runPromise((svc) => svc.resolvePromptParts(z.string().parse(template)))
  }

  export async function cancel(sessionID: SessionID) {
    return runPromise((svc) => svc.cancel(SessionID.zod.parse(sessionID)))
  }

  export async function isForegroundStarting(sessionID: SessionID) {
    return runPromise((svc) => svc.isForegroundStarting(SessionID.zod.parse(sessionID)))
  }

  export const LoopInput = z.object({
    sessionID: SessionID.zod,
  })

  export async function loop(input: z.infer<typeof LoopInput>) {
    return runPromise((svc) => svc.loop(LoopInput.parse(input)))
  }

  export const ShellInput = z.object({
    sessionID: SessionID.zod,
    messageID: MessageID.zod.optional(),
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
    return runPromise((svc) => svc.shell(ShellInput.parse(input)))
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

  export async function command(input: CommandInput) {
    return runPromise((svc) => svc.command(CommandInput.parse(input)))
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
}
