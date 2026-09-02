export * as Instruction from "./instructions.js"

import type { Agent } from "@opencode-ai/schema/agent"
import type { Location } from "@opencode-ai/schema/location"
import type { Session } from "@opencode-ai/schema/session"
import type { Effect, Schema } from "effect"

/** An observed absence. Global symbols preserve identity across separately installed plugin copies. */
export const removed: unique symbol = Symbol.for("@opencode-ai/plugin/instructions/removed")
export type Removed = typeof removed

/** The source cannot currently be read; its last stored value stands. */
export const unavailable: unique symbol = Symbol.for("@opencode-ai/plugin/instructions/unavailable")
export type Unavailable = typeof unavailable

export interface Context {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly location: Location.Info
}

interface Definition<A, Read> {
  readonly key: string
  readonly codec: Schema.Codec<A, Schema.Json>
  readonly read: (context: Context) => Read
  readonly render: {
    readonly initial: (current: A) => string
    readonly changed: (previous: A, current: A) => string
    readonly removed?: (previous: A) => string
  }
}

export interface EffectDraft {
  add<A>(source: Definition<A, Effect.Effect<NoInfer<A> | Removed | Unavailable, unknown>>): void
}

export interface PromiseDraft {
  add<A>(source: Definition<A, NoInfer<A> | Removed | Unavailable | Promise<NoInfer<A> | Removed | Unavailable>>): void
}
