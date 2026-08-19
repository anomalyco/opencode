import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Context, Effect, Layer, Schema } from "effect"
import { Agent } from "@/agent/agent"
import { SessionCompaction } from "./compaction"
import { SessionPrompt } from "./prompt"
import { SessionRevert } from "./revert"
import { MessageID, PartID, SessionID } from "./schema"
import { Session } from "./session"

export const Input = Schema.Struct({
  sessionID: SessionID,
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
})
export type Input = Schema.Schema.Type<typeof Input>

export class SummaryUnavailableError extends Schema.TaggedErrorClass<SummaryUnavailableError>(
  "SessionHandoff.SummaryUnavailableError",
)("SessionHandoff.SummaryUnavailableError", { sessionID: SessionID }) {}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Session.Info, SummaryUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionHandoff") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const compaction = yield* SessionCompaction.Service
    const prompt = yield* SessionPrompt.Service
    const revert = yield* SessionRevert.Service
    const agents = yield* Agent.Service

    const write = Effect.fn("SessionHandoff.write")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      text: string
    }) {
      const message = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        time: { created: Date.now() },
      })
      // Deliberately not synthetic: the summary is the handoff note the user reads to
      // decide whether to continue, and synthetic parts never render in the TUI or app.
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: message.id,
        sessionID: input.sessionID,
        type: "text",
        text: input.text,
      } satisfies SessionV1.TextPart)
    })

    const create = Effect.fn("SessionHandoff.create")(function* (input: Input) {
      const current = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(current)
      const model = { providerID: input.providerID, modelID: input.modelID }
      const before = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      const agent =
        before.findLast((message) => message.info.role === "user")?.info.agent ?? (yield* agents.defaultAgent())

      // Manual compaction stops once the summary lands, so the summary is readable
      // immediately after the loop settles.
      if (stale(before)) {
        yield* compaction.create({ sessionID: input.sessionID, agent, model, auto: false })
        yield* prompt.loop({ sessionID: input.sessionID })
      }

      const after = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      const context = latestContext(after)
      // Compaction fails on its own when the history still exceeds the context window
      // after stripping media. Leave the session alone rather than handing off nothing.
      if (!context) return yield* new SummaryUnavailableError({ sessionID: input.sessionID })

      // A handoff produces a sibling. parentID stays unset because it means subagent.
      const next = yield* sessions.create({
        title: handoffTitle(current.title),
        agent,
        model: { id: input.modelID, providerID: input.providerID, variant: current.model?.variant },
      })
      yield* write({
        sessionID: next.id,
        agent,
        model,
        text: [
          `Continuing from session ${input.sessionID}, which was handed off to keep the context clean.`,
          "Use this handoff context to continue the work. The recent conversation is newer than the summary.",
          "",
          context.summary,
          context.recent && ["", "## Recent Context", context.recent].join("\n"),
        ].join("\n"),
      })
      yield* write({
        sessionID: input.sessionID,
        agent,
        model,
        text: `This session was handed off to ${next.id}. The work continues there.`,
      })
      return next
    })

    return Service.of({ create })
  }),
)

const summarizes = (message: SessionV1.WithParts): message is SessionV1.WithParts & { info: SessionV1.Assistant } =>
  message.info.role === "assistant" && message.info.summary === true && !!message.info.finish && !message.info.error

function latestContext(messages: SessionV1.WithParts[]) {
  const summary = messages.findLast(summarizes)
  const text = summary ? SessionCompaction.summaryText(summary) : undefined
  if (!summary || !text) return
  const marker = messages.find((message) => message.info.id === summary.info.parentID)
  const part = marker?.parts.find((part): part is SessionV1.CompactionPart => part.type === "compaction")
  if (!marker || !part?.tail_start_id) return { summary: text }
  const start = messages.findIndex((message) => message.info.id === part.tail_start_id)
  const end = messages.findIndex((message) => message.info.id === marker.info.id)
  if (start === -1 || end === -1 || start >= end) return { summary: text }
  const recent = messages.slice(start, end).map(SessionCompaction.serialize).filter(Boolean).join("\n\n")
  return recent ? { summary: text, recent } : { summary: text }
}

// A new summary is needed when visible work followed it, so the retained tail reflects
// the state at the moment of handoff.
function stale(messages: SessionV1.WithParts[]) {
  const summarized = messages.findLastIndex(summarizes)
  if (summarized === -1) return true
  return messages
    .slice(summarized + 1)
    .some((message) => message.parts.some((part) => part.type === "text" && !part.synthetic))
}

function handoffTitle(title: string) {
  const match = title.match(/^(.+) \(handoff #(\d+)\)$/)
  if (match) return `${match[1]} (handoff #${parseInt(match[2], 10) + 1})`
  return `${title} (handoff #1)`
}

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Session.node, SessionCompaction.node, SessionPrompt.node, SessionRevert.node, Agent.node],
})

export * as SessionHandoff from "./handoff"
