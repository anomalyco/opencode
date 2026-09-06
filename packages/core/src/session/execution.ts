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
  /** Fire Why loop reflection against the session's last assistant message. */
  readonly whyLoop: (
    sessionID: SessionSchema.ID,
    input?: { readonly model?: { readonly providerID: string; readonly modelID: string } },
  ) => Effect.Effect<SessionRunner.ReflectionResult, SessionRunner.RunError>
  /** Fire Then loop forward-projection against the session's last assistant message. */
  readonly thenLoop: (
    sessionID: SessionSchema.ID,
    input?: { readonly model?: { readonly providerID: string; readonly modelID: string } },
  ) => Effect.Effect<SessionRunner.ReflectionResult, SessionRunner.RunError>
  /** Fire Red-Team pass against the candidate action or plan. */
  readonly redTeamPass?: (
    sessionID: SessionSchema.ID,
    input?: {
      readonly call?: { readonly name: string; readonly input: unknown }
      readonly model?: { readonly providerID: string; readonly modelID: string }
    },
  ) => Effect.Effect<SessionRunner.ReflectionResult, SessionRunner.RunError>
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
    reflect: () =>
      Effect.succeed({
        why: { steered: false, iterates: 0, converged: true, certificate: { epsilon: 0 }, text: "", extensionsDetected: 0 },
        // eslint-disable-next-line unicorn/no-thenable
        then: { steered: false, iterates: 0, converged: true, certificate: { epsilon: 0 }, text: "", extensionsDetected: 0 },
        diagnostic: {
          muR: "",
          tauR: "",
          state: "",
          initialPrompt: "",
          rhoMuR: 0,
          rhoTauR: 0,
          rhoState: 0,
          forwardMisalignment: 0,
          backwardMisalignment: 0,
          totalMisalignment: 0,
          objectiveGap: 0,
          cofinality: "omega" as const,
          extensionsDetected: 0,
        },
      }),
    whyLoop: () =>
      Effect.succeed({
        steered: false,
        iterates: 0,
        converged: true,
        certificate: { epsilon: 0 },
        text: "",
        extensionsDetected: 0,
      }),
    thenLoop: () =>
      Effect.succeed({
        steered: false,
        iterates: 0,
        converged: true,
        certificate: { epsilon: 0 },
        text: "",
        extensionsDetected: 0,
      }),
    redTeamPass: () =>
      Effect.succeed({
        steered: false,
        iterates: 1,
        converged: true,
        certificate: { epsilon: 0 },
        text: "SURVIVE",
        extensionsDetected: 0,
      }),
    escalate: () => Effect.die("Escalation not available in noop layer"),
  }),
)
