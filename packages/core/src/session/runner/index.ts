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
  readonly iterates: number
  readonly converged: boolean
  readonly certificate: TcaaCertificate
  readonly text: string
  readonly extensionsDetected: number
}

export interface TcaaCertificate {
  readonly epsilon: number
  readonly approximationGap?: number
}

export interface ReflectionDiagnostic {
  readonly muR: string
  readonly tauR: string
  readonly state: string
  readonly initialPrompt: string
  readonly rhoMuR: number
  readonly rhoTauR: number
  readonly rhoState: number
  readonly forwardMisalignment: number
  readonly backwardMisalignment: number
  readonly totalMisalignment: number
  readonly objectiveGap: number
  readonly cofinality: "omega" | "transfinite"
  readonly extensionsDetected: number
}

export interface ReflectionOutcome {
  readonly why: ReflectionResult
  readonly then: ReflectionResult
  readonly diagnostic: ReflectionDiagnostic
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
  /** Reads the most recent assistant text from durable Session history. Used by callers that compute the reflection diagnostic. */
  readonly lastAssistantText: (sessionID: SessionSchema.ID) => Effect.Effect<string, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunner") {}
