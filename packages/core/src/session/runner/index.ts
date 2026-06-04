export * as SessionRunner from "./index"

import type { LLMError } from "@opencode-ai/llm"
import { Context, Effect, Schema } from "effect"
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

export type RunError = LLMError | SessionRunnerModel.Error | MessageDecodeError | StepLimitExceededError

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work. Explicit runs perform one provider attempt even when no work is eligible. */
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force?: boolean
  }) => Effect.Effect<void, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunner") {}
