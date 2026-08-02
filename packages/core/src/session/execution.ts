export * as SessionExecution from "./execution"

import { Context, Effect, Layer } from "effect"
import { LayerNode } from "../effect/layer-node"
import { Node } from "../effect/app-node"
import { SessionRunner } from "./runner/index"
import { SessionSchema } from "./schema"

export interface Interface {
  /** Snapshots active execution owned by this process. */
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  /** Starts execution while idle or joins the active execution. */
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  /** Registers newly recorded work. Repeated wakeups may coalesce. */
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Fire Why/Then reflective loops against the session's last assistant message. No provider turn is run. */
  readonly reflect: (
    sessionID: SessionSchema.ID,
    input?: { readonly model?: { readonly providerID: string; readonly modelID: string } },
  ) => Effect.Effect<SessionRunner.ReflectionOutcome, SessionRunner.RunError>
  /** Escalate current task to a more capable (cloud) model. Re-routes through automation queue. */
  readonly escalate: (
    input: { readonly sessionID: SessionSchema.ID; readonly reason: string },
  ) => Effect.Effect<{ readonly escalated: boolean; readonly message: string }, EscalateError>
}

export class EscalateError extends Error {
  readonly _tag = "EscalateError"
  constructor(message: string) {
    super(message)
  }
}

/** Routes execution from a Session ID to the runner owned by that Session's Location. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionExecution") {}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

/** Low-level compatibility layer for callers that only need durable Session recording. */
export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
    reflect: () => Effect.die("Reflection not available in noop layer"),
    escalate: () => Effect.die("Escalation not available in noop layer"),
  }),
)
