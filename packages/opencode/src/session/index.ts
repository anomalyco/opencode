import path from "path"
import { App } from "../app/app"
import { Identifier } from "../id/id"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import {
  generateText,
  LoadAPIKeyError,
  convertToCoreMessages,
  streamText,
  tool,
  type Tool as AITool,
  type LanguageModelUsage,
  type CoreMessage,
  type UIMessage,
  type ProviderMetadata,
  wrapLanguageModel,
} from "ai"
import { z, ZodSchema } from "zod"
import { Decimal } from "decimal.js"

import PROMPT_INITIALIZE from "../session/prompt/initialize.txt"

import { Share } from "../share/share"
import { Message } from "./message"
import { Bus } from "../bus"
import { Provider } from "../provider/provider"
import { MCP } from "../mcp"
import { NamedError } from "../util/error"
import type { Tool } from "../tool/tool"
import { SystemPrompt } from "./system"
import { Flag } from "../flag/flag"
import type { ModelsDev } from "../provider/models"
import { Installation } from "../installation"
import { Config } from "../config/config"
import { ProviderTransform } from "../provider/transform"
import { Snapshot } from "../snapshot"

export namespace Session {
  const log = Log.create({ service: "session" })

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
        error: Message.Info.shape.metadata.shape.error,
      }),
    ),
  }

  const state = App.state(
    "session",
    () => {
      const sessions = new Map<string, Info>()
      const messages = new Map<string, Message.Info[]>()
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
      title:
        (parentID ? "Child session - " : "New Session - ") +
        new Date().toISOString(),
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
    console.log("share", share)
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
    const result = [] as Message.Info[]
    const list = Storage.list("session/message/" + sessionID)
    for await (const p of list) {
      const read = await Storage.readJSON<Message.Info>(p)
      result.push(read)
    }
    result.sort((a, b) => (a.id > b.id ? 1 : -1))
    return result
  }

  export async function getMessage(sessionID: string, messageID: string) {
    return Storage.readJSON<Message.Info>(
      "session/message/" + sessionID + "/" + messageID,
    )
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

  async function updateMessage(msg: Message.Info) {
    await Storage.writeJSON(
      "session/message/" + msg.metadata.sessionID + "/" + msg.id,
      msg,
    )
    Bus.publish(Message.Event.Updated, {
      info: msg,
    })
  }

  export async function chat(input: {
    sessionID: string
    providerID: string
    modelID: string
    parts: Message.MessagePart[]
    system?: string[]
    tools?: Tool.Info[]
  }) {
    const l = log.clone().tag("session", input.sessionID)
    l.info("chatting")
    const model = await Provider.getModel(input.providerID, input.modelID)
    let msgs = await messages(input.sessionID)
    const session = await get(input.sessionID)

    if (session.revert) {
      const trimmed = []
      for (const msg of msgs) {
        if (
          msg.id > session.revert.messageID ||
          (msg.id === session.revert.messageID && session.revert.part === 0)
        ) {
          await Storage.remove(
            "session/message/" + input.sessionID + "/" + msg.id,
          )
          await Bus.publish(Message.Event.Removed, {
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

    const previous = msgs.at(-1)

    // auto summarize if too long
    if (previous?.metadata.assistant) {
      const tokens =
        previous.metadata.assistant.tokens.input +
        previous.metadata.assistant.tokens.cache.read +
        previous.metadata.assistant.tokens.cache.write +
        previous.metadata.assistant.tokens.output
      if (
        model.info.limit.context &&
        tokens >
          Math.max(
            (model.info.limit.context - (model.info.limit.output ?? 0)) * 0.9,
            0,
          )
      ) {
        await summarize({
          sessionID: input.sessionID,
          providerID: input.providerID,
          modelID: input.modelID,
        })
        return chat(input)
      }
    }

    using abort = lock(input.sessionID)

    const lastSummary = msgs.findLast(
      (msg) => msg.metadata.assistant?.summary === true,
    )
    if (lastSummary) msgs = msgs.filter((msg) => msg.id >= lastSummary.id)

    const app = App.info()
    if (msgs.length === 0 && !session.parentID) {
      generateText({
        maxTokens: input.providerID === "google" ? 1024 : 20,
        providerOptions: model.info.options,
        messages: [
          ...SystemPrompt.title(input.providerID).map(
            (x): CoreMessage => ({
              role: "system",
              content: x,
            }),
          ),
          ...convertToCoreMessages([
            {
              role: "user",
              content: "",
              parts: toParts(input.parts),
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
    const snapshot = await Snapshot.create(input.sessionID)
    const msg: Message.Info = {
      role: "user",
      id: Identifier.ascending("message"),
      parts: input.parts,
      metadata: {
        time: {
          created: Date.now(),
        },
        sessionID: input.sessionID,
        tool: {},
        snapshot,
      },
    }
    await updateMessage(msg)
    msgs.push(msg)

    const system = input.system ?? SystemPrompt.provider(input.providerID)
    system.push(...(await SystemPrompt.environment()))
    system.push(...(await SystemPrompt.custom()))

    const next: Message.Info = {
      id: Identifier.ascending("message"),
      role: "assistant",
      parts: [],
      metadata: {
        snapshot,
        assistant: {
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
        },
        time: {
          created: Date.now(),
        },
        sessionID: input.sessionID,
        tool: {},
      },
    }
    await updateMessage(next)
    const tools: Record<string, AITool> = {}

    for (const item of await Provider.tools(input.providerID)) {
      tools[item.id.replaceAll(".", "_")] = tool({
        id: item.id as any,
        description: item.description,
        parameters: item.parameters as ZodSchema,
        async execute(args, opts) {
          const start = Date.now()
          try {
            const result = await item.execute(args, {
              sessionID: input.sessionID,
              abort: abort.signal,
              messageID: next.id,
              metadata: async (val) => {
                next.metadata.tool[opts.toolCallId] = {
                  ...val,
                  time: {
                    start: 0,
                    end: 0,
                  },
                }
                await updateMessage(next)
              },
            })
            next.metadata!.tool![opts.toolCallId] = {
              ...result.metadata,
              snapshot: await Snapshot.create(input.sessionID),
              time: {
                start,
                end: Date.now(),
              },
            }
            await updateMessage(next)
            return result.output
          } catch (e: any) {
            next.metadata!.tool![opts.toolCallId] = {
              error: true,
              message: e.toString(),
              title: e.toString(),
              snapshot: await Snapshot.create(input.sessionID),
              time: {
                start,
                end: Date.now(),
              },
            }
            await updateMessage(next)
            return e.toString()
          }
        },
      })
    }

    for (const [key, item] of Object.entries(await MCP.tools())) {
      const execute = item.execute
      if (!execute) continue
      item.execute = async (args, opts) => {
        const start = Date.now()
        try {
          const result = await execute(args, opts)
          next.metadata!.tool![opts.toolCallId] = {
            ...result.metadata,
            snapshot: await Snapshot.create(input.sessionID),
            time: {
              start,
              end: Date.now(),
            },
          }
          await updateMessage(next)
          return result.content
            .filter((x: any) => x.type === "text")
            .map((x: any) => x.text)
            .join("\n\n")
        } catch (e: any) {
          next.metadata!.tool![opts.toolCallId] = {
            error: true,
            message: e.toString(),
            snapshot: await Snapshot.create(input.sessionID),
            title: "mcp",
            time: {
              start,
              end: Date.now(),
            },
          }
          await updateMessage(next)
          return e.toString()
        }
      }
      tools[key] = item
    }

    let text: Message.TextPart | undefined
    const result = streamText({
      onStepFinish: async (step) => {
        log.info("step finish", { finishReason: step.finishReason })
        const assistant = next.metadata!.assistant!
        const usage = getUsage(model.info, step.usage, step.providerMetadata)
        assistant.cost += usage.cost
        assistant.tokens = usage.tokens
        await updateMessage(next)
        if (text) {
          Bus.publish(Message.Event.PartUpdated, {
            part: text,
            messageID: next.id,
            sessionID: next.metadata.sessionID,
          })
        }
        text = undefined
      },
      onError(err) {
        log.error("callback error", err)
        switch (true) {
          case LoadAPIKeyError.isInstance(err.error):
            next.metadata.error = new Provider.AuthError(
              {
                providerID: input.providerID,
                message: err.error.message,
              },
              { cause: err.error },
            ).toObject()
            break
          case err.error instanceof Error:
            next.metadata.error = new NamedError.Unknown(
              { message: err.error.toString() },
              { cause: err.error },
            ).toObject()
            break
          default:
            next.metadata.error = new NamedError.Unknown(
              { message: JSON.stringify(err.error) },
              { cause: err.error },
            )
        }
        Bus.publish(Event.Error, {
          error: next.metadata.error,
        })
      },
      // async prepareStep(step) {
      //   next.parts.push({
      //     type: "step-start",
      //   })
      //   await updateMessage(next)
      //   return step
      // },
      toolCallStreaming: true,
      maxRetries: 10,
      maxTokens: Math.max(0, model.info.limit.output) || undefined,
      abortSignal: abort.signal,
      maxSteps: 1000,
      providerOptions: model.info.options,
      messages: [
        ...system.map(
          (x): CoreMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...convertToCoreMessages(
          msgs.map(toUIMessage).filter((x) => x.parts.length > 0),
        ),
      ],
      temperature: model.info.temperature ? 0 : undefined,
      tools: model.info.tool_call === false ? undefined : tools,
      model: wrapLanguageModel({
        model: model.language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                args.params.prompt = ProviderTransform.message(
                  args.params.prompt,
                  input.providerID,
                  input.modelID,
                )
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
          case "step-start":
            next.parts.push({
              type: "step-start",
            })
            break
          case "text-delta":
            if (!text) {
              text = {
                type: "text",
                text: value.textDelta,
              }
              next.parts.push(text)
              break
            } else text.text += value.textDelta
            break

          case "tool-call": {
            const [match] = next.parts.flatMap((p) =>
              p.type === "tool-invocation" &&
              p.toolInvocation.toolCallId === value.toolCallId
                ? [p]
                : [],
            )
            if (!match) break
            match.toolInvocation.args = value.args
            match.toolInvocation.state = "call"
            Bus.publish(Message.Event.PartUpdated, {
              part: match,
              messageID: next.id,
              sessionID: next.metadata.sessionID,
            })
            break
          }

          case "tool-call-streaming-start":
            next.parts.push({
              type: "tool-invocation",
              toolInvocation: {
                state: "partial-call",
                toolName: value.toolName,
                toolCallId: value.toolCallId,
                args: {},
              },
            })
            Bus.publish(Message.Event.PartUpdated, {
              part: next.parts[next.parts.length - 1],
              messageID: next.id,
              sessionID: next.metadata.sessionID,
            })
            break

          case "tool-call-delta":
            continue

          // for some reason ai sdk claims to not send this part but it does
          // @ts-expect-error
          case "tool-result":
            const match = next.parts.find(
              (p) =>
                p.type === "tool-invocation" &&
                // @ts-expect-error
                p.toolInvocation.toolCallId === value.toolCallId,
            )
            if (match && match.type === "tool-invocation") {
              match.toolInvocation = {
                // @ts-expect-error
                args: value.args,
                // @ts-expect-error
                toolCallId: value.toolCallId,
                // @ts-expect-error
                toolName: value.toolName,
                state: "result",
                // @ts-expect-error
                result: value.result as string,
              }
              Bus.publish(Message.Event.PartUpdated, {
                part: match,
                messageID: next.id,
                sessionID: next.metadata.sessionID,
              })
            }
            break

          case "finish":
            log.info("message finish", {
              reason: value.finishReason,
            })
            const assistant = next.metadata!.assistant!
            const usage = getUsage(
              model.info,
              value.usage,
              value.providerMetadata,
            )
            assistant.cost += usage.cost
            await updateMessage(next)
            if (value.finishReason === "length")
              throw new Message.OutputLengthError({})
            break
          default:
            l.info("unhandled", {
              type: value.type,
            })
            continue
        }
        await updateMessage(next)
      }
    } catch (e: any) {
      log.error("stream error", {
        error: e,
      })
      switch (true) {
        case Message.OutputLengthError.isInstance(e):
          next.metadata.error = e
          break
        case LoadAPIKeyError.isInstance(e):
          next.metadata.error = new Provider.AuthError(
            {
              providerID: input.providerID,
              message: e.message,
            },
            { cause: e },
          ).toObject()
          break
        case e instanceof Error:
          next.metadata.error = new NamedError.Unknown(
            { message: e.toString() },
            { cause: e },
          ).toObject()
          break
        default:
          next.metadata.error = new NamedError.Unknown(
            { message: JSON.stringify(e) },
            { cause: e },
          )
      }
      Bus.publish(Event.Error, {
        error: next.metadata.error,
      })
    }
    next.metadata!.time.completed = Date.now()
    for (const part of next.parts) {
      if (
        part.type === "tool-invocation" &&
        part.toolInvocation.state !== "result"
      ) {
        part.toolInvocation = {
          ...part.toolInvocation,
          state: "result",
          result: "request was aborted",
        }
      }
    }
    await updateMessage(next)
    return next
  }

  export async function revert(input: {
    sessionID: string
    messageID: string
    part: number
  }) {
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
  }

  export async function unrevert(sessionID: string) {
    const session = await get(sessionID)
    if (!session) return
    if (!session.revert) return
    if (session.revert.snapshot)
      await Snapshot.restore(sessionID, session.revert.snapshot)
    update(sessionID, (draft) => {
      draft.revert = undefined
    })
  }

  export async function summarize(input: {
    sessionID: string
    providerID: string
    modelID: string
  }) {
    using abort = lock(input.sessionID)
    const msgs = await messages(input.sessionID)
    const lastSummary = msgs.findLast(
      (msg) => msg.metadata.assistant?.summary === true,
    )?.id
    const filtered = msgs.filter((msg) => !lastSummary || msg.id >= lastSummary)
    const model = await Provider.getModel(input.providerID, input.modelID)
    const app = App.info()
    const system = SystemPrompt.summarize(input.providerID)

    const next: Message.Info = {
      id: Identifier.ascending("message"),
      role: "assistant",
      parts: [],
      metadata: {
        tool: {},
        sessionID: input.sessionID,
        assistant: {
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
        },
        time: {
          created: Date.now(),
        },
      },
    }
    await updateMessage(next)

    let text: Message.TextPart | undefined
    const result = streamText({
      abortSignal: abort.signal,
      model: model.language,
      messages: [
        ...system.map(
          (x): CoreMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...convertToCoreMessages(filtered.map(toUIMessage)),
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
        const assistant = next.metadata!.assistant!
        const usage = getUsage(model.info, step.usage, step.providerMetadata)
        assistant.cost += usage.cost
        assistant.tokens = usage.tokens
        await updateMessage(next)
        if (text) {
          Bus.publish(Message.Event.PartUpdated, {
            part: text,
            messageID: next.id,
            sessionID: next.metadata.sessionID,
          })
        }
        text = undefined
      },
      async onFinish(input) {
        const assistant = next.metadata!.assistant!
        const usage = getUsage(model.info, input.usage, input.providerMetadata)
        assistant.cost += usage.cost
        assistant.tokens = usage.tokens
        next.metadata!.time.completed = Date.now()
        await updateMessage(next)
      },
    })

    for await (const value of result.fullStream) {
      switch (value.type) {
        case "text-delta":
          if (!text) {
            text = {
              type: "text",
              text: value.textDelta,
            }
            next.parts.push(text)
          } else text.text += value.textDelta

          await updateMessage(next)
          break
      }
    }
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

  function getUsage(
    model: ModelsDev.Model,
    usage: LanguageModelUsage,
    metadata?: ProviderMetadata,
  ) {
    const tokens = {
      input: usage.promptTokens ?? 0,
      output: usage.completionTokens ?? 0,
      reasoning: 0,
      cache: {
        write: (metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
          // @ts-expect-error
          metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
          0) as number,
        read: (metadata?.["anthropic"]?.["cacheReadInputTokens"] ??
          // @ts-expect-error
          metadata?.["bedrock"]?.["usage"]?.["cacheReadInputTokens"] ??
          0) as number,
      },
    }
    return {
      cost: new Decimal(0)
        .add(new Decimal(tokens.input).mul(model.cost.input).div(1_000_000))
        .add(new Decimal(tokens.output).mul(model.cost.output).div(1_000_000))
        .add(
          new Decimal(tokens.cache.read)
            .mul(model.cost.cache_read ?? 0)
            .div(1_000_000),
        )
        .add(
          new Decimal(tokens.cache.write)
            .mul(model.cost.cache_write ?? 0)
            .div(1_000_000),
        )
        .toNumber(),
      tokens,
    }
  }

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export async function initialize(input: {
    sessionID: string
    modelID: string
    providerID: string
  }) {
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

function toUIMessage(msg: Message.Info): UIMessage {
  if (msg.role === "assistant") {
    return {
      id: msg.id,
      role: "assistant",
      content: "",
      parts: toParts(msg.parts),
    }
  }

  if (msg.role === "user") {
    return {
      id: msg.id,
      role: "user",
      content: "",
      parts: toParts(msg.parts),
    }
  }

  throw new Error("not implemented")
}

function toParts(parts: Message.MessagePart[]): UIMessage["parts"] {
  const result: UIMessage["parts"] = []
  for (const part of parts) {
    switch (part.type) {
      case "text":
        result.push({ type: "text", text: part.text })
        break
      case "file":
        result.push({
          type: "file",
          data: part.url,
          mimeType: part.mediaType,
        })
        break
      case "tool-invocation":
        result.push({
          type: "tool-invocation",
          toolInvocation: part.toolInvocation,
        })
        break
      case "step-start":
        result.push({
          type: "step-start",
        })
        break
      default:
        break
    }
  }
  return result
}
