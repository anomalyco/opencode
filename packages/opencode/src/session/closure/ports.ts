import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { BackgroundJob } from "@opencode-ai/core/background-job"
import { Context, Effect, Layer, Schema } from "effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { AttachmentCoordinator } from "../attachment/coordinator"
import { AttachmentParticipant } from "../attachment/participant"
import type { MessageID, PartID, SessionID } from "../schema"
import type { SessionToolPartPermit } from "../toolpart-permit"
import { SessionClosureDriver } from "./driver"
import type * as Model from "./model"

export type RuntimeIdentity = {
  readonly instance: Model.InstanceID
  readonly directory: string
  readonly worktree: string
  readonly project: string
  readonly workspace: string
}

export class LocationError extends Schema.TaggedErrorClass<LocationError>()("SessionClosureLocationError", {
  expected: Schema.String,
  actual: Schema.String,
}) {}

export interface RunStateCapability {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void, unknown>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
}

/** Runner and shell activity are independent; either can keep a Session busy. */
export type RunnerActivity = {
  readonly session: SessionID
  readonly running: boolean
  readonly shell: boolean
}

/** Kept local to avoid depending on `SessionPhysical`, which depends on closure. */
export type SignalOutcome = "interrupted" | "adopted" | "in_progress" | "absent"

/** `discovery.ts` composes observation and interruption downstream to avoid a service cycle. */
export type RunnerEvidence = RunnerActivity & {
  readonly interrupt: Effect.Effect<SignalOutcome>
}

/**
 * `state` is the lifetime phase and `status` the public job status. Both are reported because they
 * are different axes and neither implies the other: a registered-unarmed token already reports
 * `status: "running"`, so status alone cannot distinguish armed work from work that may still arm.
 */
export type JobEvidence = {
  readonly job: string
  readonly state: BackgroundJob.LifetimeState
  readonly status: BackgroundJob.Status
  readonly target?: SessionID
  readonly owner?: SessionID
  /**
   * Enumeration has a message and call ID but no durable Part ID. The Part is resolved after
   * quiescence, avoiding a database query inside every fixed-point sweep.
   */
  readonly taskMessage?: string
  readonly taskCall?: string
  /**
   * The capability closes over the lifetime observed during enumeration. Re-resolving a reusable
   * public job ID later would be ABA-unsafe because it could address a successor lifetime.
   */
  readonly interrupt: Effect.Effect<SignalOutcome>
}

/** Enumerates runtime activity without classifying it. */
export interface DiscoveryCapability {
  readonly runners: Effect.Effect<readonly RunnerEvidence[]>
  readonly jobs: Effect.Effect<readonly JobEvidence[]>
}

/**
 * Queries parents only for sessions named by current evidence. Lineage may connect evidence but must
 * never seed cancellation scope.
 */
export interface LineageCapability {
  readonly parents: (
    sessions: readonly string[],
  ) => Effect.Effect<readonly { readonly session: SessionID; readonly parent: SessionID }[]>
}

/** `part` is absent when the coordinate resolved no ToolPart, leaving the outcome `unknown`. */
export type ToolPartOutcome = {
  readonly outcome: "cancelled" | "completed" | "error" | "unknown"
  readonly part?: PartID
}

/** An absent identity is a valid result that the model turns into a pre-allocation planning failure. */
export interface PlanIdentityCapability {
  readonly resolve: (
    targets: readonly Model.SessionID[],
  ) => Effect.Effect<readonly { readonly session: Model.SessionID; readonly identity?: Model.Identity }[]>
}

/** Omits sessions without persisted timestamps so absence stays distinguishable from zero. */
export interface HighWaterCapability {
  readonly read: (
    targets: readonly Model.SessionID[],
  ) => Effect.Effect<readonly { readonly session: Model.SessionID; readonly millis: number }[]>
}

export type RecordResult = {
  readonly message: "verified" | "failed"
  readonly part: "verified" | "failed" | "absent"
}

export type RecordVerification = "verified" | "failed"

export interface RecordCapability {
  readonly write: (input: {
    readonly command: Extract<ExternalCommand, { readonly type: "pair.write" }>
    readonly record: Model.FrozenPair
  }) => Effect.Effect<RecordResult>
  readonly verify: (input: {
    readonly command: Extract<ExternalCommand, { readonly type: "release.verify" }>
    readonly operation: Model.OperationView
  }) => Effect.Effect<RecordVerification>
}

/**
 * Resolves and terminalizes one proven Task ToolPart atomically, returning the authoritative row's
 * winner rather than inferring it from cancellation. Fence-time yield is a separate participant fact.
 */
export interface ToolPartCapability {
  readonly terminalize: (input: {
    readonly session: SessionID
    readonly message: MessageID
    readonly call: string
    /** Coordinator-minted authority for this operation, kept separate from the request capability. */
    readonly grant: SessionToolPartPermit.Grant
  }) => Effect.Effect<ToolPartOutcome>
}

type WithoutInstance<T> = T extends unknown ? Omit<T, "instance"> : never
type CoordinatorEvent = Extract<
  Model.Event,
  {
    readonly type:
      | "request"
      | "waiter.interrupt"
      | "ticket.received"
      | "ticket.dequeued"
      | "ticket.accept"
      | "ticket.offer_failed"
      | "worker.registered"
      | "worker.registration_failed"
      | "worker.started"
      | "worker.exited"
      | "supervisor.failed"
      | "operation.claim"
      | "participant.observe"
      | "effect.issue"
      | "effect.dispatch"
      | "effect.return"
      | "waiter.delivered"
      | "cleanup"
      | "dispose"
  }
>

export type DriverEvent = WithoutInstance<Exclude<Model.Event, CoordinatorEvent>>
export type ExternalCommand = Exclude<
  Model.Command,
  {
    readonly type: "ticket.offer" | "worker.register" | "worker.open" | "driver.run" | "waiter.deliver" | "effect.run"
  }
>

export type EffectResult = "success" | "failure"

export type EffectInput = {
  readonly operation: Model.OperationID
  readonly effect: "signal" | "record_readback"
  readonly run: Effect.Effect<EffectResult, unknown>
}

export type ParticipantKind = "discover" | "claim" | "cancel" | "observe"

declare const ParticipantFenceRefBrand: unique symbol

/**
 * Process-local identity for one core fence generation.
 * It can be compared or used as a Map key but cannot be inspected or reconstructed.
 */
export type ParticipantFenceRef = object & { readonly [ParticipantFenceRefBrand]: true }

export type ParticipantFenceInput = {
  readonly subject: Model.SessionID
  readonly ref: ParticipantFenceRef
}

export type ParticipantCancelInput = {
  readonly subject: Model.SessionID
  readonly outcome: SignalOutcome
}

export type ParticipantCancelFenceInput = ParticipantCancelInput & {
  readonly ref: ParticipantFenceRef
}

export type ParticipantCall = {
  readonly kind: ParticipantKind
  readonly participant: Model.ParticipantID
  readonly operation: Model.OperationID
  readonly repair: Model.RepairID
  readonly operationRevision: bigint
  readonly participantRevision: bigint
  readonly payload: unknown
}

export type ParticipantResult = {
  readonly revision: bigint
  readonly result: EffectResult
  readonly value?: unknown
}

export type ParticipantExchange = {
  readonly step: Model.Step
  readonly result?: ParticipantResult
  readonly accepted: boolean
}

export type ParticipantIssue =
  | {
      readonly operation: Model.OperationID
      readonly participant: Model.ParticipantID
      readonly kind: "discover"
      readonly payload?: unknown
    }
  | {
      readonly operation: Model.OperationID
      readonly participant: Model.ParticipantID
      readonly kind: "cancel"
      readonly cancels: readonly ParticipantCancelInput[]
    }
  | {
      readonly operation: Model.OperationID
      readonly participant: Model.ParticipantID
      readonly kind: "claim" | "observe"
      readonly subjects: readonly Model.SessionID[]
    }

export type WorkerAuthority = {
  readonly operation: Model.OperationID
  readonly ticket: Model.TicketID
  readonly worker: Model.WorkerID
  readonly repair: Model.RepairID
  readonly revision: bigint
}

export interface Participant {
  readonly id: Model.ParticipantID
  readonly discover: (input: ParticipantCall) => Effect.Effect<ParticipantResult>
  readonly claim: (input: ParticipantCall) => Effect.Effect<ParticipantResult>
  readonly cancel: (input: ParticipantCall) => Effect.Effect<ParticipantResult>
  readonly observe: (input: ParticipantCall) => Effect.Effect<ParticipantResult>
}

export interface Control {
  readonly identity: RuntimeIdentity
  readonly authority?: WorkerAuthority
  readonly transition: (event: DriverEvent) => Effect.Effect<Model.Step, LocationError>
  readonly claim: (input: {
    readonly operation: Model.OperationID
    readonly proofs: readonly Model.ProofInput[]
    readonly signals: readonly Effect.Effect<EffectResult, unknown>[]
    /** May capture participant state after fencing; signal dispatch remains coordinator-owned. */
    readonly beforeSignals?: (operation: Model.OperationID) => Effect.Effect<void, LocationError>
    readonly afterSignals?: (operation: Model.OperationID) => Effect.Effect<void, LocationError>
  }) => Effect.Effect<Model.Step, LocationError>
  readonly issue: (input: EffectInput) => Effect.Effect<Model.Step, LocationError>
  readonly issueParticipant: (input: ParticipantIssue) => Effect.Effect<ParticipantExchange, LocationError>
  readonly view: Effect.Effect<Model.View, LocationError>
  readonly scan: (operation: Model.OperationID) => Effect.Effect<Model.ScanCapture, LocationError>
}

export type DriverRun = {
  readonly command: Extract<Model.Command, { readonly type: "driver.run" }>
  readonly control: Control
  readonly runState: RunStateCapability
  /** IDs without methods keep invocation behind the coordinator's revalidation boundary. */
  readonly participants: readonly Model.ParticipantID[]
  /**
   * Forwarded from the request to avoid a layer cycle through `SessionRunState`. It is optional
   * because an absent source and an enumerated empty source carry different evidence.
   */
  readonly discovery?: DiscoveryCapability
  readonly lineage?: LineageCapability
  /** Request-scoped because a layer dependency would cycle through `Session`. */
  readonly toolPart?: ToolPartCapability
  /**
   * Coordinator-minted authority for this run. Keeping it off request capabilities prevents callers
   * from minting authority.
   */
  readonly toolPartGrant: SessionToolPartPermit.Grant
}

export type DriverCommand = {
  readonly command: ExternalCommand
  readonly control: Control
  readonly runState?: RunStateCapability
  /**
   * `plan.read` routes to `driver.command`, so identity resolution must arrive on the command side.
   * Absence means the read cannot be answered; an empty result is valid.
   */
  readonly planIdentity?: PlanIdentityCapability
  /** Absence degrades to zero; later readback and ordering checks reject a base that is too small. */
  readonly highWater?: HighWaterCapability
  /** An absent writer produces `record_failed`, never a silent no-op. */
  readonly record?: RecordCapability
}

export interface Driver {
  readonly run: (input: DriverRun) => Effect.Effect<void>
  readonly command: (input: DriverCommand) => Effect.Effect<void>
}

export interface Hooks {
  readonly afterRequest?: (input: {
    readonly root: Model.SessionID
    readonly operation: Model.OperationID
    readonly waiter: Model.WaiterID
    readonly decision: Model.Decision
  }) => Effect.Effect<void>
  readonly supervisorReady?: (identity: RuntimeIdentity) => Effect.Effect<void>
  readonly beforeSupervisorTake?: (identity: RuntimeIdentity) => Effect.Effect<void>
  readonly offerTicket?: (
    input: Extract<Model.Command, { readonly type: "ticket.offer" }>,
    offer: Effect.Effect<boolean>,
  ) => Effect.Effect<boolean>
  readonly afterTicketOffer?: (input: Extract<Model.Command, { readonly type: "ticket.offer" }>) => Effect.Effect<void>
  readonly afterTicketAccept?: (input: Extract<Model.Command, { readonly type: "ticket.offer" }>) => Effect.Effect<void>
  readonly beforeWorkerRegister?: (
    input: Extract<Model.Command, { readonly type: "worker.register" }>,
  ) => Effect.Effect<void>
  readonly beforeWorkerOpen?: (input: Extract<Model.Command, { readonly type: "worker.open" }>) => Effect.Effect<void>
  readonly beforeWorkerExit?: (input: {
    readonly operation: Model.OperationID
    readonly ticket: Model.TicketID
    readonly worker: Model.WorkerID
    readonly repair: Model.RepairID
    readonly revision: bigint
  }) => Effect.Effect<void>
  readonly afterWorkerExit?: (input: {
    readonly operation: Model.OperationID
    readonly ticket: Model.TicketID
    readonly worker: Model.WorkerID
    readonly repair: Model.RepairID
    readonly revision: bigint
    readonly decision: Model.Decision
  }) => Effect.Effect<void>
  readonly beforeEffectDispatch?: (
    input: Extract<Model.Command, { readonly type: "effect.run" }>,
  ) => Effect.Effect<void>
  readonly beforeWaiterDelivery?: (
    input: Extract<Model.Command, { readonly type: "waiter.deliver" }>,
  ) => Effect.Effect<void>
  readonly afterWaiterDelivery?: (
    input: Extract<Model.Command, { readonly type: "waiter.deliver" }>,
  ) => Effect.Effect<void>
}

/**
 * Discovery, lineage, and ToolPart access are request-scoped because their services depend on
 * closure and would close a layer cycle here.
 */
export type RuntimePorts = {
  readonly driver: Driver
  readonly participants: readonly Participant[]
  readonly hooks: Hooks
}

export interface Interface {
  readonly make: (identity: RuntimeIdentity) => Effect.Effect<RuntimePorts>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionClosurePorts") {}

const driver: Driver = SessionClosureDriver.make()

/**
 * Dependencies here must not transitively depend on closure. The attachment participant is wired
 * here because layer compilation does not provide services from sibling nodes.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const coordinator = yield* AttachmentCoordinator.Service
    const flags = yield* RuntimeFlags.Service
    const participants = flags.experimentalBackgroundSubagents ? [AttachmentParticipant.make(coordinator)] : []
    return Service.of({
      make: () => Effect.succeed({ driver, participants, hooks: {} }),
    })
  }),
)

export const makeLayer = (make: Interface["make"]) => Layer.succeed(Service)(Service.of({ make }))

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [AttachmentCoordinator.node, RuntimeFlags.node],
})

export * as SessionClosurePorts from "./ports"
