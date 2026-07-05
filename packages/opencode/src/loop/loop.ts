// Server-side port of the loop engine that used to live entirely in
// cli/cmd/loop.ts. That version kept state in an in-process Map, so
// list/pause/resume/cancel only worked from the process that started the
// loop and the TUI had no visibility into it at all. This service owns loop
// state for the life of the server instead, so any client (CLI or TUI) can
// see and control any loop.
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { withStatics } from "@opencode-ai/core/schema"
import { Identifier } from "@/id/id"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { Context, Effect, Layer, Ref, Result, Schema, Scope } from "effect"

export const COMPLETE_SIGNAL = "<promise>COMPLETE</promise>"

export const DefaultMaxIterations = 1000
export const DefaultNoProgressLimit = 0
export const DefaultIntervalSeconds = 2

// Consecutive-iteration output comparison uses this as "near-identical" —
// see the skein incident referenced in design.md: a promise token that never
// arrives must not be the only way a loop stops.
const NoProgressSimilarityThreshold = 0.92

export const LoopID = Schema.String.check(Schema.isStartsWith("loop")).pipe(
  Schema.brand("LoopID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("loop", id)),
  })),
)
export type LoopID = Schema.Schema.Type<typeof LoopID>

export const Status = Schema.Literals([
  "running",
  "paused",
  "completed",
  "stalled",
  "cancelled",
  "max_reached",
  "error",
])
export type Status = Schema.Schema.Type<typeof Status>

export const IterationInfo = Schema.Struct({
  iteration: Schema.Int,
  sessionID: SessionID,
  toolCalls: Schema.Int,
  outputLength: Schema.Int,
  complete: Schema.Boolean,
  startedAt: Schema.Finite,
  finishedAt: Schema.Finite,
})
export type IterationInfo = Schema.Schema.Type<typeof IterationInfo>

export const Info = Schema.Struct({
  id: LoopID,
  directory: Schema.String,
  sessionID: SessionID,
  parentSessionID: Schema.optional(SessionID),
  prompt: Schema.String,
  status: Status,
  maxIterations: Schema.Int,
  interval: Schema.optional(Schema.Finite),
  noProgressLimit: Schema.Int,
  iteration: Schema.Int,
  iterations: Schema.Array(IterationInfo),
  startedAt: Schema.Finite,
  lastRunAt: Schema.optional(Schema.Finite),
  finishedAt: Schema.optional(Schema.Finite),
}).annotate({ identifier: "Loop" })
export type Info = Schema.Schema.Type<typeof Info>

export const CreateInput = Schema.Struct({
  prompt: Schema.String,
  sessionID: Schema.optional(SessionID),
  maxIterations: Schema.optional(Schema.Int),
  interval: Schema.optional(Schema.Finite),
  noProgressLimit: Schema.optional(Schema.Int),
})
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const Event = {
  Updated: EventV2.define({
    type: "loop.updated",
    schema: { loop: Info },
  }),
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly list: (input?: { directory?: string }) => Effect.Effect<Info[]>
  readonly get: (id: LoopID) => Effect.Effect<Info | undefined>
  readonly pause: (id: LoopID) => Effect.Effect<boolean>
  readonly resume: (id: LoopID) => Effect.Effect<boolean>
  readonly cancel: (id: LoopID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Loop") {}

// Sørensen–Dice coefficient over character bigrams: cheap, dependency-free,
// and forgiving of small formatting drift between otherwise-repeated
// iteration output. 1 = identical, 0 = nothing in common.
function normalize(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ")
}
function bigrams(text: string) {
  const grams = new Set<string>()
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2))
  return grams
}
export function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 1
  if (!na || !nb) return 0
  const ga = bigrams(na)
  const gb = bigrams(nb)
  if (ga.size === 0 || gb.size === 0) return 0
  let intersection = 0
  for (const gram of ga) if (gb.has(gram)) intersection++
  return (2 * intersection) / (ga.size + gb.size)
}

function promptHead(prompt: string) {
  const trimmed = prompt.trim()
  return trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed
}

type Record_ = {
  info: Info
  lastOutput?: string
  noProgressStreak: number
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const events = yield* EventV2Bridge.Service
    const scope = yield* Scope.Scope

    const state = yield* Ref.make<Map<LoopID, Record_>>(new Map())

    const emit = (id: LoopID) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(state)).get(id)
        if (!record) return
        yield* events.publish(Event.Updated, { loop: record.info })
      })

    const patch = (id: LoopID, fn: (record: Record_) => Record_) =>
      Ref.modify(state, (map) => {
        const current = map.get(id)
        if (!current) return [undefined, map]
        const next = new Map(map)
        const updated = fn(current)
        next.set(id, updated)
        return [updated, next]
      })

    const runIteration = (record: Record_) =>
      Effect.gen(function* () {
        const iterationNumber = record.info.iteration + 1
        const startedAt = Date.now()
        const outcome = yield* promptSvc
          .prompt({ sessionID: record.info.sessionID, parts: [{ type: "text", text: record.info.prompt }] })
          .pipe(Effect.result)
        const finishedAt = Date.now()

        if (Result.isFailure(outcome)) {
          return {
            iteration: iterationNumber,
            sessionID: record.info.sessionID,
            toolCalls: 0,
            outputLength: 0,
            output: "",
            complete: false,
            error: true,
            startedAt,
            finishedAt,
          }
        }

        const message = outcome.success
        const toolCalls = message.parts.filter((part) => part.type === "tool").length
        const output = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")

        return {
          iteration: iterationNumber,
          sessionID: record.info.sessionID,
          toolCalls,
          outputLength: output.length,
          output,
          complete: output.includes(COMPLETE_SIGNAL),
          error: false,
          startedAt,
          finishedAt,
        }
      })

    // Cancel is checked every 500ms of sleep instead of once per full
    // interval, so `cancel` reliably takes effect within ~500ms even when
    // the loop is mid-interval on a long --interval.
    const waitBetween = (id: LoopID, ms: number) =>
      Effect.gen(function* () {
        let remaining = ms
        while (remaining > 0) {
          const chunk = Math.min(500, remaining)
          yield* Effect.sleep(`${chunk} millis`)
          remaining -= chunk
          const record = (yield* Ref.get(state)).get(id)
          if (!record || record.info.status !== "running") return
        }
      })

    const finalize = (id: LoopID, status: Status) =>
      Effect.gen(function* () {
        yield* patch(id, (record) => ({
          ...record,
          info: { ...record.info, status, finishedAt: Date.now() },
        }))
        yield* emit(id)
      })

    const run = (id: LoopID): Effect.Effect<void> =>
      Effect.gen(function* () {
        while (true) {
          const record = (yield* Ref.get(state)).get(id)
          if (!record) return
          if (record.info.status === "paused") {
            yield* Effect.sleep("500 millis")
            continue
          }
          // Any other non-running status (cancelled, completed, stalled,
          // max_reached, error) means a terminal transition already
          // happened elsewhere — nothing left for this fiber to do.
          if (record.info.status !== "running") return

          const iterationNumber = record.info.iteration + 1
          if (iterationNumber > record.info.maxIterations) {
            yield* finalize(id, "max_reached")
            return
          }

          const result = yield* runIteration(record)
          const updated = yield* patch(id, (current) => ({
            ...current,
            info: {
              ...current.info,
              iteration: result.iteration,
              lastRunAt: result.finishedAt,
              iterations: [
                ...current.info.iterations,
                {
                  iteration: result.iteration,
                  sessionID: result.sessionID,
                  toolCalls: result.toolCalls,
                  outputLength: result.outputLength,
                  complete: result.complete,
                  startedAt: result.startedAt,
                  finishedAt: result.finishedAt,
                },
              ],
            },
          }))
          if (!updated) return
          yield* emit(id)

          if (result.error) {
            yield* finalize(id, "error")
            return
          }
          if (result.complete) {
            yield* finalize(id, "completed")
            return
          }

          const limit = updated.info.noProgressLimit
          const noToolCalls = result.toolCalls === 0
          const nearIdentical =
            updated.lastOutput !== undefined && similarity(result.output, updated.lastOutput) >= NoProgressSimilarityThreshold
          const streak = noToolCalls && (updated.noProgressStreak === 0 || nearIdentical) ? updated.noProgressStreak + 1 : 0

          yield* patch(id, (current) => ({ ...current, lastOutput: result.output, noProgressStreak: streak }))

          if (limit > 0 && streak >= limit) {
            yield* finalize(id, "stalled")
            return
          }

          if (result.iteration >= updated.info.maxIterations) {
            yield* finalize(id, "max_reached")
            return
          }

          yield* waitBetween(id, (updated.info.interval ?? DefaultIntervalSeconds) * 1000)
        }
      })

    const create = (input: CreateInput) =>
      Effect.gen(function* () {
        const prompt = input.prompt.trim()
        const id = LoopID.ascending()
        const now = Date.now()
        let sessionID: SessionID
        let parentSessionID: SessionID | undefined
        let directory: string
        if (input.sessionID) {
          // Loop inside the caller's existing session. The lookup is only for
          // bookkeeping (directory scoping in `list`, parent link) — a missing
          // session must not block the loop; the iteration prompt surfaces the
          // real error if the session is truly gone.
          sessionID = input.sessionID
          const existing = yield* session.get(input.sessionID).pipe(Effect.orElseSucceed(() => undefined))
          parentSessionID = existing?.parentID
          directory = existing?.directory ?? ""
        } else {
          const parent = yield* session.create({ title: `loop: ${promptHead(prompt)}` })
          sessionID = parent.id
          parentSessionID = undefined
          directory = parent.directory
        }
        const info: Info = {
          id,
          directory,
          sessionID,
          parentSessionID,
          prompt,
          status: "running",
          maxIterations: input.maxIterations ?? DefaultMaxIterations,
          interval: input.interval,
          noProgressLimit: input.noProgressLimit ?? DefaultNoProgressLimit,
          iteration: 0,
          iterations: [],
          startedAt: now,
        }
        yield* Ref.update(state, (map) => new Map(map).set(id, { info, noProgressStreak: 0 }))
        yield* emit(id)
        yield* run(id).pipe(Effect.forkIn(scope))
        return info
      })

    const list = (input?: { directory?: string }) =>
      Effect.gen(function* () {
        const all = Array.from((yield* Ref.get(state)).values()).map((record) => record.info)
        if (!input?.directory) return all
        return all.filter((info) => info.directory === input.directory)
      })

    const get = (id: LoopID) => Ref.get(state).pipe(Effect.map((map) => map.get(id)?.info))

    const pause = (id: LoopID) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(state)).get(id)
        if (!record || record.info.status !== "running") return false
        yield* patch(id, (current) => ({ ...current, info: { ...current.info, status: "paused" } }))
        yield* emit(id)
        return true
      })

    // The fiber forked by `create` never exits while status is "paused" — it
    // polls every 500ms (see `run`'s paused branch) — so resuming only needs
    // to flip the status; no new fiber to fork.
    const resume = (id: LoopID) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(state)).get(id)
        if (!record || record.info.status !== "paused") return false
        yield* patch(id, (current) => ({ ...current, info: { ...current.info, status: "running" } }))
        yield* emit(id)
        return true
      })

    const cancel = (id: LoopID) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(state)).get(id)
        if (!record) return false
        if (record.info.status !== "running" && record.info.status !== "paused") return false
        yield* patch(id, (current) => ({
          ...current,
          info: { ...current.info, status: "cancelled", finishedAt: Date.now() },
        }))
        yield* emit(id)
        return true
      })

    return Service.of({ create, list, get, pause, resume, cancel })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Session.defaultLayer),
  Layer.provide(SessionPrompt.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

export const node = LayerNode.make(layer, [Session.node, SessionPrompt.node, EventV2Bridge.node])

export * as Loop from "./loop"
