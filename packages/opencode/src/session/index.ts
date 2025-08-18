import path from "path"
import { spawn } from "child_process"
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
  type StreamTextResult,
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
import { LSP } from "../lsp"
import { ReadTool } from "../tool/read"
import { mergeDeep, pipe, splitWhen } from "remeda"
import { ToolRegistry } from "../tool/registry"
import { Plugin } from "../plugin"
import { Agent } from "../agent/agent"
import { Permission } from "../permission"
import { Wildcard } from "../util/wildcard"
import { ulid } from "ulid"
import { defer } from "../util/defer"

export namespace Session {
  const log = Log.create({ service: "session" })

  const OUTPUT_TOKEN_MAX = 32_000

  const parentSessionTitlePrefix = "New session - "
  const childSessionTitlePrefix = "Child session - "

  function createDefaultTitle(isChild = false) {
    return (isChild ? childSessionTitlePrefix : parentSessionTitlePrefix) + new Date().toISOString()
  }

  function isDefaultTitle(title: string) {
    return title.startsWith(parentSessionTitlePrefix)
  }

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
          partID: z.string().optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
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
      const autoCompacting = new Map<string, boolean>()
      const queued = new Map<
        string,
        {
          input: ChatInput
          message: MessageV2.User
          parts: MessageV2.Part[]
          processed: boolean
          callback: (input: { info: MessageV2.Assistant; parts: MessageV2.Part[] }) => void
        }[]
      >()

      return {
        sessions,
        messages,
        pending,
        autoCompacting,
        queued,
      }
    },
    async (state) => {
      for (const [_, controller] of state.pending) {
        controller.abort()
      }
    },
  )

  export async function create(parentID?: string, title?: string) {
    const result: Info = {
      id: Identifier.descending("session"),
      version: Installation.VERSION,
      parentID,
      title: title ?? createDefaultTitle(!!parentID),
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    log.info("created", result)
    state().sessions.set(result.id, result)
    await Storage.writeJSON("session/info/" + result.id, result)
    const cfg = await Config.get()
    if (!result.parentID && (Flag.OPENCODE_AUTO_SHARE || cfg.share === "auto"))
      share(result.id)
        .then((share) => {
          update(result.id, (draft) => {
            draft.share = share
          })
        })
        .catch(() => {
          // Silently ignore sharing errors during session creation
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
    const cfg = await Config.get()
    if (cfg.share === "disabled") {
      throw new Error("Sharing is disabled in configuration")
    }

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
      await Share.sync("session/message/" + id + "/" + msg.info.id, msg.info)
      for (const part of msg.parts) {
        await Share.sync("session/part/" + id + "/" + msg.info.id + "/" + part.id, part)
      }
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
    const result = [] as {
      info: MessageV2.Info
      parts: MessageV2.Part[]
    }[]
    for (const p of await Storage.list("session/message/" + sessionID)) {
      const read = await Storage.readJSON<MessageV2.Info>(p)
      result.push({
        info: read,
        parts: await getParts(sessionID, read.id),
      })
    }
    result.sort((a, b) => (a.info.id > b.info.id ? 1 : -1))
    return result
  }

  export async function getMessage(sessionID: string, messageID: string) {
    return {
      info: await Storage.readJSON<MessageV2.Info>("session/message/" + sessionID + "/" + messageID),
      parts: await getParts(sessionID, messageID),
    }
  }

  export async function getParts(sessionID: string, messageID: string) {
    const result = [] as MessageV2.Part[]
    for (const item of await Storage.list("session/part/" + sessionID + "/" + messageID)) {
      const read = await Storage.readJSON<MessageV2.Part>(item)
      result.push(read)
    }
    result.sort((a, b) => (a.id > b.id ? 1 : -1))
    return result
  }

  export async function* list() {
    for (const item of await Storage.list("session/info")) {
      const sessionID = path.basename(item, ".json")
      yield get(sessionID)
    }
  }

  export async function children(parentID: string) {
    const result = [] as Session.Info[]
    for (const item of await Storage.list("session/info")) {
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
    log.info("aborting", {
      sessionID,
    })
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

  async function updatePart(part: MessageV2.Part) {
    await Storage.writeJSON(["session", "part", part.sessionID, part.messageID, part.id].join("/"), part)
    Bus.publish(MessageV2.Event.PartUpdated, {
      part,
    })
    return part
  }

  export const ChatInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    providerID: z.string(),
    modelID: z.string(),
    agent: z.string().optional(),
    system: z.string().optional(),
    tools: z.record(z.boolean()).optional(),
    parts: z.array(
      z.discriminatedUnion("type", [
        MessageV2.TextPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .openapi({
            ref: "TextPartInput",
          }),
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .openapi({
            ref: "FilePartInput",
          }),
        MessageV2.AgentPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .openapi({
            ref: "AgentPartInput",
          }),
      ]),
    ),
  })
  export type ChatInput = z.infer<typeof ChatInput>

  export async function chat(
    input: z.infer<typeof ChatInput>,
  ): Promise<{ info: MessageV2.Assistant; parts: MessageV2.Part[] }> {
    const l = log.clone().tag("session", input.sessionID)
    l.info("chatting")

    const inputAgent = input.agent ?? "build"

    // Process revert cleanup first, before creating new messages
    const session = await get(input.sessionID)
    if (session.revert) {
      let msgs = await messages(input.sessionID)
      const messageID = session.revert.messageID
      const [preserve, remove] = splitWhen(msgs, (x) => x.info.id === messageID)
      msgs = preserve
      for (const msg of remove) {
        await Storage.remove(`session/message/${input.sessionID}/${msg.info.id}`)
        await Bus.publish(MessageV2.Event.Removed, { sessionID: input.sessionID, messageID: msg.info.id })
      }
      const last = preserve.at(-1)
      if (session.revert.partID && last) {
        const partID = session.revert.partID
        const [preserveParts, removeParts] = splitWhen(last.parts, (x) => x.id === partID)
        last.parts = preserveParts
        for (const part of removeParts) {
          await Storage.remove(`session/part/${input.sessionID}/${last.info.id}/${part.id}`)
          await Bus.publish(MessageV2.Event.PartRemoved, {
            sessionID: input.sessionID,
            messageID: last.info.id,
            partID: part.id,
          })
        }
      }
      await update(input.sessionID, (draft) => {
        draft.revert = undefined
      })
    }
    const userMsg: MessageV2.Info = {
      id: input.messageID ?? Identifier.ascending("message"),
      role: "user",
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
    }

    const app = App.info()
    const userParts = await Promise.all(
      input.parts.map(async (part): Promise<MessageV2.Part[]> => {
        if (part.type === "file") {
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    id: Identifier.ascending("part"),
                    messageID: userMsg.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    id: Identifier.ascending("part"),
                    messageID: userMsg.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: Buffer.from(part.url, "base64url").toString(),
                  },
                  {
                    ...part,
                    id: part.id ?? Identifier.ascending("part"),
                    messageID: userMsg.id,
                    sessionID: input.sessionID,
                  },
                ]
              }
              break
            case "file:":
              // have to normalize, symbol search returns absolute paths
              // Decode the pathname since URL constructor doesn't automatically decode it
              const filePath = decodeURIComponent(url.pathname)

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
                const result = await ReadTool.init().then((t) =>
                  t.execute(args, {
                    sessionID: input.sessionID,
                    abort: new AbortController().signal,
                    agent: input.agent!,
                    messageID: userMsg.id,
                    extra: { bypassCwdCheck: true },
                    metadata: async () => {},
                  }),
                )
                return [
                  {
                    id: Identifier.ascending("part"),
                    messageID: userMsg.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    id: Identifier.ascending("part"),
                    messageID: userMsg.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  },
                  {
                    ...part,
                    id: part.id ?? Identifier.ascending("part"),
                    messageID: userMsg.id,
                    sessionID: input.sessionID,
                  },
                ]
              }

              let file = Bun.file(filePath)
              FileTime.read(input.sessionID, filePath)
              return [
                {
                  id: Identifier.ascending("part"),
                  messageID: userMsg.id,
                  sessionID: input.sessionID,
                  type: "text",
                  text: `Called the Read tool with the following input: {\"filePath\":\"${filePath}\"}`,
                  synthetic: true,
                },
                {
                  id: part.id ?? Identifier.ascending("part"),
                  messageID: userMsg.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url: `data:${part.mime};base64,` + Buffer.from(await file.bytes()).toString("base64"),
                  mime: part.mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
          }
        }

        if (part.type === "agent") {
          return [
            {
              id: Identifier.ascending("part"),
              ...part,
              messageID: userMsg.id,
              sessionID: input.sessionID,
            },
            {
              id: Identifier.ascending("part"),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                "Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name,
            },
          ]
        }

        return [
          {
            id: Identifier.ascending("part"),
            ...part,
            messageID: userMsg.id,
            sessionID: input.sessionID,
          },
        ]
      }),
    ).then((x) => x.flat())
    await Plugin.trigger(
      "chat.message",
      {},
      {
        message: userMsg,
        parts: userParts,
      },
    )
    await updateMessage(userMsg)
    for (const part of userParts) {
      await updatePart(part)
    }

    // mark session as updated
    // used for session list sorting (indicates when session was most recently interacted with)
    await update(input.sessionID, (_draft) => {})

    if (isLocked(input.sessionID)) {
      return new Promise((resolve) => {
        const queue = state().queued.get(input.sessionID) ?? []
        queue.push({
          input: input,
          message: userMsg,
          parts: userParts,
          processed: false,
          callback: resolve,
        })
        state().queued.set(input.sessionID, queue)
      })
    }

    const model = await Provider.getModel(input.providerID, input.modelID)
    let msgs = await messages(input.sessionID)

    const previous = msgs.filter((x) => x.info.role === "assistant").at(-1)?.info as MessageV2.Assistant
    const outputLimit = Math.min(model.info.limit.output, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX

    // auto summarize if too long
    if (previous && previous.tokens) {
      const tokens =
        previous.tokens.input + previous.tokens.cache.read + previous.tokens.cache.write + previous.tokens.output
      if (model.info.limit.context && tokens > Math.max((model.info.limit.context - outputLimit) * 0.9, 0)) {
        state().autoCompacting.set(input.sessionID, true)

        await summarize({
          sessionID: input.sessionID,
          providerID: input.providerID,
          modelID: input.modelID,
        })
        return chat(input)
      }
    }
    using abort = lock(input.sessionID)

    const lastSummary = msgs.findLast((msg) => msg.info.role === "assistant" && msg.info.summary === true)
    if (lastSummary) msgs = msgs.filter((msg) => msg.info.id >= lastSummary.info.id)

    if (msgs.filter((m) => m.info.role === "user").length === 1 && !session.parentID && isDefaultTitle(session.title)) {
      const small = (await Provider.getSmallModel(input.providerID)) ?? model
      generateText({
        maxOutputTokens: small.info.reasoning ? 1024 : 20,
        providerOptions: {
          [input.providerID]: {
            ...small.info.options,
            ...ProviderTransform.options(input.providerID, small.info.id, input.sessionID),
          },
        },
        messages: [
          ...SystemPrompt.title(input.providerID).map(
            (x): ModelMessage => ({
              role: "system",
              content: x,
            }),
          ),
          ...MessageV2.toModelMessage([
            {
              info: {
                id: Identifier.ascending("message"),
                role: "user",
                sessionID: input.sessionID,
                time: {
                  created: Date.now(),
                },
              },
              parts: userParts,
            },
          ]),
        ],
        model: small.language,
      })
        .then((result) => {
          if (result.text)
            return Session.update(input.sessionID, (draft) => {
              const cleaned = result.text.replace(/<think>[\s\S]*?<\/think>\s*/g, "")
              const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
              draft.title = title.trim()
            })
        })
        .catch(() => {})
    }

    const agent = await Agent.get(inputAgent)
    if (agent.name === "plan") {
      msgs.at(-1)?.parts.push({
        id: Identifier.ascending("part"),
        messageID: userMsg.id,
        sessionID: input.sessionID,
        type: "text",
        text: PROMPT_PLAN,
        synthetic: true,
      })
    }
    let system = SystemPrompt.header(input.providerID)
    system.push(
      ...(() => {
        if (input.system) return [input.system]
        if (agent.prompt) return [agent.prompt]
        return SystemPrompt.provider(input.modelID)
      })(),
    )
    system.push(...(await SystemPrompt.environment()))
    system.push(...(await SystemPrompt.custom()))
    // max 2 system prompt messages for caching purposes
    const [first, ...rest] = system
    system = [first, rest.join("\n")]

    const assistantMsg: MessageV2.Info = {
      id: Identifier.ascending("message"),
      role: "assistant",
      system,
      mode: inputAgent,
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
    await updateMessage(assistantMsg)
    await using _ = defer(async () => {
      if (assistantMsg.time.completed) return
      await Storage.remove(`session/message/${input.sessionID}/${assistantMsg.id}`)
      await Bus.publish(MessageV2.Event.Removed, { sessionID: input.sessionID, messageID: assistantMsg.id })
    })
    const tools: Record<string, AITool> = {}

    const processor = createProcessor(assistantMsg, model.info)

    const enabledTools = pipe(
      agent.tools,
      mergeDeep(await ToolRegistry.enabled(input.providerID, input.modelID, agent)),
      mergeDeep(input.tools ?? {}),
    )
    for (const item of await ToolRegistry.tools(input.providerID, input.modelID)) {
      if (Wildcard.all(item.id, enabledTools) === false) continue
      tools[item.id] = tool({
        id: item.id as any,
        description: item.description,
        inputSchema: item.parameters as ZodSchema,
        async execute(args, options) {
          await Plugin.trigger(
            "tool.execute.before",
            {
              tool: item.id,
              sessionID: input.sessionID,
              callID: options.toolCallId,
            },
            {
              args,
            },
          )
          const result = await item.execute(args, {
            sessionID: input.sessionID,
            abort: options.abortSignal!,
            messageID: assistantMsg.id,
            callID: options.toolCallId,
            agent: agent.name,
            metadata: async (val) => {
              const match = processor.partFromToolCall(options.toolCallId)
              if (match && match.state.status === "running") {
                await updatePart({
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
          })
          await Plugin.trigger(
            "tool.execute.after",
            {
              tool: item.id,
              sessionID: input.sessionID,
              callID: options.toolCallId,
            },
            result,
          )
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
      if (Wildcard.all(key, enabledTools) === false) continue
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

    const params = await Plugin.trigger(
      "chat.params",
      {
        model: model.info,
        provider: await Provider.getProvider(input.providerID),
        message: userMsg,
      },
      {
        temperature: model.info.temperature
          ? (agent.temperature ?? ProviderTransform.temperature(input.providerID, input.modelID))
          : undefined,
        topP: agent.topP ?? ProviderTransform.topP(input.providerID, input.modelID),
        options: {
          ...ProviderTransform.options(input.providerID, input.modelID, input.sessionID),
          ...model.info.options,
          ...agent.options,
        },
      },
    )
    const stream = streamText({
      onError(e) {
        log.error("streamText error", {
          error: e,
        })
      },
      async prepareStep({ messages }) {
        const queue = (state().queued.get(input.sessionID) ?? []).filter((x) => !x.processed)
        if (queue.length) {
          for (const item of queue) {
            if (item.processed) continue
            messages.push(
              ...MessageV2.toModelMessage([
                {
                  info: item.message,
                  parts: item.parts,
                },
              ]),
            )
            item.processed = true
          }
          assistantMsg.time.completed = Date.now()
          await updateMessage(assistantMsg)
          Object.assign(assistantMsg, {
            id: Identifier.ascending("message"),
            role: "assistant",
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
            mode: inputAgent,
            time: {
              created: Date.now(),
            },
            sessionID: input.sessionID,
          })
          await updateMessage(assistantMsg)
        }
        return {
          messages,
        }
      },
      async experimental_repairToolCall(input) {
        return {
          ...input.toolCall,
          input: JSON.stringify({
            tool: input.toolCall.toolName,
            error: input.error.message,
          }),
          toolName: "invalid",
        }
      },
      maxRetries: 3,
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      maxOutputTokens: outputLimit,
      abortSignal: abort.signal,
      stopWhen: async ({ steps }) => {
        if (steps.length >= 1000) {
          return true
        }

        // Check if processor flagged that we should stop
        if (processor.getShouldStop()) {
          return true
        }

        return false
      },
      providerOptions: {
        [input.providerID]: params.options,
      },
      temperature: params.temperature,
      topP: params.topP,
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...MessageV2.toModelMessage(msgs.filter((m) => !(m.info.role === "assistant" && m.info.error))),
      ],
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
    const result = await processor.process(stream)
    const queued = state().queued.get(input.sessionID) ?? []
    const unprocessed = queued.find((x) => !x.processed)
    if (unprocessed) {
      unprocessed.processed = true
      return chat(unprocessed.input)
    }
    for (const item of queued) {
      item.callback(result)
    }
    state().queued.delete(input.sessionID)
    return result
  }

  export const CommandInput = z.object({
    sessionID: Identifier.schema("session"),
    agent: z.string(),
    command: z.string(),
  })
  export type CommandInput = z.infer<typeof CommandInput>
  export async function shell(input: CommandInput) {
    using abort = lock(input.sessionID)
    const msg: MessageV2.Assistant = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      system: [],
      mode: input.agent,
      cost: 0,
      path: {
        cwd: App.info().path.cwd,
        root: App.info().path.root,
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
      modelID: "",
      providerID: "",
    }
    await updateMessage(msg)
    const part: MessageV2.Part = {
      type: "tool",
      id: Identifier.ascending("part"),
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
    await updatePart(part)
    const app = App.info()
    const shell = process.env["SHELL"] ?? "bash"
    const shellName = path.basename(shell)

    const scripts: Record<string, string> = {
      nu: input.command,
      fish: `eval "${input.command}"`,
    }

    const script =
      scripts[shellName] ??
      `[[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
       [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
       [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
       eval "${input.command}"`

    const isFishOrNu = shellName === "fish" || shellName === "nu"
    const args = isFishOrNu ? ["-c", script] : ["-c", "-l", script]

    const proc = spawn(shell, args, {
      cwd: app.path.cwd,
      signal: abort.signal,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
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
        updatePart(part)
      }
    })

    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        updatePart(part)
      }
    })

    await new Promise<void>((resolve) => {
      proc.on("close", () => {
        resolve()
      })
    })
    msg.time.completed = Date.now()
    await updateMessage(msg)
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
      await updatePart(part)
    }
    return { info: msg, parts: [part] }
  }

  function createProcessor(assistantMsg: MessageV2.Assistant, model: ModelsDev.Model) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let shouldStop = false
    return {
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      getShouldStop() {
        return shouldStop
      },
      async process(stream: StreamTextResult<Record<string, AITool>, never>) {
        try {
          let currentText: MessageV2.TextPart | undefined
          let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}

          for await (const value of stream.fullStream) {
            log.info("part", {
              type: value.type,
            })
            switch (value.type) {
              case "start":
                break

              case "reasoning-start":
                if (value.id in reasoningMap) {
                  continue
                }
                reasoningMap[value.id] = {
                  id: Identifier.ascending("part"),
                  messageID: assistantMsg.id,
                  sessionID: assistantMsg.sessionID,
                  type: "reasoning",
                  text: "",
                  time: {
                    start: Date.now(),
                  },
                }
                break

              case "reasoning-delta":
                if (value.id in reasoningMap) {
                  const part = reasoningMap[value.id]
                  part.text += value.text
                  if (part.text) await updatePart(part)
                }
                break

              case "reasoning-end":
                if (value.id in reasoningMap) {
                  const part = reasoningMap[value.id]
                  part.text = part.text.trimEnd()
                  part.metadata = value.providerMetadata
                  part.time = {
                    ...part.time,
                    end: Date.now(),
                  }
                  await updatePart(part)
                  delete reasoningMap[value.id]
                }
                break

              case "tool-input-start":
                const part = await updatePart({
                  id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                  messageID: assistantMsg.id,
                  sessionID: assistantMsg.sessionID,
                  type: "tool",
                  tool: value.toolName,
                  callID: value.id,
                  state: {
                    status: "pending",
                  },
                })
                toolcalls[value.id] = part as MessageV2.ToolPart
                break

              case "tool-input-delta":
                break

              case "tool-input-end":
                break

              case "tool-call": {
                const match = toolcalls[value.toolCallId]
                if (match) {
                  const part = await updatePart({
                    ...match,
                    tool: value.toolName,
                    state: {
                      status: "running",
                      input: value.input,
                      time: {
                        start: Date.now(),
                      },
                    },
                  })
                  toolcalls[value.toolCallId] = part as MessageV2.ToolPart
                }
                break
              }
              case "tool-result": {
                const match = toolcalls[value.toolCallId]
                if (match && match.state.status === "running") {
                  await updatePart({
                    ...match,
                    state: {
                      status: "completed",
                      input: value.input,
                      output: value.output.output,
                      metadata: value.output.metadata,
                      title: value.output.title,
                      time: {
                        start: match.state.time.start,
                        end: Date.now(),
                      },
                    },
                  })
                  delete toolcalls[value.toolCallId]
                }
                break
              }

              case "tool-error": {
                const match = toolcalls[value.toolCallId]
                if (match && match.state.status === "running") {
                  if (value.error instanceof Permission.RejectedError) {
                    shouldStop = true
                  }
                  await updatePart({
                    ...match,
                    state: {
                      status: "error",
                      input: value.input,
                      error: (value.error as any).toString(),
                      metadata: value.error instanceof Permission.RejectedError ? value.error.metadata : undefined,
                      time: {
                        start: match.state.time.start,
                        end: Date.now(),
                      },
                    },
                  })
                  delete toolcalls[value.toolCallId]
                }
                break
              }
              case "error":
                throw value.error

              case "start-step":
                await updatePart({
                  id: Identifier.ascending("part"),
                  messageID: assistantMsg.id,
                  sessionID: assistantMsg.sessionID,
                  type: "step-start",
                })
                snapshot = await Snapshot.track()
                break

              case "finish-step":
                const usage = getUsage(model, value.usage, value.providerMetadata)
                assistantMsg.cost += usage.cost
                assistantMsg.tokens = usage.tokens
                await updatePart({
                  id: Identifier.ascending("part"),
                  messageID: assistantMsg.id,
                  sessionID: assistantMsg.sessionID,
                  type: "step-finish",
                  tokens: usage.tokens,
                  cost: usage.cost,
                })
                await updateMessage(assistantMsg)
                if (snapshot) {
                  const patch = await Snapshot.patch(snapshot)
                  if (patch.files.length) {
                    await updatePart({
                      id: Identifier.ascending("part"),
                      messageID: assistantMsg.id,
                      sessionID: assistantMsg.sessionID,
                      type: "patch",
                      hash: patch.hash,
                      files: patch.files,
                    })
                  }
                  snapshot = undefined
                }
                break

              case "text-start":
                currentText = {
                  id: Identifier.ascending("part"),
                  messageID: assistantMsg.id,
                  sessionID: assistantMsg.sessionID,
                  type: "text",
                  text: "",
                  time: {
                    start: Date.now(),
                  },
                }
                break

              case "text-delta":
                if (currentText) {
                  currentText.text += value.text
                  if (currentText.text) await updatePart(currentText)
                }
                break

              case "text-end":
                if (currentText) {
                  currentText.text = currentText.text.trimEnd()
                  currentText.time = {
                    start: Date.now(),
                    end: Date.now(),
                  }
                  await updatePart(currentText)
                }
                currentText = undefined
                break

              case "finish":
                assistantMsg.time.completed = Date.now()
                await updateMessage(assistantMsg)
                break

              default:
                log.info("unhandled", {
                  ...value,
                })
                continue
            }
          }
        } catch (e) {
          log.error("", {
            error: e,
          })
          switch (true) {
            case e instanceof DOMException && e.name === "AbortError":
              assistantMsg.error = new MessageV2.AbortedError(
                { message: e.message },
                {
                  cause: e,
                },
              ).toObject()
              break
            case MessageV2.OutputLengthError.isInstance(e):
              assistantMsg.error = e
              break
            case LoadAPIKeyError.isInstance(e):
              assistantMsg.error = new MessageV2.AuthError(
                {
                  providerID: model.id,
                  message: e.message,
                },
                { cause: e },
              ).toObject()
              break
            case e instanceof Error:
              assistantMsg.error = new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()
              break
            default:
              assistantMsg.error = new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e })
          }
          Bus.publish(Event.Error, {
            sessionID: assistantMsg.sessionID,
            error: assistantMsg.error,
          })
        }
        const p = await getParts(assistantMsg.sessionID, assistantMsg.id)
        for (const part of p) {
          if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
            updatePart({
              ...part,
              state: {
                status: "error",
                error: "Tool execution aborted",
                time: {
                  start: Date.now(),
                  end: Date.now(),
                },
                input: {},
              },
            })
          }
        }
        assistantMsg.time.completed = Date.now()
        await updateMessage(assistantMsg)
        return { info: assistantMsg, parts: p }
      },
    }
  }

  export const RevertInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message"),
    partID: Identifier.schema("part").optional(),
  })
  export type RevertInput = z.infer<typeof RevertInput>

  export async function revert(input: RevertInput) {
    const all = await messages(input.sessionID)
    let lastUser: MessageV2.User | undefined
    const session = await get(input.sessionID)

    let revert: Info["revert"]
    const patches: Snapshot.Patch[] = []
    for (const msg of all) {
      if (msg.info.role === "user") lastUser = msg.info
      const remaining = []
      for (const part of msg.parts) {
        if (revert) {
          if (part.type === "patch") {
            patches.push(part)
          }
          continue
        }

        if (!revert) {
          if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
            // if no useful parts left in message, same as reverting whole message
            const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
            revert = {
              messageID: !partID && lastUser ? lastUser.id : msg.info.id,
              partID,
            }
          }
          remaining.push(part)
        }
      }
    }

    if (revert) {
      const session = await get(input.sessionID)
      revert.snapshot = session.revert?.snapshot ?? (await Snapshot.track())
      await Snapshot.revert(patches)
      if (revert.snapshot) revert.diff = await Snapshot.diff(revert.snapshot)
      return update(input.sessionID, (draft) => {
        draft.revert = revert
      })
    }
    return session
  }

  export async function unrevert(input: { sessionID: string }) {
    log.info("unreverting", input)
    const session = await get(input.sessionID)
    if (!session.revert) return session
    if (session.revert.snapshot) await Snapshot.restore(session.revert.snapshot)
    const next = await update(input.sessionID, (draft) => {
      draft.revert = undefined
    })
    return next
  }

  export async function summarize(input: { sessionID: string; providerID: string; modelID: string }) {
    using abort = lock(input.sessionID)
    const msgs = await messages(input.sessionID)
    const lastSummary = msgs.findLast((msg) => msg.info.role === "assistant" && msg.info.summary === true)
    const filtered = msgs.filter((msg) => !lastSummary || msg.info.id >= lastSummary.info.id)
    const model = await Provider.getModel(input.providerID, input.modelID)
    const app = App.info()
    const system = [
      ...SystemPrompt.summarize(input.providerID),
      ...(await SystemPrompt.environment()),
      ...(await SystemPrompt.custom()),
    ]

    const next: MessageV2.Info = {
      id: Identifier.ascending("message"),
      role: "assistant",
      sessionID: input.sessionID,
      system,
      mode: "build",
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

    const processor = createProcessor(next, model.info)
    const stream = streamText({
      maxRetries: 10,
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
    })

    const result = await processor.process(stream)
    return result
  }

  function isLocked(sessionID: string) {
    return state().pending.has(sessionID)
  }

  function lock(sessionID: string) {
    log.info("locking", { sessionID })
    if (state().pending.has(sessionID)) throw new BusyError(sessionID)
    const controller = new AbortController()
    state().pending.set(sessionID, controller)
    return {
      signal: controller.signal,
      async [Symbol.dispose]() {
        log.info("unlocking", { sessionID })
        state().pending.delete(sessionID)

        const isAutoCompacting = state().autoCompacting.get(sessionID) ?? false
        if (isAutoCompacting) {
          state().autoCompacting.delete(sessionID)
          return
        }

        const session = await get(sessionID)
        if (session.parentID) return

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
        .add(new Decimal(tokens.input).mul(model.cost?.input ?? 0).div(1_000_000))
        .add(new Decimal(tokens.output).mul(model.cost?.output ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.read).mul(model.cost?.cache_read ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.write).mul(model.cost?.cache_write ?? 0).div(1_000_000))
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
    messageID: string
  }) {
    const app = App.info()
    await Session.chat({
      sessionID: input.sessionID,
      messageID: input.messageID,
      providerID: input.providerID,
      modelID: input.modelID,
      parts: [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: PROMPT_INITIALIZE.replace("${path}", app.path.root),
        },
      ],
    })
    await App.initialize()
  }
}
