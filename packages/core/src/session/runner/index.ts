export * as SessionRunner from "./index"

import type { LLMError } from "@opencode-ai/llm"
import { Context, Effect, Schema } from "effect"
import { SessionSchema } from "../schema"
import { SessionRunnerModel } from "./model"

export class StepLimitExceededError extends Schema.TaggedErrorClass<StepLimitExceededError>()(
  "SessionRunner.StepLimitExceededError",
  {
    sessionID: SessionSchema.ID,
    limit: Schema.Int,
  },
) {}

export type RunError = LLMError | SessionRunnerModel.Error | StepLimitExceededError

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  readonly run: (sessionID: SessionSchema.ID) => Effect.Effect<void, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunner") {}
