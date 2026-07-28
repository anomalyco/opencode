import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AutoSummaryStore } from "@opencode-ai/core/session/auto-summary-store"
import { Database } from "@opencode-ai/core/database/database"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LLMEvent } from "@opencode-ai/llm"
import { Cause, Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"

// Incremental session summary for "auto" mode: the hidden session-summarizer
// agent rewrites a running summary (done/tested/how/pending) at the end of
// every completed turn, persisted outside the transcript in
// session_auto_summary. The permission validator (phase 3) reads the latest
// row on every validation. Failures only log — a turn never blocks or breaks
// on the summarizer, and a failed update keeps the previous summary.
export interface UpdateInput {
  readonly sessionID: SessionID
  readonly agent: string
  readonly messages: SessionV1.WithParts[]
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
  readonly user: SessionV1.User
}

export interface Interface {
  // End-of-turn hook. No-op unless the turn ran on the "auto" agent.
  readonly update: (input: UpdateInput) => Effect.Effect<void>
  // Phase-3 gate for the first validation after switching a session to
  // "auto": returns immediately when a summary exists, otherwise generates
  // the catch-up over the whole history. Errors degrade to a log (the
  // validator then runs without a summary); the caller may wrap it in its
  // own timeout.
  readonly ensure: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionAutoSummary") {}

const real = (m: SessionV1.WithParts) =>
  m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)

// filterCompacted reorders messages for model consumption; the delta math
// below expects chronological order (message ids are monotonic).
const chronological = (msgs: SessionV1.WithParts[]) => msgs.slice().sort((a, b) => (a.info.id < b.info.id ? -1 : 1))

// The new content since the stored summary: everything after the
// turnCount-th real user message. The assistant tail of the last summarized
// turn rides along, which keeps continuity for the model. Falls back to the
// whole history when the anchor is gone (e.g. compaction dropped messages).
const delta = (msgs: SessionV1.WithParts[], turnCount: number) => {
  if (turnCount <= 0) return msgs
  const anchor = msgs.filter(real)[turnCount - 1]
  if (!anchor) return msgs
  return msgs.slice(msgs.findIndex((m) => m.info.id === anchor.info.id) + 1)
}

const render = (msgs: SessionV1.WithParts[]) =>
  msgs
    .flatMap((m) => {
      const role = m.info.role === "user" ? "user" : "assistant"
      return m.parts.flatMap((part): string[] => {
        if (part.type === "text") {
          if (part.synthetic) return []
          return [`${role}: ${part.text}`]
        }
        if (part.type === "tool") {
          const input = JSON.stringify(part.state.input)
          return [`assistant called tool ${part.tool}: ${input.length > 200 ? input.slice(0, 200) + "…" : input}`]
        }
        return []
      })
    })
    .join("\n")
    .trim()

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const store = yield* AutoSummaryStore.Service
    const database = yield* Database.Service

    const run = Effect.fn("SessionAutoSummary.run")(function* (input: Omit<UpdateInput, "agent">) {
      const msgs = chronological(input.messages)
      const previous = yield* store.get(input.sessionID)
      const chunk = render(delta(msgs, previous?.turnCount ?? 0))
      if (!chunk) return
      const ag = yield* agents.get("session-summarizer")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const content = previous
        ? `Previous summary:\n${previous.summary}\n\nNew activity:\n${chunk}`
        : `Session activity:\n${chunk}`
      const text = yield* llm
        .stream({
          agent: ag,
          user: input.user,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.sessionID,
          retries: 1,
          messages: [{ role: "user", content }],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
          // Forked off the turn path, so it may outlast classifyTurn's 15s;
          // still bounded so a hung endpoint cannot leak the forked fiber.
          Effect.timeout(30_000),
        )
      const summary = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()
      if (!summary) return
      yield* store.upsert({
        sessionID: input.sessionID,
        summary,
        model: `${mdl.providerID}/${mdl.id}`,
        turnCount: msgs.filter(real).length,
      })
    })

    // Single-flight per session: one summary update at a time, so two
    // end-of-turn forks never read the same version and regress each other.
    // An update arriving mid-flight is coalesced — only the latest queued
    // work runs next, since every run already incorporates the whole delta.
    const flights = new Map<string, { running: boolean; queued?: Effect.Effect<void> }>()
    const fly = (sessionID: SessionID, work: Effect.Effect<void>) =>
      Effect.suspend(() => {
        const slot = flights.get(sessionID) ?? { running: false }
        flights.set(sessionID, slot)
        if (slot.running) {
          slot.queued = work
          return Effect.void
        }
        slot.running = true
        return Effect.gen(function* () {
          let current: Effect.Effect<void> | undefined = work
          while (current) {
            yield* current
            current = slot.queued
            slot.queued = undefined
          }
          slot.running = false
          flights.delete(sessionID)
        })
      })

    const update: Interface["update"] = Effect.fn("SessionAutoSummary.update")(function* (input) {
      if (input.agent !== "auto") return
      yield* fly(
        input.sessionID,
        run(input).pipe(
          Effect.catchCause((cause) => Effect.logWarning("auto summary update failed", { cause: Cause.pretty(cause) })),
        ),
      )
    })

    const ensure: Interface["ensure"] = Effect.fn("SessionAutoSummary.ensure")(function* (sessionID) {
      const msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
        Effect.provideService(Database.Service, database),
      )
      const lastUser = MessageV2.latest(msgs).user
      if (!lastUser) return
      // Fresh means the stored summary already covers every real user
      // message; an older one (a first turn, or turns that ran while the
      // session was on another agent) re-runs the catch-up first.
      const current = msgs.filter(real).length
      const existing = yield* store.get(sessionID)
      if (existing && existing.turnCount >= current) return
      yield* fly(
        sessionID,
        run({
          sessionID,
          messages: msgs,
          providerID: lastUser.model.providerID,
          modelID: lastUser.model.modelID,
          user: lastUser,
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("auto summary catch-up failed", { cause: Cause.pretty(cause) }),
          ),
        ),
      )
    })

    return Service.of({ update, ensure })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Agent.node, Provider.node, LLM.node, AutoSummaryStore.node, Database.node],
})

export * as SessionAutoSummary from "./auto-summary"
