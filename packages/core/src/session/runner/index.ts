export * as SessionRunner from "./index"

import type { LLMError } from "@opencode-ai/llm"
import { Context, Effect, Layer } from "effect"
import { SessionSchema } from "../schema"

export type RunError = LLMError

/** Runs one local continuation from already-admitted Session history. */
export interface Interface {
  readonly run: (sessionID: SessionSchema.ID) => Effect.Effect<void, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunner") {}

/** Placeholder until an embedding selects an LLM model. */
export const noopLayer = Layer.succeed(Service, Service.of({ run: () => Effect.void }))
