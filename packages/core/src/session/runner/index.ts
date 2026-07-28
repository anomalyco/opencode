export * as SessionRunner from "./index"

import type { LLMError } from "@opencode-ai/ai"
import { Context, Effect } from "effect"
import { SessionSchema } from "../schema"
import type { AgentNotFoundError, MessageDecodeError, StepFailedError, UserInterruptedError } from "../error"
import { SessionRunnerModel } from "./model"
import type { Instructions } from "../../instructions/index"

export type RunError =
  | LLMError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | AgentNotFoundError
  | StepFailedError
  | UserInterruptedError
  | Instructions.InitializationBlocked

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work. Explicit runs make one model call even when no work is eligible. */
  readonly drain: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force: boolean
  }) => Effect.Effect<void, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunner") {}
