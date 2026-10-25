export * as SessionRunner from "./index.js"

import type { LLMError } from "@bolt-ai/llm"
import { Context, Effect } from "effect"
import { SessionSchema } from "../schema"
import type { ContextSnapshotDecodeError, MessageDecodeError } from "../error"
import { SessionRunnerModel } from "./model"
import type { SystemContext } from "../../system-context/index"
import type { ToolOutputStore } from "../../tool-output-store"

export type RunError =
  | AIError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | AgentNotFoundError
  | StepFailedError
  | Instructions.InitializationBlocked
  | FileSystem.DirectoryNotFoundError

export type Continuation = { readonly step: number }

export type DrainResult = Data.TaggedEnum<{
  Complete: {}
  Moved: { readonly continuation?: Continuation }
  Reloaded: { readonly force: boolean; readonly continuation?: Continuation }
}>
export const DrainResult = Data.taggedEnum<DrainResult>()

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

export class Service extends Context.Service<Service, Interface>()("@bolt/v2/SessionRunner") {}
