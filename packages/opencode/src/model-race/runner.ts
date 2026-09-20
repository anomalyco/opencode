import type { LLMEvent } from "@opencode-ai/llm"
import { Cause, Effect, Fiber, Queue, Stream } from "effect"
import { Controller } from "./controller"
import { ToolExecutionGate } from "./gate"
import { ModelRaceLog } from "./log"
import { isToolCall } from "./scorer"
import type { Candidate, ModelRaceUpdate, RaceOptions } from "./types"

type CandidateMessage =
  | { type: "event"; candidate: Candidate; event: LLMEvent; at: number }
  | { type: "failure"; candidate: Candidate; cause: Cause.Cause<unknown> }

export type StreamInput = {
  raceID?: string
  candidates: Candidate[]
  options: RaceOptions
  onUpdate?: (update: ModelRaceUpdate) => Effect.Effect<void>
  runCandidate: (candidate: Candidate, gate: ToolExecutionGate) => Stream.Stream<LLMEvent, unknown>
}

export function stream(input: StreamInput) {
  return Stream.scoped(
    Stream.unwrap(
      Effect.gen(function* () {
        const output = yield* Queue.unbounded<LLMEvent, unknown>()
        const inbox = yield* Queue.unbounded<CandidateMessage>()
        const gate = new ToolExecutionGate(input.candidates.map((candidate) => candidate.id))
        const controller = new Controller(input.candidates, input.options)
        const fibers = new Map<string, Fiber.Fiber<unknown, unknown>>()
        const raceID = input.raceID ?? crypto.randomUUID()
        let lastUpdateAt = 0

        const emit = (force = false) =>
          Effect.gen(function* () {
            const now = Date.now()
            if (!force && now - lastUpdateAt < 150) return
            lastUpdateAt = now
            const update = controller.snapshot(raceID, now)
            if (input.onUpdate) yield* input.onUpdate(update)
          })

        yield* emit(true)
        yield* ModelRaceLog.started(raceID, input.candidates, input.options, controller.snapshot(raceID))

        for (const candidate of input.candidates) {
          yield* ModelRaceLog.candidateStarted(raceID, candidate)
          let finished = false
          const fiber = yield* input.runCandidate(candidate, gate).pipe(
            Stream.tap((event) =>
              Effect.sync(() => {
                if (event.type === "finish") finished = true
              }),
            ),
            Stream.runForEach((event) =>
              Queue.offer(inbox, { type: "event", candidate, event, at: Date.now() }).pipe(Effect.asVoid),
            ),
            Effect.andThen(
              Effect.suspend(() =>
                finished
                  ? Effect.void
                  : Queue.offer(inbox, {
                      type: "failure",
                      candidate,
                      cause: Cause.fail(new Error(`Model race candidate ended without finish: ${candidate.id}`)),
                    }).pipe(Effect.asVoid),
              ),
            ),
            Effect.catchCause((cause) => Queue.offer(inbox, { type: "failure", candidate, cause }).pipe(Effect.asVoid)),
            Effect.forkScoped,
          )
          fibers.set(candidate.id, fiber)
        }

        yield* Effect.gen(function* () {
          while (controller.winner() === undefined) {
            const message = yield* Queue.take(inbox)
            if (message.type === "failure") {
              const error = Cause.squash(message.cause)
              controller.fail(message.candidate.id)
              yield* ModelRaceLog.candidateFailed(raceID, message.candidate, error)
              yield* emit(true)
              if (controller.allFailed()) {
                yield* ModelRaceLog.allFailed(raceID, error)
                return yield* Queue.failCause(output, message.cause)
              }
              continue
            }
            const previousLeader = controller.leader()
            const previousWinner = controller.winner()
            const previousState = controller.state(message.candidate.id)
            const previousFirstTokenAt = previousState?.firstTokenAt
            const previousTokensPerSecond = previousState?.tokensPerSecond
            const observation = controller.observe(message.candidate.id, message.event, message.at)
            const state = controller.state(message.candidate.id)
            if (state?.firstTokenAt !== undefined && previousFirstTokenAt === undefined) {
              yield* ModelRaceLog.firstToken(raceID, message.candidate, state.firstTokenAt - state.startedAt)
            }
            if (state?.tokensPerSecond !== undefined && state.tokensPerSecond !== previousTokensPerSecond) {
              yield* ModelRaceLog.throughput(raceID, message.candidate, state.tokensPerSecond, state.tokenCount)
            }
            if (isToolCall(message.event) && controller.winner()) {
              yield* ModelRaceLog.toolCallDetected(raceID, message.candidate, message.at)
            }
            if (!previousWinner && controller.winner()) {
              yield* ModelRaceLog.winnerLocked(controller.snapshot(raceID, message.at))
            }
            if (observation.switchedFrom) {
              yield* ModelRaceLog.leaderSwitched(
                raceID,
                observation.switchedFrom,
                controller.leader(),
                controller.snapshot(raceID, message.at),
              )
            }
            yield* emit(Boolean(observation.switchedFrom || (!previousWinner && controller.winner())))
            if (controller.allFailed()) {
              const error =
                message.event.type === "provider-error"
                  ? new Error(message.event.message)
                  : new Error("All model race candidates failed")
              yield* ModelRaceLog.allFailed(raceID, error)
              yield* emit(true)
              return yield* Queue.failCause(output, Cause.fail(error))
            }
          }

          const winner = controller.winner()!
          yield* emit(true)
          gate.allowWinner(winner.candidate.id)
          yield* Effect.forEach(
            [...fibers.entries()].filter(([id]) => id !== winner.candidate.id),
            ([id]) => {
              const candidate = input.candidates.find((item) => item.id === id)
              const cancel = candidate ? ModelRaceLog.candidateCancelled(raceID, candidate) : Effect.void
              controller.cancel(id)
              gate.cancel(id)
              const fiber = fibers.get(id)
              return cancel.pipe(Effect.andThen(fiber ? Fiber.interrupt(fiber) : Effect.void))
            },
            { concurrency: "unbounded" },
          )

          const state = controller.state(winner.candidate.id)!
          yield* Queue.offerAll(output, state.events)
          if (state.completed) {
            const update = controller.snapshot(raceID)
            yield* ModelRaceLog.completed(update)
            if (input.onUpdate) yield* input.onUpdate(update)
            yield* Queue.end(output)
            return
          }

          while (true) {
            const message = yield* Queue.take(inbox)
            if (message.candidate.id !== winner.candidate.id) continue
            if (message.type === "failure") return yield* Queue.failCause(output, message.cause)
            yield* Queue.offer(output, message.event)
            if (message.event.type === "finish") {
              const update = controller.snapshot(raceID)
              yield* ModelRaceLog.completed(update)
              if (input.onUpdate) yield* input.onUpdate(update)
              yield* Queue.end(output)
              return
            }
          }
        }).pipe(
          Effect.catchCause((cause) => Queue.failCause(output, cause).pipe(Effect.asVoid)),
          Effect.forkScoped,
        )

        return Stream.fromQueue(output)
      }),
    ),
  )
}
