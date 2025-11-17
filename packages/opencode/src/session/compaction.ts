import { generateText, streamText, type ModelMessage } from "ai"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"
import { Bus } from "../bus"
import z from "zod"
import type { ModelsDev } from "../provider/models"
import { SessionPrompt } from "./prompt"
import { Flag } from "../flag/flag"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { ProviderTransform } from "@/provider/transform"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { estimateMessageTokens, messageText, pickMessageContentParts } from "./message-content"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: Bus.event(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  async function resolveCompactModel(info: MessageV2.Info, sessionID: string) {
    if (info.role === "assistant") {
      const preferred = await Provider.getSmallModel(info.providerID)
      if (preferred) return preferred
      return Provider.getModel(info.providerID, info.modelID)
    }

    const messages = await Session.messages({ sessionID })
    const nextAssistant = messages.find((msg) => msg.info.role === "assistant" && msg.info.id > info.id)
    if (nextAssistant) {
      const preferred = await Provider.getSmallModel(nextAssistant.info.providerID)
      if (preferred) return preferred
      return Provider.getModel(nextAssistant.info.providerID, nextAssistant.info.modelID)
    }

    const fallback = await Provider.defaultModel()
    const preferred = await Provider.getSmallModel(fallback.providerID)
    if (preferred) return preferred
    return Provider.getModel(fallback.providerID, fallback.modelID)
  }

  export function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: ModelsDev.Model }) {
    if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) return false
    const context = input.model.limit.context
    if (context === 0) return false
    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
    const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) || SessionPrompt.OUTPUT_TOKEN_MAX
    const usable = context - output
    return count > usable
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  export async function prune(input: { sessionID: string }) {
    if (Flag.OPENCODE_DISABLE_PRUNE) return
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
      if (msg.info.priority === "red" || msg.info.priority === "amber") continue
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
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

  export async function compactMessage(input: { sessionID: string; messageID: string }) {
    const message = await MessageV2.get(input)
    const contentParts = pickMessageContentParts(message.parts)
    const combined = messageText(contentParts)
    if (!combined) return message.info

    const model = await resolveCompactModel(message.info, input.sessionID)
    const maxOutput = Math.min(200, model.info.limit.output || 200)
    const tokensBefore = estimateMessageTokens(contentParts)

    const response = await generateText({
      model: model.language,
      maxOutputTokens: maxOutput,
      providerOptions: ProviderTransform.providerOptions(model.npm, model.providerID, model.info.options),
      headers: model.info.headers,
      messages: [
        {
          role: "system",
          content:
            "You compress previous steps so the assistant can keep working. Write 2-4 concise bullet points that preserve file names, commands, errors, and next actions. Keep things factual and avoid commentary.",
        },
        {
          role: "user",
          content: `
Original role: ${message.info.role}
Approximate tokens: ${tokensBefore}

<content>
${combined}
</content>
          `.trim(),
        },
      ],
    })

    const summary = response.text.trim()
    if (!summary) return message.info

    const now = Date.now()
    const tokensAfter = Token.estimate(summary)
    let updatedText = false
    for (const part of message.parts) {
      if (part.type !== "text") continue
      if (part.synthetic) continue

      if (!updatedText) {
        const metadata = {
          ...(part.metadata ?? {}),
          compaction: {
            time: now,
            tokensBefore,
            tokensAfter,
            method: "manual",
          },
        }
        await Session.updatePart({
          ...part,
          text: summary,
          metadata,
        })
        updatedText = true
        continue
      }

      await Session.removePart({
        sessionID: input.sessionID,
        messageID: input.messageID,
        partID: part.id,
      })
    }

    if (!updatedText) {
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: input.messageID,
        sessionID: input.sessionID,
        type: "text",
        text: summary,
        metadata: {
          compaction: {
            time: now,
            tokensBefore,
            tokensAfter,
            method: "manual",
          },
        },
        time: {
          start: now,
          end: now,
        },
      })
    }

    for (const part of message.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (part.state.time.compacted) continue
      part.state.time.compacted = now
      await Session.updatePart(part)
    }

    return message.info
  }

  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    model: {
      providerID: string
      modelID: string
    }
    abort: AbortSignal
  }) {
    const model = await Provider.getModel(input.model.providerID, input.model.modelID)
    const system = [...SystemPrompt.summarize(model.providerID)]
    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "build",
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
      modelID: input.model.modelID,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      providerID: input.model.providerID,
      model: model.info,
      abort: input.abort,
    })
    const result = await processor.process(() =>
      streamText({
        // set to 0, we handle loop
        maxRetries: 0,
        model: model.language,
        providerOptions: ProviderTransform.providerOptions(model.npm, model.providerID, model.info.options),
        headers: model.info.headers,
        abortSignal: input.abort,
        tools: model.info.tool_call ? {} : undefined,
        messages: [
          ...system.map(
            (x): ModelMessage => ({
              role: "system",
              content: x,
            }),
          ),
          ...MessageV2.toModelMessage(input.messages),
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
      }),
    )
    if (result === "continue") {
      const continueMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: input.sessionID,
        time: {
          created: Date.now(),
        },
        agent: "build",
        model: input.model,
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
    return "continue"
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: "build",
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
      })
    },
  )
}
