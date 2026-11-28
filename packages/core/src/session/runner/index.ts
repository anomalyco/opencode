export * as SessionRunner from "./index.js"

import type { FileSystem } from "../../filesystem.js"
import type { AIError } from "@opencode/ai/effect"
import { Context, Data, Effect } from "effect"
import { SessionEvent } from "../event.js"
import { SessionSchema } from "../schema.js"
import type { Promotable, Reach } from "../inbox.js"
import type { AgentNotFoundError, MessageDecodeError, StepFailedError } from "../error.js"
import { SessionRunnerModel } from "./model.js"
import type { Instructions } from "../../instructions/index.js"

export type RunError =
  | AIError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | AgentNotFoundError
  | StepFailedError
  | Instructions.InitializationBlocked
  | FileSystem.DirectoryNotFoundError

/**
 * Where a drain picks up: fresh work, which a forced drain runs a step for even with no input;
 * mid-turn at a step; or between turns after a step, so going idle still runs the idle hook.
 */
export type Position =
  | { readonly _tag: "Fresh"; readonly forced: boolean }
  | { readonly _tag: "Continue"; readonly step: number }
  | { readonly _tag: "BetweenTurns" }

export type DrainResult = Data.TaggedEnum<{
  Complete: {}
  Moved: { readonly at: Position }
  Reloaded: { readonly at: Position }
}>
export const DrainResult = Data.taggedEnum<DrainResult>()

/**
 * How far a boundary reaches into the inbox. A step boundary mid-turn takes steers only. Entry and
 * idle boundaries also take a queued control at the queue head, and a queued prompt there unless
 * the drain only settles steered intent. A continued turn never takes queued prompts.
 */
export const reach = (at: Position, entering: boolean, promotable: Promotable): Reach => {
  if (at._tag === "Continue") return entering ? "control" : "steer"
  return promotable === "steer" ? "control" : "input"
}

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work, returning transient state when execution must continue at a new Location. */
  readonly drain: (input: {
    readonly sessionID: SessionSchema.ID
    /** Where this drain picks up; defaults to unforced fresh work. */
    readonly at?: Position
    /** "steer" settles the active intent without promoting queued next-turn work. */
    readonly promotable?: Promotable
    /** Why the execution is being interrupted, once it is: the reason supplied with the interrupt, or undefined for a teardown. */
    readonly interruption?: () => SessionEvent.Execution.Interrupted["data"]["reason"] | undefined
  }) => Effect.Effect<DrainResult, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunner") {}
