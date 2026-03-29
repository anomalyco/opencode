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
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
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
import { SessionProcessor } from "./processor"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@/shell/shell"
import { AppFileSystem } from "@/filesystem"
import { Truncate } from "@/tool/truncate"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Scope, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"

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

  interface LoopEntry {
    fiber?: Fiber.Fiber<MessageV2.WithParts, unknown>
    queue: Deferred.Deferred<MessageV2.WithParts, unknown>[]
  }

  export interface Interface {
    readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void>
    readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
    readonly prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts>
    readonly loop: (input: z.infer<typeof LoopInput>) => Effect.Effect<MessageV2.WithParts>
    readonly shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts>
    readonly command: (input: CommandInput) => Effect.Effect<MessageV2.WithParts>
    readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/SessionPrompt") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const status = yield* SessionStatus.Service
      const sessions = yield* Session.Service
      const agents = yield* Agent.Service
      const processor = yield* SessionProcessor.Service
      const compaction = yield* SessionCompaction.Service
      const plugin = yield* Plugin.Service
      const commands = yield* Command.Service
      const fsys = yield* AppFileSystem.Service
      const mcp = yield* MCP.Service
      const lsp = yield* LSP.Service
      const filetime = yield* FileTime.Service
      const scope = yield* Scope.Scope

      const cache = yield* InstanceState.make(
        Effect.fn("SessionPrompt.state")(function* () {
          const loops = new Map<string, LoopEntry>()
          const shells = new Map<string, Fiber.Fiber<MessageV2.WithParts, unknown>>()
          yield* Effect.addFinalizer(() =>
            Fiber.interruptAll([...loops.values().flatMap((e) => (e.fiber ? [e.fiber] : [])), ...shells.values()]),
          )
          return { loops, shells }
        }),
      )

      const assertNotBusy = Effect.fn("SessionPrompt.assertNotBusy")(function* (sessionID: SessionID) {
        const s = yield* InstanceState.get(cache)
        if (s.loops.has(sessionID) || s.shells.has(sessionID)) throw new Session.BusyError(sessionID)
      })

      const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
        log.info("cancel", { sessionID })
        const s = yield* InstanceState.get(cache)
        const loopEntry = s.loops.get(sessionID)
        const shellEntry = s.shells.get(sessionID)
        if (!loopEntry && !shellEntry) {
          yield* status.set(sessionID, { type: "idle" })
          return
        }
        if (loopEntry) {
          if (loopEntry.fiber) yield* Fiber.interrupt(loopEntry.fiber)
          for (const d of loopEntry.queue) yield* Deferred.interrupt(d)
          s.loops.delete(sessionID)
        }
        if (shellEntry) {
          yield* Fiber.interrupt(shellEntry)
          s.shells.delete(sessionID)
        }
        yield* status.set(sessionID, { type: "idle" })
      })

      const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
        const parts: PromptInput["parts"] = [{ type: "text", text: template }]
        const files = ConfigMarkdown.files(template)
        const seen = new Set<string>()
        yield* Effect.forEach(
          files,
          (match) =>
            Effect.gen(function* () {
              const name = match[1]
              if (seen.has(name)) return
              seen.add(name)
              const filepath = name.startsWith("~/")
                ? path.join(os.homedir(), name.slice(2))
                : path.resolve(Instance.worktree, name)

              const info = yield* fsys.stat(filepath).pipe(Effect.option)
              if (!info._tag || info._tag === "None") {
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
          { concurrency: "unbounded" },
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
        const text = yield* Effect.promise(async (signal) => {
          const mdl = ag.model
            ? await Provider.getModel(ag.model.providerID, ag.model.modelID)
            : (await Provider.getSmallModel(input.providerID)) ?? (await Provider.getModel(input.providerID, input.modelID))
          const msgs = onlySubtasks
            ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
            : await MessageV2.toModelMessages(context, mdl)
          const result = await LLM.stream({
            agent: ag,
            user: firstInfo,
            system: [],
            small: true,
            tools: {},
            model: mdl,
            abort: signal,
            sessionID: input.session.id,
            retries: 2,
            messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
          })
          return result.text
        })
        const cleaned = text
          .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0)
        if (!cleaned) return
        const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
        yield* sessions.setTitle({ sessionID: input.session.id, title: t }).pipe(Effect.catchCause(() => Effect.void))
      })

      const getModel = (providerID: ProviderID, modelID: ModelID, sessionID: SessionID) =>
        Effect.promise(() =>
          Provider.getModel(providerID, modelID).catch((e) => {
            if (Provider.ModelNotFoundError.isInstance(e)) {
              const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
              Bus.publish(Session.Event.Error, {
                sessionID,
                error: new NamedError.Unknown({ message: `Model not found: ${e.data.providerID}/${e.data.modelID}.${hint}` }).toObject(),
              })
            }
            throw e
          }),
        )

      const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
        const agentName = input.agent || (yield* agents.defaultAgent())
        const ag = yield* agents.get(agentName)
        if (!ag) {
          const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
          const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
          const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
          yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
          throw error
        }

        const model = input.model ?? ag.model ?? (yield* Effect.promise(() => lastModelImpl(input.sessionID)))
        const full =
          !input.variant && ag.variant
            ? yield* Effect.promise(() => Provider.getModel(model.providerID, model.modelID).catch(() => undefined))
            : undefined
        const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

        const info: MessageV2.Info = {
          id: input.messageID ?? MessageID.ascending(),
          role: "user",
          sessionID: input.sessionID,
          time: { created: Date.now() },
          tools: input.tools,
          agent: ag.name,
          model,
          system: input.system,
          format: input.format,
          variant,
        }

        type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
        const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
          ...part,
          id: part.id ? PartID.make(part.id) : PartID.ascending(),
        })

        const parts = yield* Effect.promise(() =>
          Promise.all(
            input.parts.map(async (part): Promise<Draft<MessageV2.Part>[]> => {
              if (part.type === "file") {
                if (part.source?.type === "resource") {
                  const { clientName, uri } = part.source
                  log.info("mcp resource", { clientName, uri, mime: part.mime })
                  const pieces: Draft<MessageV2.Part>[] = [
                    { messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: `Reading MCP resource: ${part.filename} (${uri})` },
                  ]
                  try {
                    const content = await MCP.readResource(clientName, uri)
                    if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
                    const items = Array.isArray(content.contents) ? content.contents : [content.contents]
                    for (const c of items) {
                      if ("text" in c && c.text) {
                        pieces.push({ messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: c.text })
                      } else if ("blob" in c && c.blob) {
                        const mime = "mimeType" in c ? c.mimeType : part.mime
                        pieces.push({ messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: `[Binary content: ${mime}]` })
                      }
                    }
                    pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
                  } catch (error: unknown) {
                    log.error("failed to read MCP resource", { error, clientName, uri })
                    const message = error instanceof Error ? error.message : String(error)
                    pieces.push({ messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: `Failed to read MCP resource ${part.filename}: ${message}` })
                  }
                  return pieces
                }
                const url = new URL(part.url)
                switch (url.protocol) {
                  case "data:":
                    if (part.mime === "text/plain") {
                      return [
                        { messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}` },
                        { messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: decodeDataUrl(part.url) },
                        { ...part, messageID: info.id, sessionID: input.sessionID },
                      ]
                    }
                    break
                  case "file:": {
                    log.info("file", { mime: part.mime })
                    const filepath = fileURLToPath(part.url)
                    const s = Filesystem.stat(filepath)
                    if (s?.isDirectory()) part.mime = "application/x-directory"

                    if (part.mime === "text/plain") {
                      let offset: number | undefined
                      let limit: number | undefined
                      const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                      if (range.start != null) {
                        const filePathURI = part.url.split("?")[0]
                        let start = parseInt(range.start)
                        let end = range.end ? parseInt(range.end) : undefined
                        if (start === end) {
                          const symbols = await LSP.documentSymbol(filePathURI).catch(() => [])
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
                        { messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: `Called the Read tool with the following input: ${JSON.stringify(args)}` },
                      ]
                      await ReadTool.init()
                        .then(async (t) => {
                          const mdl = await Provider.getModel(info.model.providerID, info.model.modelID)
                          const ctx: Tool.Context = {
                            sessionID: input.sessionID,
                            abort: new AbortController().signal,
                            agent: input.agent!,
                            messageID: info.id,
                            extra: { bypassCwdCheck: true, model: mdl },
                            messages: [],
                            metadata: async () => {},
                            ask: async () => {},
                          }
                          const result = await t.execute(args, ctx)
                          pieces.push({ messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: result.output })
                          if (result.attachments?.length) {
                            pieces.push(...result.attachments.map((a) => ({ ...a, synthetic: true, filename: a.filename ?? part.filename, messageID: info.id, sessionID: input.sessionID })))
                          } else {
                            pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
                          }
                        })
                        .catch((error) => {
                          log.error("failed to read file", { error })
                          const message = error instanceof Error ? error.message : error.toString()
                          Bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: new NamedError.Unknown({ message }).toObject() })
                          pieces.push({ messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: `Read tool failed to read ${filepath} with the following error: ${message}` })
                        })
                      return pieces
                    }

                    if (part.mime === "application/x-directory") {
                      const args = { filePath: filepath }
                      const ctx: Tool.Context = {
                        sessionID: input.sessionID,
                        abort: new AbortController().signal,
                        agent: input.agent!,
                        messageID: info.id,
                        extra: { bypassCwdCheck: true },
                        messages: [],
                        metadata: async () => {},
                        ask: async () => {},
                      }
                      const result = await ReadTool.init().then((t) => t.execute(args, ctx))
                      return [
                        { messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: `Called the Read tool with the following input: ${JSON.stringify(args)}` },
                        { messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: result.output },
                        { ...part, messageID: info.id, sessionID: input.sessionID },
                      ]
                    }

                    await FileTime.read(input.sessionID, filepath)
                    return [
                      { messageID: info.id, sessionID: input.sessionID, type: "text", synthetic: true, text: `Called the Read tool with the following input: {"filePath":"${filepath}"}` },
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
                    text: " Use the above message and context to generate a prompt and call the task tool with subagent: " + part.name + hint,
                  },
                ]
              }

              return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
            }),
          ).then((x) => x.flat().map(assign)),
        )

        yield* plugin.trigger("chat.message", {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        }, { message: info, parts })

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
      })

      const prompt = Effect.fn("SessionPrompt.prompt")(function* (input: PromptInput) {
        const session = yield* sessions.get(input.sessionID)
        yield* Effect.promise(() => SessionRevert.cleanup(session))
        const message = yield* createUserMessage(input)
        yield* sessions.touch(input.sessionID)

        const permissions: Permission.Ruleset = []
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

      const lastAssistant = (sessionID: SessionID) =>
        Effect.promise(async () => {
          for await (const item of MessageV2.stream(sessionID)) {
            if (item.info.role === "user") continue
            return item
          }
          throw new Error("Impossible")
        })

      const runLoop = Effect.fn("SessionPrompt.run")(function* (sessionID: SessionID) {
        let structured: unknown | undefined
        let step = 0
        const session = yield* sessions.get(sessionID)

        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          log.info("loop", { step, sessionID })

          let msgs = yield* Effect.promise(() => MessageV2.filterCompacted(MessageV2.stream(sessionID)))

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
          if (
            lastAssistant?.finish &&
            !["tool-calls"].includes(lastAssistant.finish) &&
            lastUser.id < lastAssistant.id
          ) {
            log.info("exiting loop", { sessionID })
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

          const model = yield* getModel(lastUser!.model.providerID, lastUser!.model.modelID, sessionID)
          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* Effect.promise((signal) =>
              handleSubtask({ task, model, lastUser: lastUser!, sessionID, session, msgs, signal }),
            )
            continue
          }

          if (task?.type === "compaction") {
            const result = yield* Effect.promise((signal) =>
              SessionCompaction.process({
                messages: msgs,
                parentID: lastUser!.id,
                abort: signal,
                sessionID,
                auto: task.auto,
                overflow: task.overflow,
              }),
            )
            if (result === "stop") break
            continue
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished!.tokens, model }))
          ) {
            yield* compaction.create({ sessionID, agent: lastUser!.agent, model: lastUser!.model, auto: true })
            continue
          }

          const agent = yield* agents.get(lastUser!.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser!.agent}".${hint}` })
            yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const maxSteps = agent.steps ?? Infinity
          const isLastStep = step >= maxSteps
          msgs = yield* Effect.promise(() => insertReminders({ messages: msgs, agent, session }))

          const msg = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            parentID: lastUser!.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser!.variant,
            path: { cwd: Instance.directory, root: Instance.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          })
          const ctrl = new AbortController()
          const handle = yield* processor.create({
            assistantMessage: msg as MessageV2.Assistant,
            sessionID,
            model,
            abort: ctrl.signal,
          })

          const outcome: "break" | "continue" = yield* Effect.onExit(
            Effect.gen(function* () {
              const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
              const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

              const tools = yield* Effect.promise(() =>
                resolveTools({
                  agent,
                  session,
                  model,
                  tools: lastUser!.tools,
                  processor: handle,
                  bypassAgentCheck,
                  messages: msgs,
                }),
              )

              if (lastUser!.format?.type === "json_schema") {
                tools["StructuredOutput"] = createStructuredOutputTool({
                  schema: lastUser!.format.schema,
                  onSuccess(output) {
                    structured = output
                  },
                })
              }

              if (step === 1) SessionSummary.summarize({ sessionID, messageID: lastUser!.id })

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

              const [skills, env, instructions, modelMsgs] = yield* Effect.promise(() =>
                Promise.all([
                  SystemPrompt.skills(agent),
                  SystemPrompt.environment(model),
                  InstructionPrompt.system(),
                  MessageV2.toModelMessages(msgs, model),
                ]),
              )
              const system = [...env, ...(skills ? [skills] : []), ...instructions]
              const format = lastUser!.format ?? { type: "text" as const }
              if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
              const result = yield* handle.process({
                user: lastUser!,
                agent,
                permission: session.permission,
                abort: ctrl.signal,
                sessionID,
                system,
                messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
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
                if (format.type === "json_schema") {
                  handle.message.error = new MessageV2.StructuredOutputError({
                    message: "Model did not produce structured output",
                    retries: 0,
                  }).toObject()
                  yield* sessions.updateMessage(handle.message)
                  return "break" as const
                }
              }

              if (result === "stop") return "break" as const
              if (result === "compact") {
                yield* compaction.create({
                  sessionID,
                  agent: lastUser!.agent,
                  model: lastUser!.model,
                  auto: true,
                  overflow: !handle.message.finish,
                })
              }
              return "continue" as const
            }),
            (exit) =>
              Effect.gen(function* () {
                ctrl.abort()
                if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) yield* handle.abort()
                InstructionPrompt.clear(handle.message.id)
              }),
          )
          if (outcome === "break") break
          continue
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        return yield* lastAssistant(sessionID)
      })

      type State = { loops: Map<string, LoopEntry>; shells: Map<string, Fiber.Fiber<MessageV2.WithParts, unknown>> }

      const awaitFiber = <A>(fiber: Fiber.Fiber<A, unknown>, fallback: Effect.Effect<A>) =>
        Effect.gen(function* () {
          const exit = yield* Fiber.await(fiber)
          if (Exit.isSuccess(exit)) return exit.value
          if (Cause.hasInterruptsOnly(exit.cause)) return yield* fallback
          return yield* Effect.failCause(exit.cause as Cause.Cause<never>)
        })

      const startLoop = Effect.fnUntraced(function* (s: State, sessionID: SessionID) {
        const fiber = yield* runLoop(sessionID).pipe(
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              const entry = s.loops.get(sessionID)
              if (entry) {
                // On interrupt, resolve queued callers with the last assistant message
                const resolved =
                  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
                    ? Exit.succeed(yield* lastAssistant(sessionID))
                    : exit
                for (const d of entry.queue) yield* Deferred.done(d, resolved)
              }
              s.loops.delete(sessionID)
              yield* status.set(sessionID, { type: "idle" })
            }),
          ),
          Effect.forkChild,
        )
        const entry = s.loops.get(sessionID)
        if (entry) {
          entry.fiber = fiber
        } else {
          s.loops.set(sessionID, { fiber, queue: [] })
        }
        return yield* awaitFiber(fiber, lastAssistant(sessionID))
      })

      const loop = Effect.fn("SessionPrompt.loop")(function* (input: z.infer<typeof LoopInput>) {
        const s = yield* InstanceState.get(cache)
        const existing = s.loops.get(input.sessionID)

        if (existing) {
          const d = yield* Deferred.make<MessageV2.WithParts, unknown>()
          existing.queue.push(d)
          return yield* Deferred.await(d).pipe(Effect.orDie)
        }

        // If a shell is running, queue — shell cleanup will start the loop
        if (s.shells.has(input.sessionID)) {
          const d = yield* Deferred.make<MessageV2.WithParts, unknown>()
          s.loops.set(input.sessionID, { queue: [d] })
          return yield* Deferred.await(d).pipe(Effect.orDie)
        }

        return yield* startLoop(s, input.sessionID)
      })

      const shell = Effect.fn("SessionPrompt.shell")(function* (input: ShellInput) {
        const s = yield* InstanceState.get(cache)
        if (s.loops.has(input.sessionID) || s.shells.has(input.sessionID)) {
          throw new Session.BusyError(input.sessionID)
        }

        const fiber = yield* Effect.promise((signal) => shellImpl(input, signal)).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              s.shells.delete(input.sessionID)
              // If callers queued a loop while the shell was running, start it
              const pending = s.loops.get(input.sessionID)
              if (pending && pending.queue.length > 0) {
                yield* startLoop(s, input.sessionID).pipe(Effect.ignore, Effect.forkIn(scope))
              } else {
                yield* status.set(input.sessionID, { type: "idle" })
              }
            }),
          ),
          Effect.forkChild,
        )

        s.shells.set(input.sessionID, fiber)
        return yield* awaitFiber(fiber, lastAssistant(input.sessionID))
      })

      const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
        log.info("command", input)
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

        const taskModel = yield* Effect.promise(async () => {
          if (cmd.model) return Provider.parseModel(cmd.model)
          if (cmd.agent) {
            const cmdAgent = await Agent.get(cmd.agent)
            if (cmdAgent?.model) return cmdAgent.model
          }
          if (input.model) return Provider.parseModel(input.model)
          return await lastModelImpl(input.sessionID)
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
            : yield* Effect.promise(() => lastModelImpl(input.sessionID))
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
        yield* bus.publish(Command.Event.Executed, {
          name: input.command,
          sessionID: input.sessionID,
          arguments: input.arguments,
          messageID: result.info.id,
        })
        return result
      })

      return Service.of({
        assertNotBusy,
        cancel,
        prompt,
        loop,
        shell,
        command,
        resolvePromptParts,
      })
    }),
  )

  const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(SessionStatus.layer),
        Layer.provide(SessionCompaction.defaultLayer),
        Layer.provide(SessionProcessor.defaultLayer),
        Layer.provide(Command.defaultLayer),
        Layer.provide(MCP.defaultLayer),
        Layer.provide(LSP.defaultLayer),
        Layer.provide(FileTime.layer),
        Layer.provide(AppFileSystem.defaultLayer),
        Layer.provide(Plugin.defaultLayer),
        Layer.provide(Session.defaultLayer),
        Layer.provide(Agent.defaultLayer),
        Layer.provide(Bus.layer),
      ),
    ),
  )
  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function assertNotBusy(sessionID: SessionID) {
    return runPromise((svc) => svc.assertNotBusy(sessionID))
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

  export async function prompt(input: PromptInput) {
    return runPromise((svc) => svc.prompt(input))
  }

  export async function resolvePromptParts(template: string) {
    return runPromise((svc) => svc.resolvePromptParts(template))
  }

  export async function cancel(sessionID: SessionID) {
    return runPromise((svc) => svc.cancel(sessionID))
  }

  export const LoopInput = z.object({
    sessionID: SessionID.zod,
  })

  export async function loop(input: z.infer<typeof LoopInput>) {
    return runPromise((svc) => svc.loop(input))
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
    return runPromise((svc) => svc.shell(input))
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
    return runPromise((svc) => svc.command(input))
  }

  async function lastModelImpl(sessionID: SessionID) {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.model) return item.info.model
    }
    return Provider.defaultModel()
  }

  async function handleSubtask(input: {
    task: MessageV2.SubtaskPart
    model: Provider.Model
    lastUser: MessageV2.User
    sessionID: SessionID
    session: Session.Info
    msgs: MessageV2.WithParts[]
    signal: AbortSignal
  }) {
    const { task, model, lastUser, sessionID, session, msgs, signal } = input
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
      path: { cwd: Instance.directory, root: Instance.worktree },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: taskModel.id,
      providerID: taskModel.providerID,
      time: { created: Date.now() },
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
        input: { prompt: task.prompt, description: task.description, subagent_type: task.agent, command: task.command },
        time: { start: Date.now() },
      },
    })) as MessageV2.ToolPart
    const taskArgs = {
      prompt: task.prompt,
      description: task.description,
      subagent_type: task.agent,
      command: task.command,
    }
    await Plugin.trigger("tool.execute.before", { tool: "task", sessionID, callID: part.id }, { args: taskArgs })
    let executionError: Error | undefined
    const taskAgent = await Agent.get(task.agent)
    if (!taskAgent) {
      const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
      Bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
      throw error
    }
    const taskCtx: Tool.Context = {
      agent: task.agent,
      messageID: assistantMessage.id,
      sessionID,
      abort: signal,
      callID: part.callID,
      extra: { bypassAgentCheck: true },
      messages: msgs,
      async metadata(val) {
        part = (await Session.updatePart({
          ...part,
          type: "tool",
          state: { ...part.state, ...val },
        } satisfies MessageV2.ToolPart)) as MessageV2.ToolPart
      },
      async ask(req) {
        await Permission.ask({
          ...req,
          sessionID,
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
    await Plugin.trigger("tool.execute.after", { tool: "task", sessionID, callID: part.id, args: taskArgs }, result)
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
          time: { ...part.state.time, end: Date.now() },
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
          metadata: part.state.status === "pending" ? undefined : part.state.metadata,
          input: part.state.input,
        },
      } satisfies MessageV2.ToolPart)
    }
    if (task.command) {
      const summaryUserMsg: MessageV2.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
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
  }

  /** @internal Exported for testing */
  export async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: Pick<SessionProcessor.Handle, "message" | "partFromToolCall">
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
          )
          const result = await item.execute(args, ctx)
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
          )
          return output
        },
      })
    }

    for (const [key, item] of Object.entries(await MCP.tools())) {
      const execute = item.execute
      if (!execute) continue

      const schema = await asSchema(item.inputSchema).jsonSchema
      const transformed = ProviderTransform.schema(input.model, schema)
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
      toModelOutput({ output }) {
        return {
          type: "text",
          value: output.output,
        }
      },
    })
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

  async function shellImpl(input: ShellInput, signal: AbortSignal): Promise<MessageV2.WithParts> {
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
    const model = input.model ?? agent.model ?? (await lastModelImpl(input.sessionID))
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
    const sh = Shell.preferred()
    const shellName = (process.platform === "win32" ? path.win32.basename(sh, ".exe") : path.basename(sh)).toLowerCase()

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
    )
    const proc = spawn(sh, args, {
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

    if (signal.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill()
    }

    signal.addEventListener("abort", abortHandler, { once: true })

    await new Promise<void>((resolve) => {
      proc.on("close", () => {
        exited = true
        signal.removeEventListener("abort", abortHandler)
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

  const bashRegex = /!`([^`]+)`/g
  // Match [Image N] as single token, quoted strings, or non-space sequences
  const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
  const placeholderRegex = /\$(\d+)/g
  const quoteTrimRegex = /^["']|["']$/g
}
