export * as SessionRunner from "./index"

import type { LLMError } from "@opencode-ai/llm"
import { Context, Effect, Schema } from "effect"
import { SessionSchema } from "../schema"
import type { ContextSnapshotDecodeError, MessageDecodeError } from "../error"
import { SessionRunnerModel } from "./model"
import type { SystemContext } from "../../system-context/index"
import type { SessionContextEpoch } from "../context-epoch"
import type { ToolOutputStore } from "../../tool-output-store"

export class StepLimitExceededError extends Schema.TaggedErrorClass<StepLimitExceededError>()(
  "SessionRunner.StepLimitExceededError",
  {
    sessionID: SessionSchema.ID,
    limit: Schema.Int,
  },
) {}

// ─── Loop Config & Errors ────────────────────────────────────────────────────

export interface LoopConfig {
  /** Maximum number of phases (default: 10) */
  maxPhases: number
  /** Global timeout in milliseconds (default: 30 min) */
  globalTimeoutMs: number
  /** Per-phase timeout in milliseconds (default: 10 min) */
  phaseTimeoutMs: number
  /** Number of identical iterations before stuck detection (default: 3) */
  stuckThreshold: number
}

export const defaultLoopConfig: LoopConfig = {
  maxPhases: 10,
  globalTimeoutMs: 1_800_000, // 30 min
  phaseTimeoutMs: 600_000, // 10 min
  stuckThreshold: 3,
}

export class LoopTimeoutError extends Schema.TaggedErrorClass<LoopTimeoutError>()(
  "SessionRunner.LoopTimeoutError",
  {
    sessionID: SessionSchema.ID,
    elapsedMs: Schema.Int,
    limitMs: Schema.Int,
  },
) {}

export class LoopPhaseLimitError extends Schema.TaggedErrorClass<LoopPhaseLimitError>()(
  "SessionRunner.LoopPhaseLimitError",
  {
    sessionID: SessionSchema.ID,
    phasesExecuted: Schema.Int,
    maxPhases: Schema.Int,
  },
) {}

export class LoopStuckError extends Schema.TaggedErrorClass<LoopStuckError>()(
  "SessionRunner.LoopStuckError",
  {
    sessionID: SessionSchema.ID,
    phaseId: Schema.String,
    iterations: Schema.Int,
    lastTool: Schema.String,
  },
) {}

export type RunError =
  | LLMError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | ContextSnapshotDecodeError
  | StepLimitExceededError
  | LoopTimeoutError
  | LoopPhaseLimitError
  | LoopStuckError
  | SystemContext.InitializationBlocked
  | SessionContextEpoch.AgentReplacementBlocked
  | ToolOutputStore.Error

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work. Explicit runs perform one provider attempt even when no work is eligible. */
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force?: boolean
    readonly loopConfig?: LoopConfig
  }) => Effect.Effect<void, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunner") {}
