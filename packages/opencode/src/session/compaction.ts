import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { ProviderTransform } from "@/provider/transform"
import { Todo } from "./todo"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  const COMPACTION_BUFFER = 30_000

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    const context = input.model.limit.context
    if (context === 0) return false

    const count =
      input.tokens.total ||
      input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write

    const reserved =
      config.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model))
    const usable = input.model.limit.input
      ? input.model.limit.input - reserved
      : context - ProviderTransform.maxOutputTokens(input.model)
    return count >= usable
  }

  // Estimate tokens for a single ModelMessage using the simple 4-chars-per-token heuristic,
  // with a correction factor to approximate tiktoken-based counting (used by kiro pre-flight).
  const TOKEN_CORRECTION = 1.3 // Token.estimate undercounts vs tiktoken×1.15; add safety margin
  export function estimateMessageTokens(msg: import("ai").ModelMessage): number {
    if (typeof msg.content === "string") return Math.ceil(Token.estimate(msg.content) * TOKEN_CORRECTION)
    if (!Array.isArray(msg.content)) return 0
    let tokens = 0
    for (const part of msg.content) {
      if ("text" in part && typeof part.text === "string") tokens += Token.estimate(part.text)
      if ("input" in part) tokens += Token.estimate(typeof part.input === "string" ? part.input : JSON.stringify(part.input))
      if ("output" in part) {
        const out = part.output
        if (typeof out === "string") tokens += Token.estimate(out)
        else if (out && typeof out === "object" && "value" in out) tokens += Token.estimate(typeof out.value === "string" ? out.value : JSON.stringify(out.value))
      }
    }
    return Math.ceil(tokens * TOKEN_CORRECTION)
  }

  export function usableTokens(model: Provider.Model): number {
    const context = model.limit.context
    if (context === 0) return Infinity
    return model.limit.input
      ? model.limit.input - COMPACTION_BUFFER - SYSTEM_OVERHEAD
      : context - ProviderTransform.maxOutputTokens(model) - COMPACTION_BUFFER - SYSTEM_OVERHEAD
  }

  // Pre-trim modelMessages from the front (oldest) so the total fits within the model's context limit.
  // This avoids the repeated fail-and-slice loop when the compaction LLM call itself overflows.
  export function fitMessages(msgs: import("ai").ModelMessage[], model: Provider.Model, extraTokens: number): import("ai").ModelMessage[] {
    const context = model.limit.context
    if (context === 0) return msgs
    const budget = context - ProviderTransform.maxOutputTokens(model) - COMPACTION_BUFFER - extraTokens
    if (budget <= 0) {
      return msgs.slice(-1)
    }

    // Accumulate from the end (newest) to preserve recent context
    let total = 0
    let cutoff = 0
    for (let i = msgs.length - 1; i >= 0; i--) {
      total += estimateMessageTokens(msgs[i])
      if (total > budget) {
        cutoff = i + 1
        break
      }
    }
    if (cutoff === 0) {
      return msgs
    }
    return msgs.slice(cutoff)
  }
  // Overhead for system prompt, tool definitions, JSON structure etc.
  // kiro's estimatePayloadTokens counts these but estimateMessageTokens does not.
  const SYSTEM_OVERHEAD = 16_000

  export function shouldCompact(msgs: import("ai").ModelMessage[], model: Provider.Model): boolean {
    const context = model.limit.context
    if (context === 0) return false
    const usable = usableTokens(model)
    let total = 0
    for (const msg of msgs) total += estimateMessageTokens(msg)
    return total >= usable
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
      variant: userMessage.variant,
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
    // Allow plugins to inject context or replace compaction prompt
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )
    const defaultPrompt = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`

    const todos = Todo.get(input.sessionID)
    const todoSection = todos.length
      ? `\n\nIMPORTANT — Current task progress (todo list). Use this as the authoritative source for what has been accomplished and what remains:\n${todos.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n")}`
      : ""
    const promptText = compacting.prompt ?? [defaultPrompt + todoSection, ...compacting.context].join("\n\n")
    const compactionPrompt = {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
    }
    let modelMessages = MessageV2.toModelMessages(input.messages, model)
    const promptTokens = Math.ceil(Token.estimate(promptText) * TOKEN_CORRECTION)
    const originalCount = modelMessages.length
    modelMessages = fitMessages(modelMessages, model, promptTokens)
    let result: SessionProcessor.Result = "compact"
    let attempt = 0
    while (result === "compact") {
      attempt++
      if (modelMessages.length === 0) break
      // Reset assistant message state for each attempt
      msg.error = undefined
      msg.finish = undefined as any
      msg.time = { created: Date.now() }
      msg.tokens = { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } }
      msg.cost = 0
      await Session.updateMessage(msg)
      const proc = SessionProcessor.create({
        assistantMessage: msg,
        sessionID: input.sessionID,
        model,
        abort: input.abort,
      })
      result = await proc.process({
        user: userMessage,
        agent,
        abort: input.abort,
        sessionID: input.sessionID,
        tools: {},
        system: [],
        messages: [...modelMessages, compactionPrompt],
        model,
      })
      if (result === "compact") {
        if (modelMessages.length <= 1) break
        modelMessages = modelMessages.slice(1)
      }
    }

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
        text: "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.",
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      })
    }
    if (msg.error) return "stop"
    // prune disabled: compaction already summarizes old tool outputs
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
