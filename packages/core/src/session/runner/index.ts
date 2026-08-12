export * as SessionRunner from "./index.js"

import type { AIError } from "@opencode-ai/ai"
import { Context, Effect } from "effect"
import { SessionSchema } from "../schema.js"
import type { AgentNotFoundError, MessageDecodeError, StepFailedError, UserInterruptedError } from "../error.js"
import { SessionRunnerModel } from "./model.js"
import type { Instructions } from "../../instructions/index.js"

export type RunError =
  | AIError
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
