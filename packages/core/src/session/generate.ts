export * as SessionGenerate from "./generate"

import type { LLMError } from "@opencode-ai/ai"
import { Context, type Effect } from "effect"
import type { Instructions } from "../instructions"
import type { AgentNotFoundError } from "./error"
import type { SessionRunnerModel } from "./runner/model"
import type { SessionSchema } from "./schema"

export type Error = AgentNotFoundError | Instructions.InitializationBlocked | SessionRunnerModel.Error | LLMError

export interface Interface {
  /** Generates text from current Session context without mutating the Session. */
  readonly generate: (input: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: string
  }) => Effect.Effect<string, Error>
}

/** Location-scoped transient generation from Session context. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionGenerate") {}
