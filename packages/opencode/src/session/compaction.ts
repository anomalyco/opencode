import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { SessionPrompt } from "./prompt"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { Auth } from "@/auth"
import { SystemPrompt } from "./system"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  function withoutTrailingSlash(url: string) {
    return url.endsWith("/") ? url.slice(0, -1) : url
  }

  type CodexCompactContentItem = {
    type: "input_text" | "output_text"
    text: string
  }

  type CodexCompactOutputItem =
    | {
        type: "message"
        role: string
        content: CodexCompactContentItem[]
      }
    | {
        type: "compaction"
        encrypted_content: string
      }

  function toCompactText(msg: MessageV2.WithParts): string {
    const chunks: string[] = []
    for (const part of msg.parts) {
      if (part.type === "text") {
        if (msg.info.role === "user" && part.ignored) continue
        if (part.text.trim()) chunks.push(part.text)
        continue
      }

      if (part.type === "reasoning") {
        if (part.text.trim()) chunks.push(part.text)
        continue
      }

      if (part.type === "tool") {
        if (part.state.status === "completed") {
          const output = part.state.time.compacted ? "[Old tool result content cleared]" : part.state.output
          if (output?.trim()) {
            chunks.push([`[tool:${part.tool}]`, output].join("\n"))
          }
        } else if (part.state.status === "error") {
          if (part.state.error?.trim()) {
            chunks.push([`[tool:${part.tool} error]`, part.state.error].join("\n"))
          }
        }
        continue
      }
    }
    return chunks.join("\n\n").trim()
  }

  function buildCodexCompactInput(messages: MessageV2.WithParts[]) {
    const input: Array<{ type: "message"; role: string; content: Array<{ type: "input_text"; text: string }> }> = []
    for (const msg of messages) {
      if (msg.info.role !== "user" && msg.info.role !== "assistant") continue
      const text = toCompactText(msg)
      if (!text) continue
      input.push({
        type: "message",
        role: msg.info.role,
        content: [{ type: "input_text", text }],
      })
    }
    return input
  }

  async function codexRemoteCompact(input: {
    model: Provider.Model
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
  }): Promise<{ summaryText: string; encryptedContent?: string }> {
    const provider = await Provider.getProvider(input.model.providerID)
    const fetchFn: typeof fetch = provider.options?.fetch ?? fetch
    const baseURL = withoutTrailingSlash(provider.options?.baseURL ?? input.model.api.url ?? "https://api.openai.com/v1")

    const headers = new Headers(provider.options?.headers ?? {})
    if (!headers.has("content-type")) headers.set("content-type", "application/json")
    if (!headers.has("session_id")) headers.set("session_id", input.sessionID)
    if (!headers.has("authorization")) {
      const apiKey = provider.options?.apiKey ?? provider.key
      if (apiKey) headers.set("authorization", `Bearer ${apiKey}`)
    }

    const body = {
      model: input.model.api.id,
      instructions: SystemPrompt.instructions(),
      input: buildCodexCompactInput(input.messages),
    }

    const res = await fetchFn(`${baseURL}/responses/compact`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: input.abort,
    })
    const text = await res.text().catch(() => "")
    if (!res.ok) {
      throw new Error(`remote compact failed (${res.status}): ${text.slice(0, 500)}`)
    }

    const parsed = JSON.parse(text) as { output?: CodexCompactOutputItem[] }
    const output = Array.isArray(parsed.output) ? parsed.output : []

    const summaryChunks: string[] = []
    let encryptedContent: string | undefined
    for (const item of output) {
      if (!item || typeof item !== "object" || !("type" in item)) continue
      if (item.type === "message") {
        for (const c of item.content ?? []) {
          if (c?.text && typeof c.text === "string") summaryChunks.push(c.text)
        }
      } else if (item.type === "compaction") {
        if (typeof item.encrypted_content === "string" && item.encrypted_content) {
          encryptedContent = item.encrypted_content
        }
      }
    }

    return {
      summaryText: summaryChunks.join("\n").trim(),
      encryptedContent,
    }
  }

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    const context = input.model.limit.context
    if (context === 0) return false
    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
    const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) || SessionPrompt.OUTPUT_TOKEN_MAX
    const usable = input.model.limit.input || context - output
    return count > usable
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  const PRUNE_PROTECTED_TOOLS = ["skill"]

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  export async function prune(input: { sessionID: string }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const msgs = await Session.messages({ sessionID: input.sessionID })
    let total = 0
    let pruned = 0
    const toPrune = []
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue

            if (part.state.time.compacted) break loop
            const estimate = Token.estimate(part.state.output)
            total += estimate
            if (total > PRUNE_PROTECT) {
              pruned += estimate
              toPrune.push(part)
            }
          }
      }
    }
    log.info("found", { pruned, total })
    if (pruned > PRUNE_MINIMUM) {
      for (const part of toPrune) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          await Session.updatePart(part)
        }
      }
      log.info("pruned", { count: toPrune.length })
    }
  }

  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }) {
    const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)!.info as MessageV2.User
    const agent = await Agent.get("compaction")
    const model = agent.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(userMessage.model.providerID, userMessage.model.modelID)

    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant

    const provider = await Provider.getProvider(model.providerID)
    const auth = await Auth.get(model.providerID)
    const isCodex = provider.id === "openai" && auth?.type === "oauth"
    if (isCodex) {
      const { summaryText, encryptedContent } = await codexRemoteCompact({
        model,
        messages: input.messages,
        sessionID: input.sessionID,
        abort: input.abort,
      })

      const rendered = [
        summaryText || "Conversation compacted.",
        encryptedContent
          ? ["", "<compaction_encrypted_content>", encryptedContent, "</compaction_encrypted_content>"].join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n")
        .trim()

      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "text",
        synthetic: true,
        text: rendered,
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      } satisfies MessageV2.TextPart)

      msg.finish = "stop"
      msg.time.completed = Date.now()
      await Session.updateMessage(msg)

      if (input.auto) {
        const continueMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: input.sessionID,
          time: {
            created: Date.now(),
          },
          agent: userMessage.agent,
          model: userMessage.model,
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: continueMsg.id,
          sessionID: input.sessionID,
          type: "text",
          synthetic: true,
          text: "Continue if you have next steps",
          time: {
            start: Date.now(),
            end: Date.now(),
          },
        })
      }

      Bus.publish(Event.Compacted, { sessionID: input.sessionID })
      return "continue"
    }

    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })
    // Allow plugins to inject context or replace compaction prompt
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )
    const defaultPrompt =
      "Provide a detailed prompt for continuing our conversation above. Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next considering new session will not have access to our conversation."
    const promptText = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")
    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        ...MessageV2.toModelMessage(input.messages),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
          ],
        },
      ],
      model,
    })

    if (result === "continue" && input.auto) {
      const continueMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: input.sessionID,
        time: {
          created: Date.now(),
        },
        agent: userMessage.agent,
        model: userMessage.model,
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: continueMsg.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        text: "Continue if you have next steps",
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      })
    }
    if (processor.message.error) return "stop"
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })
    return "continue"
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      agent: z.string(),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      auto: z.boolean(),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
      })
    },
  )
}
