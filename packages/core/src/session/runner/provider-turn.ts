export * as SessionRunnerProviderTurn from "./provider-turn"

import { LLMEvent, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import { Cause, DateTime, Effect, FiberSet, Option, Semaphore, Stream } from "effect"
import { EventV2 } from "../../event"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { ToolRegistry } from "../../tool/registry"
import { SessionEvent } from "../event"
import { SessionSchema } from "../schema"
import { createLLMEventPublisher } from "./publish-llm-event"

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly agent: string
  readonly variant?: ModelV2.VariantID
  readonly request: LLMRequest
}

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: LLMClientShape
  readonly tools: ToolRegistry.Interface
}

/** Runs and durably settles exactly one provider turn. */
export const make = (dependencies: Dependencies) => {
  const awaitToolFibers = (fibers: FiberSet.FiberSet<void, never>) =>
    Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

  // Match V1: dismissing a question halts the loop instead of becoming model-facing tool output.
  const isQuestionRejected = (cause: Cause.Cause<unknown>) =>
    cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect instanceof QuestionV2.RejectedError)

  return Effect.fn("SessionRunnerProviderTurn.run")(function* (input: Input) {
    const toolFibers = yield* FiberSet.make<void, never>()
    let needsContinuation = false
    const publisher = createLLMEventPublisher(dependencies.events, {
      sessionID: input.sessionID,
      agent: input.agent,
      model: {
        id: ModelV2.ID.make(input.request.model.id),
        providerID: ProviderV2.ID.make(input.request.model.provider),
        ...(input.variant === undefined ? {} : { variant: input.variant }),
      },
    })
    const withPublication = Semaphore.makeUnsafe(1).withPermit
    const publish = (event: LLMEvent) => withPublication(publisher.publish(event))
    const providerStream = dependencies.llm.stream(input.request).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          yield* publish(event)
          if (event.type !== "tool-call" || event.providerExecuted) return
          needsContinuation = true
          yield* dependencies.tools.settle({ sessionID: input.sessionID, call: event }).pipe(
            Effect.catchCause((cause) => {
              if (isQuestionRejected(cause)) return Effect.failCause(cause)
              return Effect.succeed({
                result: { type: "error" as const, value: String(Cause.squash(cause)) },
                output: undefined,
              })
            }),
            Effect.flatMap((settlement) =>
              publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: settlement.result,
                  output: settlement.output,
                }),
              ),
            ),
            FiberSet.run(toolFibers),
          )
        }),
      ),
      Effect.ensuring(withPublication(publisher.flush())),
    )

    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const stream = yield* restore(providerStream).pipe(Effect.exit)
        const llmFailure = stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
        if (llmFailure && !publisher.hasProviderError()) {
          yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          yield* withPublication(
            dependencies.events.publish(SessionEvent.Step.Failed, {
              sessionID: input.sessionID,
              timestamp: yield* DateTime.now,
              assistantMessageID: yield* publisher.startAssistant(),
              error: { type: "unknown", message: llmFailure.reason.message },
            }),
          )
        }
        const streamInterrupted = stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)
        if (streamInterrupted) yield* FiberSet.clear(toolFibers)
        const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
        if (settled._tag === "Failure" && isQuestionRejected(settled.cause)) {
          yield* FiberSet.clear(toolFibers)
          yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
          return yield* Effect.interrupt
        }
        const settlementInterrupted = settled._tag === "Failure" && Cause.hasInterrupts(settled.cause)
        if (streamInterrupted || settlementInterrupted) {
          if (!streamInterrupted) yield* FiberSet.clear(toolFibers)
          yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
        }
        if (publisher.hasProviderError()) yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
        if (stream._tag === "Success" && !publisher.hasProviderError())
          yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
        const attempt = stream._tag === "Failure" ? stream : settled
        if (attempt._tag === "Failure") return yield* Effect.failCause(attempt.cause)
        return !publisher.hasProviderError() && needsContinuation
      }),
    )
  }, Effect.scoped)
}
