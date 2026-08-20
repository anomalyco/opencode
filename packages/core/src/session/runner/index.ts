export * as SessionRunner from "./index.js"

import type { AIError } from "@opencode-ai/ai"
import { Context, Effect } from "effect"
import { SessionSchema } from "../schema.js"
import type { Promotable } from "../inbox.js"
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

export type Continuation = { readonly step: number }

export type DrainResult =
  | { readonly type: "complete" }
  | { readonly type: "moved"; readonly continuation?: Continuation }

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work, returning transient state when execution must continue at a new Location. */
  readonly drain: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force: boolean
    readonly continuation?: Continuation
    /** "steer" settles the active intent without promoting queued next-turn work. */
    readonly promotable?: Promotable
  }) => Effect.Effect<DrainResult, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunner") {}
