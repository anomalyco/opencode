export * as SessionRunner from "./index"

import type { LLMError } from "@opencode-ai/llm"
import { Context, Effect } from "effect"
import { SessionSchema } from "../schema"
import type { ContextSnapshotDecodeError, MessageDecodeError } from "../error"
import { SessionRunnerModel } from "./model"
import type { SystemContext } from "../../system-context/index"
import type { ToolOutputStore } from "../../tool-output-store"

export type RunError =
  | LLMError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | ContextSnapshotDecodeError
  | SystemContext.InitializationBlocked
  | ToolOutputStore.Error

export interface ReflectionResult {
  readonly steered: boolean
}

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work. Explicit runs perform one provider attempt even when no work is eligible. */
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force: boolean
  }) => Effect.Effect<void, RunError>
  /** Why Loop: post-tool-settlement reflection on whether new information changed the goal. */
  readonly whyLoop: (
    sessionID: SessionSchema.ID,
    modelOverride?: { readonly providerID: string; readonly modelID: string },
  ) => Effect.Effect<ReflectionResult, RunError>
  /** Then Loop: forward projection from the most recent assistant message. */
  readonly thenLoop: (
    sessionID: SessionSchema.ID,
    modelOverride?: { readonly providerID: string; readonly modelID: string },
  ) => Effect.Effect<ReflectionResult, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunner") {}
