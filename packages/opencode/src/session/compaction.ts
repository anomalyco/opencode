import { streamText, wrapLanguageModel, type ModelMessage } from "ai"
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
        onError(error) {
          log.error("stream error", {
            error,
          })
        },
        // set to 0, we handle loop
        maxRetries: 0,
        providerOptions: ProviderTransform.providerOptions(model.npm, model.providerID, {
          ...ProviderTransform.options(model.providerID, model.modelID, model.npm ?? "", input.sessionID),
          ...model.info.options,
        }),
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
          ...MessageV2.toModelMessage(
            input.messages.filter((m) => {
              if (m.info.role !== "assistant" || m.info.error === undefined) {
                return true
              }
              if (
                MessageV2.AbortedError.isInstance(m.info.error) &&
                m.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
              ) {
                return true
              }

              return false
            }),
          ),
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
        model: wrapLanguageModel({
          model: model.language,
          middleware: [
            {
              async transformParams(args) {
                if (args.type === "stream") {
                  // @ts-expect-error
                  args.params.prompt = ProviderTransform.message(args.params.prompt, model.providerID, model.modelID)
                }
                return args.params
              },
            },
          ],
        }),
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
    if (processor.message.error) return "stop"
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
