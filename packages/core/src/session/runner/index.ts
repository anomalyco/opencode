export * as SessionRunner from "./index"

import type { LLMError } from "@opencode-ai/llm"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { SessionSchema } from "../schema"
import type { MessageDecodeError } from "../error"
import { SessionRunnerModel } from "./model"

export class StepLimitExceededError extends Schema.TaggedErrorClass<StepLimitExceededError>()(
  "SessionRunner.StepLimitExceededError",
  {
    sessionID: SessionSchema.ID,
    limit: Schema.Int,
  },
) {}

export class ProviderStreamTimeoutError extends Schema.TaggedErrorClass<ProviderStreamTimeoutError>()(
  "SessionRunner.ProviderStreamTimeoutError",
  {
    kind: Schema.Literals(["inactivity", "absolute"]),
    duration: Schema.String,
  },
) {
  override get message() {
    return `Provider stream ${this.kind} timeout after ${this.duration}`
  }
}

export interface TimeoutConfig {
  readonly inactivity: Duration.Duration
  readonly absolute: Duration.Duration
}

export class TimeoutService extends Context.Service<TimeoutService, TimeoutConfig>()("@opencode/v2/SessionRunnerTimeout") {}

export const timeoutDefaultLayer = Layer.succeed(
  TimeoutService,
  TimeoutService.of({ inactivity: Duration.seconds(60), absolute: Duration.minutes(10) }),
)

export type RunError = LLMError | SessionRunnerModel.Error | MessageDecodeError | StepLimitExceededError | ProviderStreamTimeoutError

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work. Explicit runs perform one provider attempt even when no work is eligible. */
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force?: boolean
  }) => Effect.Effect<void, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunner") {}
