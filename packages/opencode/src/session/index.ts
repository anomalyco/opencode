import path from "path"
import { Decimal } from "decimal.js"
import { z, ZodSchema } from "zod"
import {
  generateText,
  LoadAPIKeyError,
  streamText,
  tool,
  wrapLanguageModel,
  type Tool as AITool,
  type LanguageModelUsage,
  type ProviderMetadata,
  type ModelMessage,
  stepCountIs,
} from "ai"

import PROMPT_INITIALIZE from "../session/prompt/initialize.txt"
import PROMPT_PLAN from "../session/prompt/plan.txt"

import { App } from "../app/app"
import { Bus } from "../bus"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Identifier } from "../id/id"
import { Installation } from "../installation"
import { MCP } from "../mcp"
import { Provider } from "../provider/provider"
import { ProviderTransform } from "../provider/transform"
import type { ModelsDev } from "../provider/models"
import { Share } from "../share/share"
import { Snapshot } from "../snapshot"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { NamedError } from "../util/error"
import { SystemPrompt } from "./system"
import { FileTime } from "../file/time"
import { MessageV2 } from "./message-v2"
import { Mode } from "./mode"
import { LSP } from "../lsp"
import { ReadTool } from "../tool/read"

export namespace Session {
  const log = Log.create({ service: "session" })

  const OUTPUT_TOKEN_MAX = 32_000

  export const Info = z
    .object({
      id: Identifier.schema("session"),
      parentID: Identifier.schema("session").optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
      revert: z
        .object({
          messageID: z.string(),
          part: z.number(),
          snapshot: z.string().optional(),
        })
        .optional(),
    })
    .openapi({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const ShareInfo = z
    .object({
      secret: z.string(),
      url: z.string(),
    })
    .openapi({
      ref: "SessionShare",
    })
  export type ShareInfo = z.output<typeof ShareInfo>

  export const Event = {
    Updated: Bus.event(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    Deleted: Bus.event(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    Idle: Bus.event(
      "session.idle",
      z.object({
        sessionID: z.string(),
      }),
    ),
    Error: Bus.event(
      "session.error",
      z.object({
        sessionID: z.string().optional(),
        error: MessageV2.Assistant.shape.error,
      }),
    ),
  }

  const state = App.state(
    "session",
    () => {
      const sessions = new Map<string, Info>()
      const messages = new Map<string, MessageV2.Info[]>()
      const pending = new Map<string, AbortController>()

      return {
        sessions,
        messages,
        pending,
      }
    },
    async (state) => {
      for (const [_, controller] of state.pending) {
        controller.abort()
      }
    },
  )

  export async function create(parentID?: string) {
    const result: Info = {
      id: Identifier.descending("session"),
      version: Installation.VERSION,
      parentID,
      title: (parentID ? "Child session - " : "New Session - ") + new Date().toISOString(),
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    log.info("created", result)
    state().sessions.set(result.id, result)
    await Storage.writeJSON("session/info/" + result.id, result)
    const cfg = await Config.get()
    if (!result.parentID && (Flag.OPENCODE_AUTO_SHARE || cfg.autoshare))
      share(result.id).then((share) => {
        update(result.id, (draft) => {
          draft.share = share
        })
      })
    Bus.publish(Event.Updated, {
      info: result,
    })
    return result
  }

  export async function get(id: string) {
    const result = state().sessions.get(id)
    if (result) {
      return result
    }
    const read = await Storage.readJSON<Info>("session/info/" + id)
    state().sessions.set(id, read)
    return read as Info
  }

  export async function getShare(id: string) {
    return Storage.readJSON<ShareInfo>("session/share/" + id)
  }

  export async function share(id: string) {
    const session = await get(id)
    if (session.share) return session.share
    const share = await Share.create(id)
    await update(id, (draft) => {
      draft.share = {
        url: share.url,
      }
    })
    await Storage.writeJSON<ShareInfo>("session/share/" + id, share)
    await Share.sync("session/info/" + id, session)
    for (const msg of await messages(id)) {
      await Share.sync("session/message/" + id + "/" + msg.id, msg)
    }
    return share
  }

  export async function unshare(id: string) {
    const share = await getShare(id)
    if (!share) return
    await Storage.remove("session/share/" + id)
    await update(id, (draft) => {
      draft.share = undefined
    })
    await Share.remove(id, share.secret)
  }

  export async function update(id: string, editor: (session: Info) => void) {
    const { sessions } = state()
    const session = await get(id)
    if (!session) return
    editor(session)
    session.time.updated = Date.now()
    sessions.set(id, session)
    await Storage.writeJSON("session/info/" + id, session)
    Bus.publish(Event.Updated, {
      info: session,
    })
    return session
  }

  export async function messages(sessionID: string) {
    const result = [] as MessageV2.Info[]
    const list = Storage.list("session/message/" + sessionID)
    for await (const p of list) {
      const read = await Storage.readJSON<MessageV2.Info>(p)
      result.push(read)
    }
    result.sort((a, b) => (a.id > b.id ? 1 : -1))
    return result
  }

  export async function getMessage(sessionID: string, messageID: string) {
    return Storage.readJSON<MessageV2.Info>("session/message/" + sessionID + "/" + messageID)
  }

  export async function* list() {
    for await (const item of Storage.list("session/info")) {
      const sessionID = path.basename(item, ".json")
      yield get(sessionID)
    }
  }

  export async function children(parentID: string) {
    const result = [] as Session.Info[]
    for await (const item of Storage.list("session/info")) {
      const sessionID = path.basename(item, ".json")
      const session = await get(sessionID)
      if (session.parentID !== parentID) continue
      result.push(session)
    }
    return result
  }

  export function abort(sessionID: string) {
    const controller = state().pending.get(sessionID)
    if (!controller) return false
    controller.abort()
    state().pending.delete(sessionID)
    return true
  }

  export async function remove(sessionID: string, emitEvent = true) {
    try {
      abort(sessionID)
      const session = await get(sessionID)
      for (const child of await children(sessionID)) {
        await remove(child.id, false)
      }
      await unshare(sessionID).catch(() => {})
      await Storage.remove(`session/info/${sessionID}`).catch(() => {})
      await Storage.removeDir(`session/message/${sessionID}/`).catch(() => {})
      state().sessions.delete(sessionID)
      state().messages.delete(sessionID)
      if (emitEvent) {
        Bus.publish(Event.Deleted, {
          info: session,
        })
      }
    } catch (e) {
      log.error(e)
    }
  }

  async function updateMessage(msg: MessageV2.Info) {
    await Storage.writeJSON("session/message/" + msg.sessionID + "/" + msg.id, msg)
    Bus.publish(MessageV2.Event.Updated, {
      info: msg,
    })
  }

  export async function chat(input: {
    sessionID: string
    providerID: string
    modelID: string
    mode?: string
    parts: MessageV2.UserPart[]
  }) {
    const l = log.clone().tag("session", input.sessionID)
    l.info("chatting")

    const model = await Provider.getModel(input.providerID, input.modelID)
    let msgs = await messages(input.sessionID)
    const session = await get(input.sessionID)

    if (session.revert) {
      const trimmed = []
      for (const msg of msgs) {
        if (msg.id > session.revert.messageID || (msg.id === session.revert.messageID && session.revert.part === 0)) {
          await Storage.remove("session/message/" + input.sessionID + "/" + msg.id)
          await Bus.publish(MessageV2.Event.Removed, {
            sessionID: input.sessionID,
            messageID: msg.id,
          })
          continue
        }

        if (msg.id === session.revert.messageID) {
          if (session.revert.part === 0) break
          msg.parts = msg.parts.slice(0, session.revert.part)
        }
        trimmed.push(msg)
      }
      msgs = trimmed
      await update(input.sessionID, (draft) => {
        draft.revert = undefined
      })
    }

    const previous = msgs.at(-1) as MessageV2.Assistant
    const outputLimit = Math.min(model.info.limit.output, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX

    // auto summarize if too long
    if (previous) {
      const tokens =
        previous.tokens.input + previous.tokens.cache.read + previous.tokens.cache.write + previous.tokens.output
      if (model.info.limit.context && tokens > Math.max((model.info.limit.context - outputLimit) * 0.9, 0)) {
        await summarize({
          sessionID: input.sessionID,
          providerID: input.providerID,
          modelID: input.modelID,
        })
        return chat(input)
      }
    }

    using abort = lock(input.sessionID)

    const lastSummary = msgs.findLast((msg) => msg.role === "assistant" && msg.summary === true)
    if (lastSummary) msgs = msgs.filter((msg) => msg.id >= lastSummary.id)

    const app = App.info()
    input.parts = await Promise.all(
      input.parts.map(async (part): Promise<MessageV2.UserPart[]> => {
        if (part.type === "file") {
          const url = new URL(part.url)
          switch (url.protocol) {
            case "file:":
              // have to normalize, symbol search returns absolute paths
              // Decode the pathname since URL constructor doesn't automatically decode it
              const pathname = decodeURIComponent(url.pathname)
              const relativePath = pathname.replace(app.path.cwd, ".")
              const filePath = path.join(app.path.cwd, relativePath)

              if (part.mime === "text/plain") {
                let offset: number | undefined = undefined
                let limit: number | undefined = undefined
                const range = {
                  start: url.searchParams.get("start"),
                  end: url.searchParams.get("end"),
                }
                if (range.start != null) {
                  const filePath = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  // some LSP servers (eg, gopls) don't give full range in
                  // workspace/symbol searches, so we'll try to find the
                  // symbol in the document to get the full range
                  if (start === end) {
                    const symbols = await LSP.documentSymbol(filePath)
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
                    offset = Math.max(start - 2, 0)
                    if (end) {
                      limit = end - offset + 2
                    }
                  }
                }
                const args = { filePath, offset, limit }
                const result = await ReadTool.execute(args, {
                  sessionID: input.sessionID,
                  abort: abort.signal,
                  messageID: "", // read tool doesn't use message ID
                  metadata: async () => {},
                })
                return [
                  {
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  },
                ]
              }

              let file = Bun.file(filePath)
              FileTime.read(input.sessionID, filePath)
              return [
                {
                  type: "text",
                  text: `Called the Read tool with the following input: {\"filePath\":\"${pathname}\"}`,
                  synthetic: true,
                },
                {
                  type: "file",
                  url: `data:${part.mime};base64,` + Buffer.from(await file.bytes()).toString("base64"),
                  mime: part.mime,
                  filename: part.filename!,
                },
              ]
          }
        }
        return [part]
      }),
    ).then((x) => x.flat())

    if (input.mode === "plan")
      input.parts.push({
        type: "text",
        text: PROMPT_PLAN,
        synthetic: true,
      })

    if (msgs.length === 0 && !session.parentID) {
      generateText({
        maxOutputTokens: input.providerID === "google" ? 1024 : 20,
        providerOptions: model.info.options,
        messages: [
          ...SystemPrompt.title(input.providerID).map(
            (x): ModelMessage => ({
              role: "system",
              content: x,
            }),
          ),
          ...MessageV2.toModelMessage([
            {
              id: Identifier.ascending("message"),
              role: "user",
              sessionID: input.sessionID,
              parts: input.parts,
              time: {
                created: Date.now(),
              },
            },
          ]),
        ],
        model: model.language,
      })
        .then((result) => {
          if (result.text)
            return Session.update(input.sessionID, (draft) => {
              draft.title = result.text
            })
        })
        .catch(() => {})
    }
    const msg: MessageV2.Info = {
      id: Identifier.ascending("message"),
      role: "user",
      sessionID: input.sessionID,
      parts: input.parts,
      time: {
        created: Date.now(),
      },
    }
    await updateMessage(msg)
    msgs.push(msg)

    const mode = await Mode.get(input.mode ?? "build")
    let system = mode.prompt ? [mode.prompt] : SystemPrompt.provider(input.providerID, input.modelID)
    system.push(...(await SystemPrompt.environment()))
    system.push(...(await SystemPrompt.custom()))
    // max 2 system prompt messages for caching purposes
    const [first, ...rest] = system
    system = [first, rest.join("\n")]

    const next: MessageV2.Info = {
      id: Identifier.ascending("message"),
      role: "assistant",
      parts: [],
      system,
      path: {
        cwd: app.path.cwd,
        root: app.path.root,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: input.modelID,
      providerID: input.providerID,
      time: {
        created: Date.now(),
      },
      sessionID: input.sessionID,
    }
    await updateMessage(next)
    const tools: Record<string, AITool> = {}

    for (const item of await Provider.tools(input.providerID)) {
      if (mode.tools[item.id] === false) continue
      tools[item.id] = tool({
        id: item.id as any,
        description: item.description,
        inputSchema: item.parameters as ZodSchema,
        async execute(args, opts) {
          const result = await item.execute(args, {
            sessionID: input.sessionID,
            abort: abort.signal,
            messageID: next.id,
            metadata: async (val) => {
              const match = next.parts.find(
                (p): p is MessageV2.ToolPart => p.type === "tool" && p.id === opts.toolCallId,
              )
              if (match && match.state.status === "running") {
                match.state.title = val.title
                match.state.metadata = val.metadata
              }
              await updateMessage(next)
            },
          })
          return result
        },
        toModelOutput(result) {
          return {
            type: "text",
            value: result.output,
          }
        },
      })
    }

    for (const [key, item] of Object.entries(await MCP.tools())) {
      if (mode.tools[key] === false) continue
      const execute = item.execute
      if (!execute) continue
      item.execute = async (args, opts) => {
        const result = await execute(args, opts)
        const output = result.content
          .filter((x: any) => x.type === "text")
          .map((x: any) => x.text)
          .join("\n\n")

        return {
          output,
        }
      }
      item.toModelOutput = (result) => {
        return {
          type: "text",
          value: result.output,
        }
      }
      tools[key] = item
    }

    let text: MessageV2.TextPart = {
      type: "text",
      text: "",
    }
    const result = streamText({
      onError() {},
      maxRetries: 10,
      maxOutputTokens: outputLimit,
      abortSignal: abort.signal,
      stopWhen: stepCountIs(1000),
      providerOptions: model.info.options,
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...MessageV2.toModelMessage(msgs),
      ],
      temperature: model.info.temperature ? 0 : undefined,
      tools: model.info.tool_call === false ? undefined : tools,
      model: wrapLanguageModel({
        model: model.language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.providerID, input.modelID)
              }
              return args.params
            },
          },
        ],
      }),
    })
    try {
      for await (const value of result.fullStream) {
        l.info("part", {
          type: value.type,
        })
        switch (value.type) {
          case "start":
            break

          case "tool-input-start":
            next.parts.push({
              type: "tool",
              tool: value.toolName,
              id: value.id,
              state: {
                status: "pending",
              },
            })
            Bus.publish(MessageV2.Event.PartUpdated, {
              part: next.parts[next.parts.length - 1],
              sessionID: next.sessionID,
              messageID: next.id,
            })
            break

          case "tool-input-delta":
            break

          case "tool-call": {
            const match = next.parts.find(
              (p): p is MessageV2.ToolPart => p.type === "tool" && p.id === value.toolCallId,
            )
            if (match) {
              match.state = {
                status: "running",
                input: value.input,
                time: {
                  start: Date.now(),
                },
              }
              Bus.publish(MessageV2.Event.PartUpdated, {
                part: match,
                sessionID: next.sessionID,
                messageID: next.id,
              })
            }
            break
          }
          case "tool-result": {
            const match = next.parts.find(
              (p): p is MessageV2.ToolPart => p.type === "tool" && p.id === value.toolCallId,
            )
            if (match && match.state.status === "running") {
              match.state = {
                status: "completed",
                input: value.input,
                output: value.output.output,
                metadata: value.output.metadata,
                title: value.output.title,
                time: {
                  start: match.state.time.start,
                  end: Date.now(),
                },
              }
              Bus.publish(MessageV2.Event.PartUpdated, {
                part: match,
                sessionID: next.sessionID,
                messageID: next.id,
              })
            }
            break
          }

          case "tool-error": {
            const match = next.parts.find(
              (p): p is MessageV2.ToolPart => p.type === "tool" && p.id === value.toolCallId,
            )
            if (match && match.state.status === "running") {
              match.state = {
                status: "error",
                input: value.input,
                error: (value.error as any).toString(),
                time: {
                  start: match.state.time.start,
                  end: Date.now(),
                },
              }
              Bus.publish(MessageV2.Event.PartUpdated, {
                part: match,
                sessionID: next.sessionID,
                messageID: next.id,
              })
            }
            break
          }

          case "error":
            throw value.error

          case "start-step":
            next.parts.push({
              type: "step-start",
            })
            break

          case "finish-step":
            const usage = getUsage(model.info, value.usage, value.providerMetadata)
            next.cost += usage.cost
            next.tokens = usage.tokens
            next.parts.push({
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            })
            break

          case "text-start":
            text = {
              type: "text",
              text: "",
            }
            break

          case "text":
            if (text.text === "") next.parts.push(text)
            text.text += value.text
            break

          case "text-end":
            Bus.publish(MessageV2.Event.PartUpdated, {
              part: text,
              sessionID: next.sessionID,
              messageID: next.id,
            })
            break

          case "finish":
            next.time.completed = Date.now()
            break

          default:
            l.info("unhandled", {
              ...value,
            })
            continue
        }
        await updateMessage(next)
      }
    } catch (e) {
      log.error("", {
        error: e,
      })
      switch (true) {
        case e instanceof DOMException && e.name === "AbortError":
          next.error = new MessageV2.AbortedError(
            { message: e.message },
            {
              cause: e,
            },
          ).toObject()
          break
        case MessageV2.OutputLengthError.isInstance(e):
          next.error = e
          break
        case LoadAPIKeyError.isInstance(e):
          next.error = new Provider.AuthError(
            {
              providerID: input.providerID,
              message: e.message,
            },
            { cause: e },
          ).toObject()
          break
        case e instanceof Error:
          next.error = new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()
          break
        default:
          next.error = new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e })
      }
      Bus.publish(Event.Error, {
        sessionID: next.sessionID,
        error: next.error,
      })
    }
    for (const part of next.parts) {
      if (part.type === "tool" && part.state.status !== "completed") {
        part.state = {
          status: "error",
          error: "Tool execution aborted",
          time: {
            start: Date.now(),
            end: Date.now(),
          },
          input: {},
        }
      }
    }
    next.time.completed = Date.now()
    await updateMessage(next)
    return next
  }

  export async function revert(_input: { sessionID: string; messageID: string; part: number }) {
    // TODO
    /*
    const message = await getMessage(input.sessionID, input.messageID)
    if (!message) return
    const part = message.parts[input.part]
    if (!part) return
    const session = await get(input.sessionID)
    const snapshot =
      session.revert?.snapshot ?? (await Snapshot.create(input.sessionID))
    const old = (() => {
      if (message.role === "assistant") {
        const lastTool = message.parts.findLast(
          (part, index) =>
            part.type === "tool-invocation" && index < input.part,
        )
        if (lastTool && lastTool.type === "tool-invocation")
          return message.metadata.tool[lastTool.toolInvocation.toolCallId]
            .snapshot
      }
      return message.metadata.snapshot
    })()
    if (old) await Snapshot.restore(input.sessionID, old)
    await update(input.sessionID, (draft) => {
      draft.revert = {
        messageID: input.messageID,
        part: input.part,
        snapshot,
      }
    })
    */
  }

  export async function unrevert(sessionID: string) {
    const session = await get(sessionID)
    if (!session) return
    if (!session.revert) return
    if (session.revert.snapshot) await Snapshot.restore(sessionID, session.revert.snapshot)
    update(sessionID, (draft) => {
      draft.revert = undefined
    })
  }

  export async function summarize(input: { sessionID: string; providerID: string; modelID: string }) {
    using abort = lock(input.sessionID)
    const msgs = await messages(input.sessionID)
    const lastSummary = msgs.findLast((msg) => msg.role === "assistant" && msg.summary === true)?.id
    const filtered = msgs.filter((msg) => !lastSummary || msg.id >= lastSummary)
    const model = await Provider.getModel(input.providerID, input.modelID)
    const app = App.info()
    const system = SystemPrompt.summarize(input.providerID)

    const next: MessageV2.Info = {
      id: Identifier.ascending("message"),
      role: "assistant",
      parts: [],
      sessionID: input.sessionID,
      system,
      path: {
        cwd: app.path.cwd,
        root: app.path.root,
      },
      summary: true,
      cost: 0,
      modelID: input.modelID,
      providerID: input.providerID,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: {
        created: Date.now(),
      },
    }
    await updateMessage(next)

    let text: MessageV2.TextPart | undefined
    const result = streamText({
      abortSignal: abort.signal,
      model: model.language,
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...MessageV2.toModelMessage(filtered),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Provide a detailed but concise summary of our conversation above. Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.",
            },
          ],
        },
      ],
      onStepFinish: async (step) => {
        const usage = getUsage(model.info, step.usage, step.providerMetadata)
        next.cost += usage.cost
        next.tokens = usage.tokens
        await updateMessage(next)
        if (text) {
          Bus.publish(MessageV2.Event.PartUpdated, {
            part: text,
            messageID: next.id,
            sessionID: next.sessionID,
          })
        }
        text = undefined
      },
      async onFinish(input) {
        const usage = getUsage(model.info, input.usage, input.providerMetadata)
        next.cost += usage.cost
        next.tokens = usage.tokens
        next.time.completed = Date.now()
        await updateMessage(next)
      },
    })

    try {
      for await (const value of result.fullStream) {
        switch (value.type) {
          case "text":
            if (!text) {
              text = {
                type: "text",
                text: value.text,
              }
              next.parts.push(text)
            } else text.text += value.text
            await updateMessage(next)
            break
        }
      }
    } catch (e: any) {
      log.error("summarize stream error", {
        error: e,
      })
      switch (true) {
        case e instanceof DOMException && e.name === "AbortError":
          next.error = new MessageV2.AbortedError(
            { message: e.message },
            {
              cause: e,
            },
          ).toObject()
          break
        case MessageV2.OutputLengthError.isInstance(e):
          next.error = e
          break
        case LoadAPIKeyError.isInstance(e):
          next.error = new Provider.AuthError(
            {
              providerID: input.providerID,
              message: e.message,
            },
            { cause: e },
          ).toObject()
          break
        case e instanceof Error:
          next.error = new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()
          break
        default:
          next.error = new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject()
      }
      Bus.publish(Event.Error, {
        error: next.error,
      })
    }
    next.time.completed = Date.now()
    await updateMessage(next)
  }

  function lock(sessionID: string) {
    log.info("locking", { sessionID })
    if (state().pending.has(sessionID)) throw new BusyError(sessionID)
    const controller = new AbortController()
    state().pending.set(sessionID, controller)
    return {
      signal: controller.signal,
      [Symbol.dispose]() {
        log.info("unlocking", { sessionID })
        state().pending.delete(sessionID)
        Bus.publish(Event.Idle, {
          sessionID,
        })
      },
    }
  }

  function getUsage(model: ModelsDev.Model, usage: LanguageModelUsage, metadata?: ProviderMetadata) {
    const tokens = {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
      reasoning: 0,
      cache: {
        write: (metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
          // @ts-expect-error
          metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
          0) as number,
        read: usage.cachedInputTokens ?? 0,
      },
    }
    return {
      cost: new Decimal(0)
        .add(new Decimal(tokens.input).mul(model.cost.input).div(1_000_000))
        .add(new Decimal(tokens.output).mul(model.cost.output).div(1_000_000))
        .add(new Decimal(tokens.cache.read).mul(model.cost.cache_read ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.write).mul(model.cost.cache_write ?? 0).div(1_000_000))
        .toNumber(),
      tokens,
    }
  }

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export async function initialize(input: { sessionID: string; modelID: string; providerID: string }) {
    const app = App.info()
    await Session.chat({
      sessionID: input.sessionID,
      providerID: input.providerID,
      modelID: input.modelID,
      parts: [
        {
          type: "text",
          text: PROMPT_INITIALIZE.replace("${path}", app.path.root),
        },
      ],
    })
    await App.initialize()
  }
}
