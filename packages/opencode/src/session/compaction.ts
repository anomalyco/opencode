import { streamText, type ModelMessage, type StreamTextResult, type Tool as AITool } from "ai"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { defer } from "../util/defer"
import { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"
import { Bus } from "../bus"
import z from "zod"
import type { ModelsDev } from "../provider/models"
import { SessionPrompt } from "./prompt"
import { Flag } from "../flag/flag"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionLock } from "./lock"
import { ProviderTransform } from "@/provider/transform"
import { SessionRetry } from "./retry"
import { Config } from "@/config/config"

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

  export function isOverflow(input: {
    tokens: MessageV2.Assistant["tokens"]
    model: ModelsDev.Model
  }) {
    if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) return false
    const context = input.model.limit.context
    if (context === 0) return false
    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
    const output =
      Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) ||
      SessionPrompt.OUTPUT_TOKEN_MAX
    const usable = context - output
    return count > usable
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000
  const MAX_RETRIES = 10

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

  export async function run(input: {
    sessionID: string
    providerID: string
    modelID: string
    signal?: AbortSignal
  }) {
    if (!input.signal) SessionLock.assertUnlocked(input.sessionID)
    await using lock =
      input.signal === undefined ? SessionLock.acquire({ sessionID: input.sessionID }) : undefined
    const signal = input.signal ?? lock!.signal

    await Session.update(input.sessionID, (draft) => {
      draft.time.compacting = Date.now()
    })
    await using _ = defer(async () => {
      await Session.update(input.sessionID, (draft) => {
        draft.time.compacting = undefined
      })
    })
    const toSummarize = await MessageV2.filterCompacted(MessageV2.stream(input.sessionID))
    const model = await Provider.getModel(input.providerID, input.modelID)
    const system = [
      ...SystemPrompt.summarize(model.providerID),
      ...(await SystemPrompt.environment()),
      ...(await SystemPrompt.custom()),
    ]

    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: toSummarize.findLast((m) => m.info.role === "user")?.info.id!,
      sessionID: input.sessionID,
      mode: "build",
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      summary: true,
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

    const doStream = () =>
      streamText({
        // set to 0, we handle loop
        maxRetries: 0,
        model: model.language,
        providerOptions: ProviderTransform.providerOptions(
          model.npm,
          model.providerID,
          model.info.options,
        ),
        headers: model.info.headers,
        abortSignal: signal,
        onError(error) {
          log.error("stream error", {
            error,
          })
        },
        tools: model.info.tool_call ? {} : undefined,
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

    // TODO: reduce duplication between compaction.ts & prompt.ts
    const process = async (
      stream: StreamTextResult<Record<string, AITool>, never>,
      retries: { count: number; max: number },
    ) => {
      let shouldRetry = false
      try {
        for await (const value of stream.fullStream) {
          signal.throwIfAborted()
          switch (value.type) {
            case "text-delta":
              part.text += value.text
              if (value.providerMetadata) part.metadata = value.providerMetadata
              if (part.text)
                await Session.updatePart({
                  part,
                  delta: value.text,
                })
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
        const error = MessageV2.fromError(e, { providerID: input.providerID })
        if (
          retries.count < retries.max &&
          MessageV2.APIError.isInstance(error) &&
          error.data.isRetryable
        ) {
          shouldRetry = true
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: msg.id,
            sessionID: msg.sessionID,
            type: "retry",
            attempt: retries.count + 1,
            time: {
              created: Date.now(),
            },
            error,
          })
        } else {
          msg.error = error
          Bus.publish(Session.Event.Error, {
            sessionID: msg.sessionID,
            error: msg.error,
          })
        }
      }

      const parts = await MessageV2.parts(msg.id)
      return {
        info: msg,
        parts,
        shouldRetry,
      }
    }

    let stream = doStream()
    const cfg = await Config.get()
    const maxRetries = cfg.experimental?.chatMaxRetries ?? MAX_RETRIES
    let result = await process(stream, {
      count: 0,
      max: maxRetries,
    })
    if (result.shouldRetry) {
      for (let retry = 1; retry < maxRetries; retry++) {
        const lastRetryPart = result.parts.findLast((p): p is MessageV2.RetryPart => p.type === "retry")

        if (lastRetryPart) {
          const delayMs = SessionRetry.getRetryDelayInMs(lastRetryPart.error, retry)

          log.info("retrying with backoff", {
            attempt: retry,
            delayMs,
          })

          const stop = await SessionRetry.sleep(delayMs, signal)
            .then(() => false)
            .catch((error) => {
              if (error instanceof DOMException && error.name === "AbortError") {
                const err = new MessageV2.AbortedError(
                  { message: error.message },
                  {
                    cause: error,
                  },
                ).toObject()
                result.info.error = err
                Bus.publish(Session.Event.Error, {
                  sessionID: result.info.sessionID,
                  error: result.info.error,
                })
                return true
              }
              throw error
            })

          if (stop) break
        }

        stream = doStream()
        result = await process(stream, {
          count: retry,
          max: maxRetries,
        })
        if (!result.shouldRetry) {
          break
        }
      }
    }

    msg.time.completed = Date.now()

    if (
      !msg.error ||
      (MessageV2.AbortedError.isInstance(msg.error) &&
        result.parts.some((part): part is MessageV2.TextPart => part.type === "text" && part.text.length > 0))
    ) {
      msg.summary = true
      Bus.publish(Event.Compacted, {
        sessionID: input.sessionID,
      })
    }
    await Session.updateMessage(msg)

    return {
      info: msg,
      parts: result.parts,
    }
  }
}
