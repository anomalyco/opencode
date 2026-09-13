import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Session } from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"

import { Effect, Layer, Context, Stream } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable } from "./overflow"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { buildPrompt } from "@opencode-ai/core/session/compaction"
import { SessionCompactionEvent } from "@opencode-ai/schema/session-compaction-event"
import { LLM } from "./llm"
import { LLMEvent } from "@opencode-ai/llm"

export const Event = SessionCompactionEvent

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
// Retained-tail budget ladder for repeated automatic compactions, indexed by
// the number of consecutive failed attempts: full budget, half, nothing. Each
// rung gives compaction a chance to restore headroom by keeping less recent
// context verbatim before the loop guard below stops the session loop.
const TAIL_ESCALATION = [1, 0.5, 0]
// Auto-compaction loop guard. When a session's irreducible context (system
// prompt, retained tail) exceeds the model's usable window, automatic
// compaction can never get the session back under the overflow threshold, so
// the session loop would otherwise compact after every single step forever,
// burning provider quota. After every escalation rung has failed the loop
// stops with an error instead.
export const MAX_FAILED_AUTO_COMPACTIONS = TAIL_ESCALATION.length
const TOOL_OUTPUT_MAX_CHARS = 2_000
const PRUNE_PROTECTED_TOOLS = ["skill"]
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 15_000
// The summarization request itself must fit in the compaction model's window.
// Oversized heads are summarized in chunks capped at this fraction of the
// usable window, leaving comfortable room for the prompt template and the
// model's answer even if the estimate undercounts.
const CHUNK_REQUEST_FRACTION = 0.5
// Merge rounds for re-summarizing partial summaries that still exceed the
// chunk budget. Practically converges in one round; the cap guards against a
// misbehaving compaction model returning unbounded text.
const MAX_SUMMARY_ROUNDS = 4
type Turn = {
  start: number
  end: number
  id: MessageID
}

type Tail = {
  start: number
  id: MessageID
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

const serialize = (message: SessionV1.WithParts) => {
  if (message.info.role === "user") {
    const text = message.parts
      .filter((part): part is SessionV1.TextPart => part.type === "text" && !part.ignored)
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n")
    const files = message.parts.flatMap((part) =>
      part.type === "file" ? [`[Attached ${part.mime}: ${part.filename ?? "file"}]`] : [],
    )
    return [...(text ? [`[User]: ${text}`] : []), ...files].join("\n")
  }
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return part.text ? [`[Assistant]: ${part.text}`] : []
      if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
      if (part.type !== "tool") return []
      const call = `[Assistant tool call]: ${part.tool}(${JSON.stringify(part.state.input)})`
      if (part.state.status === "completed") {
        const attachments = (part.state.attachments ?? []).map(
          (item) => `[Attached ${item.mime}: ${item.filename ?? "file"}]`,
        )
        const output = part.state.time.compacted
          ? "[Old tool result content cleared]"
          : truncate([part.state.output, ...attachments].join("\n"))
        return [call, `[Tool result]: ${output}`]
      }
      if (part.state.status === "error") return [call, `[Tool error]: ${part.state.error}`]
      return [call]
    })
    .join("\n")
}

function summaryText(message: SessionV1.WithParts) {
  const text = message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

function completedCompactions(messages: SessionV1.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

export function preserveRecentBudget(input: { cfg: ConfigV1.Info; model: Provider.Model; escalation?: number }) {
  const base =
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  const rung = TAIL_ESCALATION[Math.min(Math.max(input.escalation ?? 0, 0), TAIL_ESCALATION.length - 1)]!
  return Math.floor(base * rung)
}

// Per-request budget for the compaction model. Zero or negative means the
// model's limits are unknown, in which case no chunking is attempted.
function chunkBudget(input: { cfg: ConfigV1.Info; model: Provider.Model }) {
  return Math.floor(usable(input) * CHUNK_REQUEST_FRACTION)
}

const TRUNCATED = "\n[truncated]"

// Serializes messages and packs them greedily into budget-sized chunks,
// preserving order. A single message larger than the budget is hard-truncated
// (tool outputs are already capped at TOOL_OUTPUT_MAX_CHARS, so this is a
// last resort for giant text/reasoning parts). Returns [] for empty input.
export function chunkSerialized(messages: SessionV1.WithParts[], budget: number) {
  const chunks: string[] = []
  let current: string[] = []
  let size = 0
  for (const message of messages) {
    let text = serialize(message)
    if (!text) continue
    if (Token.estimate(text) > budget) {
      text = `${text.slice(0, Math.max(0, budget * 4 - TRUNCATED.length))}${TRUNCATED}`
    }
    const next = Token.estimate(text)
    if (current.length && size + next > budget) {
      chunks.push(current.join("\n\n"))
      current = []
      size = 0
    }
    current.push(text)
    size += next
  }
  if (current.length) chunks.push(current.join("\n\n"))
  return chunks
}

// Packs texts into consecutive groups whose joined serialization prompt stays
// under budget. A text that exceeds the budget alone gets its own group.
function packByBudget(texts: string[], budget: number) {
  const overhead = Token.estimate(buildPrompt({ context: [] }))
  const limit = Math.max(1, budget - overhead)
  const groups: string[][] = []
  let current: string[] = []
  let size = 0
  for (const text of texts) {
    const est = Token.estimate(text)
    if (current.length && size + est > limit) {
      groups.push(current)
      current = []
      size = 0
    }
    current.push(text)
    size += est
  }
  if (current.length) groups.push(current)
  return groups
}

// Counts the trailing run of automatic compactions that failed to restore
// headroom. A compaction "failed" when the first finished (non-summary)
// assistant step after it still overflows the model's usable window — meaning
// compacting again would summarize the same irreducible context and loop
// forever. A real user turn, a manual compaction, or a successful compaction
// resets the run. Messages must be in chronological order.
export function failedAutoCompactions(
  msgs: SessionV1.WithParts[],
  over: (tokens: SessionV1.Assistant["tokens"]) => boolean,
): number {
  const outcomes: boolean[] = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    if (msg.info.role !== "user") continue
    const part = msg.parts.find((p): p is SessionV1.CompactionPart => p.type === "compaction")
    if (part) {
      if (!part.auto) continue
      const successor = msgs
        .slice(i + 1)
        .find(
          (m): m is SessionV1.WithParts & { info: SessionV1.Assistant } =>
            m.info.role === "assistant" && m.info.summary !== true && !!m.info.finish,
        )
      outcomes.push(successor ? over(successor.info.tokens) : false)
      continue
    }
    if (msg.parts.every((p) => ("synthetic" in p ? p.synthetic : false))) continue
    outcomes.length = 0
  }
  let streak = 0
  for (let i = outcomes.length - 1; i >= 0 && outcomes[i]; i--) streak++
  return streak
}

export function compactionStuckError(streak: number) {
  return new SessionV1.ContextOverflowError({
    message: [
      `Session still exceeds the model's usable context window after ${streak} automatic compactions with progressively smaller retained context.`,
      "Start a new session or switch to a model with a larger context window.",
    ].join(" "),
  })
}

function turns(messages: SessionV1.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

function splitTurn(input: {
  messages: SessionV1.WithParts[]
  turn: Turn
  model: Provider.Model
  budget: number
  estimate: (input: { messages: SessionV1.WithParts[]; model: Provider.Model }) => Effect.Effect<number>
}) {
  return Effect.gen(function* () {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const size = yield* input.estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: input.messages[start]!.info.id,
      } satisfies Tail
    }
    return undefined
  })
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: SessionV1.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly failedStreak: (input: { sessionID: SessionID; model: Provider.Model }) => Effect.Effect<number>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly process: (input: {
    parentID: MessageID
    messages: SessionV1.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const llm = yield* LLM.Service

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: SessionV1.Assistant["tokens"]
      model: Provider.Model
    }) {
      return overflow({
        cfg: yield* config.get(),
        tokens: input.tokens,
        model: input.model,
        outputTokenMax: flags.outputTokenMax,
      })
    })

    const failedStreak = Effect.fn("SessionCompaction.failedStreak")(function* (input: {
      sessionID: SessionID
      model: Provider.Model
    }) {
      const cfg = yield* config.get()
      const msgs = yield* session.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      return failedAutoCompactions(msgs, (tokens) =>
        overflow({ cfg, tokens, model: input.model, outputTokenMax: flags.outputTokenMax }),
      )
    })

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: SessionV1.WithParts[]
      model: Provider.Model
    }) {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
      return Token.estimate(JSON.stringify(msgs))
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: SessionV1.WithParts[]
      cfg: ConfigV1.Info
      model: Provider.Model
      escalation?: number
    }) {
      const limit = input.cfg.compaction?.tail_turns
      if (limit !== undefined && limit <= 0) return { head: input.messages, tail_start_id: undefined }
      const budget = preserveRecentBudget({ cfg: input.cfg, model: input.model, escalation: input.escalation })
      const all = turns(input.messages)
      if (!all.length) return { head: input.messages, tail_start_id: undefined }
      const recent = limit === undefined ? all : all.slice(-limit)

      let total = 0
      let keep: Tail | undefined
      for (let i = recent.length - 1; i >= 0; i--) {
        const turn = recent[i]!
        // estimate lazily so cost stays proportional to the retained tail, not the whole session
        const size = yield* estimate({
          messages: input.messages.slice(turn.start, turn.end),
          model: input.model,
        })
        if (total + size <= budget) {
          total += size
          keep = { start: turn.start, id: turn.id }
          continue
        }
        const remaining = budget - total
        const split = yield* splitTurn({
          messages: input.messages,
          turn,
          model: input.model,
          budget: remaining,
          estimate,
        })
        if (split) keep = split
        else if (!keep) {
          yield* Effect.logInfo("tail fallback", { budget, size, total })
        }
        break
      }

      if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
      }
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.prune) return
      yield* Effect.logInfo("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: SessionV1.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      yield* Effect.logInfo("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        yield* Effect.logInfo("pruned", { count: toPrune.length })
      }
    })

    // Runs one ephemeral summarization request against the compaction model
    // and returns the produced text. Chunk calls are not persisted to the
    // session and their token usage is not tracked.
    const summarizeText = Effect.fn("SessionCompaction.summarizeText")(function* (input: {
      sessionID: SessionID
      userMessage: SessionV1.User
      agent: Agent.Info
      model: Provider.Model
      prompt: string
    }) {
      let text = ""
      let failed: string | undefined
      const streamError = yield* llm
        .stream({
          user: { ...input.userMessage, id: MessageID.ascending() },
          sessionID: input.sessionID,
          model: input.model,
          agent: input.agent,
          system: [],
          messages: [{ role: "user", content: [{ type: "text", text: input.prompt }] }],
          tools: {},
        })
        .pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (LLMEvent.is.textDelta(event)) text += event.text
              if (LLMEvent.is.providerError(event)) failed = event.message
            }),
          ),
          Effect.as(undefined as string | undefined),
          Effect.catch((error: unknown) => Effect.succeed(`summarization request failed: ${String(error)}`)),
        )
      const error = failed ?? streamError
      if (error) return { ok: false as const, error }
      if (!text.trim()) return { ok: false as const, error: "summarization request returned no text" }
      return { ok: true as const, text }
    })

    // Reduces the serialized head to a conversation string whose summarization
    // prompt fits the compaction model's chunk budget. Oversized heads are
    // summarized chunk by chunk (map); partial summaries that still exceed the
    // budget are packed and re-summarized (reduce). Fails when the reduction
    // does not converge within MAX_SUMMARY_ROUNDS.
    const reduceContexts = Effect.fn("SessionCompaction.reduceContexts")(function* (input: {
      sessionID: SessionID
      userMessage: SessionV1.User
      agent: Agent.Info
      model: Provider.Model
      previousSummary: string | undefined
      messages: SessionV1.WithParts[]
      budget: number
    }) {
      if (input.budget <= 0)
        return { ok: true as const, conversation: input.messages.map(serialize).filter(Boolean).join("\n\n") }
      const chunks = chunkSerialized(input.messages, input.budget)
      if (chunks.length <= 1) return { ok: true as const, conversation: chunks[0] ?? "" }
      const partials: string[] = []
      for (const chunk of chunks) {
        const summarized = yield* summarizeText({
          sessionID: input.sessionID,
          userMessage: input.userMessage,
          agent: input.agent,
          model: input.model,
          prompt: buildPrompt({ context: [chunk] }),
        })
        if (!summarized.ok) return summarized
        partials.push(summarized.text)
      }
      let contexts = partials
      for (let round = 0; ; round++) {
        const prompt = buildPrompt({ previousSummary: input.previousSummary, context: contexts })
        if (Token.estimate(prompt) <= input.budget) return { ok: true as const, conversation: contexts.join("\n\n") }
        if (round >= MAX_SUMMARY_ROUNDS) {
          return { ok: false as const, error: "conversation summaries did not fit the model's context window" }
        }
        const next: string[] = []
        for (const group of packByBudget(contexts, input.budget)) {
          const summarized = yield* summarizeText({
            sessionID: input.sessionID,
            userMessage: input.userMessage,
            agent: input.agent,
            model: input.model,
            prompt: buildPrompt({ context: group }),
          })
          if (!summarized.ok) return summarized
          next.push(summarized.text)
        }
        contexts = next
      }
    })

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: SessionV1.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) {
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const userMessage = parent.info
      const compactionPart = parent.parts.find((part): part is SessionV1.CompactionPart => part.type === "compaction")

      let messages = input.messages
      let replay:
        | {
            info: SessionV1.User
            parts: SessionV1.Part[]
          }
        | undefined
      if (input.overflow) {
        const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
        for (let i = idx - 1; i >= 0; i--) {
          const msg = input.messages[i]
          if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
            replay = { info: msg.info, parts: msg.parts }
            messages = input.messages.slice(0, i)
            break
          }
        }
        const hasContent =
          replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
        if (!hasContent) {
          replay = undefined
          messages = input.messages
        }
      }

      const agent = yield* agents.get("compaction")
      const model = agent.model
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
        : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID).pipe(Effect.orDie)
      const sessionModel = yield* provider
        .getModel(userMessage.model.providerID, userMessage.model.modelID)
        .pipe(Effect.orDie)
      const cfg = yield* config.get()
      const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      // The retained tail lives in the session model's context, so its budget
      // derives from the session model (not a possibly larger compaction
      // model), shrinking on each consecutive failed auto-compaction.
      const streak = failedAutoCompactions(history, (tokens) =>
        overflow({ cfg, tokens, model: sessionModel, outputTokenMax: flags.outputTokenMax }),
      )
      const selected = yield* select({
        messages: history.filter((_, index) => !hidden.has(index)),
        cfg,
        model: sessionModel,
        escalation: streak,
      })
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      const msgs = structuredClone(selected.head)
      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      const reduced = yield* reduceContexts({
        sessionID: input.sessionID,
        userMessage,
        agent,
        model,
        previousSummary,
        messages: msgs,
        budget: chunkBudget({ cfg, model }),
      })
      const conversation = reduced.ok ? reduced.conversation : ""
      const nextPrompt =
        compacting.prompt ??
        [
          buildPrompt({
            previousSummary,
            context: [conversation],
          }),
          ...compacting.context,
        ]
          .filter(Boolean)
          .join("\n\n")
      const ctx = yield* InstanceState.context
      const msg: SessionV1.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: userMessage.model.variant,
        summary: true,
        path: {
          cwd: ctx.directory,
          root: ctx.worktree,
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
      }
      yield* session.updateMessage(msg)
      const processor = yield* processors.create({
        assistantMessage: msg,
        sessionID: input.sessionID,
        model,
      })
      if (!reduced.ok) {
        processor.message.error = new SessionV1.ContextOverflowError({
          message: `Session too large to compact - ${reduced.error}`,
        }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }
      const result = yield* processor.process({
        user: userMessage,
        agent,
        sessionID: input.sessionID,
        tools: {},
        system: [],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  nextPrompt,
                  ...(compacting.prompt ? ["The following is the conversation history:", conversation] : []),
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              },
            ],
          },
        ],
        model,
      })

      if (result === "compact") {
        processor.message.error = new SessionV1.ContextOverflowError({
          message: replay
            ? "Conversation history too large to compact - exceeds model context limit"
            : "Session too large to compact - context exceeds model limit even after stripping media",
        }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }

      if (compactionPart && selected.tail_start_id && compactionPart.tail_start_id !== selected.tail_start_id) {
        yield* session.updatePart({
          ...compactionPart,
          tail_start_id: selected.tail_start_id,
        })
      }

      if (result === "continue" && input.auto) {
        if (replay) {
          const original = replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          for (const part of replay.parts) {
            if (part.type === "compaction") continue
            const replayPart =
              part.type === "file" && MessageV2.isMedia(part.mime)
                ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                : part
            yield* session.updatePart({
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
          }
        }

        if (!replay) {
          const info = yield* provider.getProvider(userMessage.model.providerID)
          if (
            (yield* plugin.trigger(
              "experimental.compaction.autocontinue",
              {
                sessionID: input.sessionID,
                agent: userMessage.agent,
                model: yield* provider
                  .getModel(userMessage.model.providerID, userMessage.model.modelID)
                  .pipe(Effect.orDie),
                provider: {
                  source: info.source,
                  info,
                  options: info.options,
                },
                message: userMessage,
                overflow: input.overflow === true,
              },
              { enabled: true },
            )).enabled
          ) {
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
            })
            const text =
              (input.overflow
                ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
                : "") +
              "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              // Internal marker for auto-compaction followups so provider plugins
              // can distinguish them from manual post-compaction user prompts.
              // This is not a stable plugin contract and may change or disappear.
              metadata: { compaction_continue: true },
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }
      }

      if (processor.message.error) return "stop"
      if (result === "continue") {
        yield* events.publish(Event.Compacted, { sessionID: input.sessionID })
      }
      return result
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      auto: boolean
      overflow?: boolean
    }) {
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
    })

    return Service.of({
      isOverflow,
      failedStreak,
      prune,
      process: processCompaction,
      create,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Config.node,
    Session.node,
    Agent.node,
    Plugin.node,
    SessionProcessor.node,
    Provider.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
    LLM.node,
  ],
})

export * as SessionCompaction from "./compaction"
