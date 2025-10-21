import { streamText, type ModelMessage, LoadAPIKeyError } from "ai"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { defer } from "../util/defer"
import { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"
import { Bus } from "../bus"
import z from "zod/v4"
import type { ModelsDev } from "../provider/models"
import { SessionPrompt } from "./prompt"
import { Flag } from "../flag/flag"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionLock } from "./lock"
import { NamedError } from "../util/error"
import { ProviderTransform } from "@/provider/transform"

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
    const msgs = await Session.messages(input.sessionID)
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

  export async function run(input: { sessionID: string; providerID: string; modelID: string; signal?: AbortSignal }) {
    if (!input.signal) SessionLock.assertUnlocked(input.sessionID)
    await using lock = input.signal === undefined ? SessionLock.acquire({ sessionID: input.sessionID }) : undefined
    const signal = input.signal ?? lock!.signal

    await Session.update(input.sessionID, (draft) => {
      draft.time.compacting = Date.now()
    })
    await using _ = defer(async () => {
      await Session.update(input.sessionID, (draft) => {
        draft.time.compacting = undefined
      })
    })
    const toSummarize = await Session.messages(input.sessionID).then(MessageV2.filterSummarized)
    const model = await Provider.getModel(input.providerID, input.modelID)
    const system = [
      ...SystemPrompt.summarize(model.providerID),
      ...(await SystemPrompt.environment()),
      ...(await SystemPrompt.custom()),
    ]

    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      sessionID: input.sessionID,
      system,
      mode: "build",
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
      modelID: input.modelID,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant

    const part = (await Session.updatePart({
      type: "text",
      sessionID: input.sessionID,
      messageID: msg.id,
      id: Identifier.ascending("part"),
      text: "",
      time: {
        start: Date.now(),
      },
    })) as MessageV2.TextPart

    const stream = streamText({
      maxRetries: 10,
      model: model.language,
      providerOptions: ProviderTransform.providerOptions(model.npm, model.providerID, model.info.options),
      abortSignal: signal,
      onError(error) {
        log.error("stream error", {
          error,
        })
      },
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...MessageV2.toModelMessage(toSummarize),
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

    try {
      for await (const value of stream.fullStream) {
        signal.throwIfAborted()
        switch (value.type) {
          case "text-delta":
            part.text += value.text
            if (value.providerMetadata) part.metadata = value.providerMetadata
            if (part.text) await Session.updatePart(part)
            continue
          case "text-end": {
            part.text = part.text.trimEnd()
            part.time = {
              start: Date.now(),
              end: Date.now(),
            }
            if (value.providerMetadata) part.metadata = value.providerMetadata
            await Session.updatePart(part)
            continue
          }
          case "finish-step": {
            const usage = Session.getUsage({
              model: model.info,
              usage: value.usage,
              metadata: value.providerMetadata,
            })
            msg.cost += usage.cost
            msg.tokens = usage.tokens
            await Session.updateMessage(msg)
            continue
          }
          case "error":
            throw value.error
          default:
            continue
        }
      }
    } catch (e) {
      log.error("compaction error", {
        error: e,
      })
      switch (true) {
        case e instanceof DOMException && e.name === "AbortError":
          msg.error = new MessageV2.AbortedError(
            { message: e.message },
            {
              cause: e,
            },
          ).toObject()
          break
        case MessageV2.OutputLengthError.isInstance(e):
          msg.error = e
          break
        case LoadAPIKeyError.isInstance(e):
          msg.error = new MessageV2.AuthError(
            {
              providerID: model.providerID,
              message: e.message,
            },
            { cause: e },
          ).toObject()
          break
        case e instanceof Error:
          msg.error = new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()
          break
        default:
          msg.error = new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e })
      }
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: msg.error,
      })
    }

    msg.time.completed = Date.now()

    if (!msg.error || MessageV2.AbortedError.isInstance(msg.error)) {
      msg.summary = true
      Bus.publish(Event.Compacted, {
        sessionID: input.sessionID,
      })
    }
    await Session.updateMessage(msg)

    return {
      info: msg,
      parts: [part],
    }
  }
}
