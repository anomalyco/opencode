declare const idBrand: unique symbol
declare const stateBrand: unique symbol

export type IDKind =
  | "instance"
  | "session"
  | "operation"
  | "view"
  | "waiter"
  | "ticket"
  | "worker"
  | "repair"
  | "lease"
  | "mutation"
  | "effect"
  | "pair"
  | "arm"
  | "participant"
  | "edge"
  | "fact"
  | "job"
  | "lifetime"
  | "request"
  | "scope"
  | "message"
  | "part"
  | "event"

export type ID<K extends IDKind> = string & { readonly [idBrand]: K }
export type InstanceID = ID<"instance">
export type SessionID = ID<"session">
export type OperationID = ID<"operation">
export type ViewID = ID<"view">
export type WaiterID = ID<"waiter">
export type TicketID = ID<"ticket">
export type WorkerID = ID<"worker">
export type RepairID = ID<"repair">
export type LeaseID = ID<"lease">
export type MutationID = ID<"mutation">
export type EffectID = ID<"effect">
export type PairID = ID<"pair">
export type ArmID = ID<"arm">
export type ParticipantID = ID<"participant">
export type EdgeID = ID<"edge">
export type FactID = ID<"fact">
export type JobID = ID<"job">
export type LifetimeID = ID<"lifetime">
export type RequestID = ID<"request">
export type ScopeID = ID<"scope">
export type MessageID = ID<"message">
export type PartID = ID<"part">
export type EventID = ID<"event">

export type State = { readonly [stateBrand]: true }
type Scoped<T> = T extends unknown ? T & { readonly instance: InstanceID } : never

export type Phase =
  | { readonly type: "driver_starting" }
  | { readonly type: "claiming" }
  | { readonly type: "fencing" }
  | { readonly type: "quiescing" }
  | { readonly type: "planning" }
  /**
   * Unreachable by construction in the shipped pipeline. `planningReturn` atomically constructs the
   * frozen generation and enters `recording`; no transition assigns this variant. It remains only
   * because `"freezing"` is exported through `FenceState` and the `AdmissionRefused` schema.
   */
  | { readonly type: "freezing" }
  /**
   * `generation` is absent when no facts were constructed. A sentinel would name a nonexistent
   * generation and make keyed lookups silently miss; keeping it optional preserves the public
   * `recording` fence state.
   */
  | { readonly type: "recording"; readonly generation?: number }
  | { readonly type: "quiescence_failed" }
  | { readonly type: "planning_failed_identity_missing" }
  | { readonly type: "record_failed" }
  | { readonly type: "closure_unavailable" }
  | { readonly type: "released_pending_delivery" }
  /**
   * Unreachable by construction. Successful operations remain `released_pending_delivery` until
   * `cleanup` removes them; no transition assigns this variant. It remains exported compatibility
   * vocabulary and an invalid-jump target.
   */
  | { readonly type: "complete" }

export type FailureKind =
  | "scope_incomplete"
  | "quiescence_failed"
  | "planning_failed"
  | "record_failed"
  | "closure_unavailable"

export type Driver =
  | { readonly state: "none"; readonly operation: OperationID }
  | {
      readonly state: "starting"
      readonly operation: OperationID
      readonly ticket: TicketID
      readonly repair: RepairID
      readonly revision: bigint
    }
  | {
      readonly state: "running"
      readonly operation: OperationID
      readonly ticket: TicketID
      readonly worker: WorkerID
      readonly repair: RepairID
      readonly revision: bigint
      readonly gate: "pending" | "opened" | "failed"
    }
  | {
      readonly state: "failed"
      readonly operation: OperationID
      readonly repair: RepairID
      readonly revision: bigint
      readonly failureRevision: bigint
    }

export type TerminalOutcome = "cancelled" | "completed" | "error" | "unknown"
export type FenceState =
  | "closing"
  | "planning"
  | "planning_failed_identity_missing"
  /**
   * Schema-compatibility vocabulary only. Model-created states cannot reach it, but
   * `AdmissionRefused.reason` exports the literal through `Schema.Literals`.
   */
  | "freezing"
  | "recording"
  | "quiescence_failed"
  | "record_failed"
  | "closure_unavailable"

export type Identity = {
  readonly source: "prior_user_message" | "session_identity" | "resume_admission"
  readonly sourceMessage?: MessageID
  readonly agent: string
  readonly model: {
    readonly providerID: string
    readonly modelID: string
    readonly variant: { readonly present: false } | { readonly present: true; readonly value: string }
  }
}

export type FactInput =
  | {
      readonly type: "self"
      readonly subject: SessionID
      readonly outcome: TerminalOutcome
      readonly yielded: boolean
    }
  | {
      readonly type: "edge"
      readonly subject: SessionID
      readonly owner: SessionID
      readonly child: SessionID
      readonly edge?: EdgeID
      readonly taskPart?: PartID
      readonly outcome: TerminalOutcome
      readonly yielded: boolean
    }
  | {
      readonly type: "root"
      readonly root: SessionID
      readonly direct?: { readonly outcome: TerminalOutcome; readonly yielded: boolean }
    }

export type ProofInput =
  | {
      readonly value: "proven_connected"
      readonly root: SessionID
      readonly active: SessionID
      readonly path: readonly SessionID[]
      readonly edges: readonly { readonly id: EdgeID; readonly owner: SessionID; readonly child: SessionID }[]
    }
  | { readonly value: "proven_disjoint"; readonly root: SessionID; readonly active: SessionID }
  | {
      readonly value: "root_anchored_incomplete"
      readonly root: SessionID
      readonly path: readonly SessionID[]
      readonly edges: readonly { readonly id: EdgeID; readonly owner: SessionID; readonly child: SessionID }[]
    }
  | { readonly value: "unanchored_unknown"; readonly root: SessionID }

export type FrozenCoordinates = {
  readonly fact: FactID
  readonly message: MessageID
  readonly part: PartID
  readonly messageEvent: EventID
  readonly partEvent: EventID
}

export type FreezeSeed = {
  readonly clockMillis: number
  readonly highWaterMillis: number
  readonly coordinates: readonly FrozenCoordinates[]
}

export type PlanningCapture = {
  readonly operation: OperationID
  readonly revision: bigint
  readonly aliases: readonly OperationID[]
  readonly claims: readonly SessionID[]
  readonly participants: readonly { readonly id: ParticipantID; readonly revision: bigint }[]
  readonly leases: readonly LeaseID[]
  readonly mutations: readonly MutationID[]
  readonly facts: readonly FactID[]
  readonly successors: readonly FactID[]
  readonly quiescenceRevision: bigint
}

export type ScanCapture = {
  readonly operation: OperationID
  readonly revision: bigint
  readonly claims: readonly SessionID[]
  readonly edges: readonly EdgeID[]
  readonly participants: readonly { readonly id: ParticipantID; readonly revision: bigint }[]
  readonly leases: readonly LeaseID[]
  readonly mutations: readonly MutationID[]
  readonly effects: readonly EffectID[]
  readonly successors: readonly FactID[]
}

export type PlanRead = {
  readonly type: "plan.read"
  readonly operation: OperationID
  readonly repair: RepairID
  readonly revision: bigint
  readonly capture: PlanningCapture
  readonly targets: readonly SessionID[]
}

export type PairCandidate = {
  readonly type: "pair.candidate"
  readonly operation: OperationID
  readonly repair: RepairID
  readonly revision: bigint
  readonly freezeOwner: OperationID
  readonly generation: number
  readonly fact: FactID
  readonly expectedPrefix: number
}

export type ReleaseCheck = {
  readonly type: "release.verify"
  readonly operation: OperationID
  readonly repair: RepairID
  readonly revision: bigint
  readonly claims: readonly SessionID[]
  readonly aliases: readonly OperationID[]
  readonly generations: readonly { readonly freezeOwner: OperationID; readonly generation: number }[]
  readonly facts: readonly FactID[]
  readonly views: readonly ViewID[]
}

export type CommandData =
  | {
      readonly type: "ticket.offer"
      readonly ticket: TicketID
      readonly operation: OperationID
      readonly repair: RepairID
      readonly revision: bigint
    }
  | {
      readonly type: "worker.register"
      readonly ticket: TicketID
      readonly operation: OperationID
      readonly repair: RepairID
      readonly revision: bigint
    }
  | {
      readonly type: "worker.open"
      readonly ticket: TicketID
      readonly worker: WorkerID
      readonly operation: OperationID
      readonly repair: RepairID
      readonly revision: bigint
    }
  | {
      readonly type: "driver.run"
      readonly worker: WorkerID
      readonly operation: OperationID
      readonly repair: RepairID
      readonly revision: bigint
    }
  | {
      readonly type: "waiter.deliver"
      readonly operation: OperationID
      readonly revision: bigint
      readonly failure?: FailureKind
      readonly waiters: readonly WaiterID[]
    }
  | PlanRead
  | PairCandidate
  | {
      readonly type: "pair.write"
      readonly permit: PairID
      readonly candidate: PairCandidate
    }
  | ReleaseCheck
  | {
      readonly type: "effect.run"
      readonly permit: EffectID
      readonly operation: OperationID
      readonly repair: RepairID
      readonly revision: bigint
      readonly effect: "signal" | "participant" | "plan_read" | "record_readback" | "release_verify"
    }
  | {
      readonly type: "job.bind"
      readonly request: RequestID
      readonly job: JobID
      readonly lifetime: LifetimeID
      readonly sequence: bigint
      readonly lease: LeaseID
      readonly epoch: bigint
      readonly admissionRevision: bigint
      readonly operationRevision?: bigint
    }
  | {
      readonly type: "job.register"
      readonly job: JobID
      readonly lifetime: LifetimeID
      readonly sequence: bigint
      readonly permit: ArmID
    }
  | {
      readonly type: "job.run"
      readonly job: JobID
      readonly lifetime: LifetimeID
      readonly sequence: bigint
    }
  | { readonly type: "job.close"; readonly job: JobID; readonly lifetime: LifetimeID; readonly scope: ScopeID }
  | { readonly type: "job.cleanup"; readonly job: JobID; readonly lifetime: LifetimeID }

export type Command = Scoped<CommandData>

export type Decision =
  | { readonly type: "applied" }
  | { readonly type: "joined"; readonly operation?: OperationID; readonly repair?: RepairID }
  | { readonly type: "noop"; readonly reason: "stale" | "duplicate" | "settled" | "disjoint" }
  | {
      readonly type: "rejected"
      readonly reason:
        | "wrong_instance"
        | "fenced"
        | "stale_epoch"
        | "stale_revision"
        | "stale_token"
        | "stale_sequence"
        | "invalid_phase"
        | "invalid_transition"
        | "missing_identity"
        | "unverified"
    }

export type Step = {
  readonly state: State
  readonly decision: Decision
  readonly commands: readonly Command[]
}

export type AdmissionOwner =
  | { readonly type: "scope"; readonly id: ScopeID }
  | { readonly type: "worker"; readonly id: WorkerID }
  | { readonly type: "job"; readonly job: JobID; readonly lifetime: LifetimeID; readonly sequence: bigint }
  | { readonly type: "participant"; readonly id: ParticipantID }

export type LeaseBase = {
  readonly id: LeaseID
  readonly session: SessionID
  readonly epoch: bigint
  readonly source: string
  readonly origin: "external" | "internal"
  readonly retry: "initial" | "post_closure_external_retry"
  readonly caller?: SessionID
  readonly target?: SessionID
}

export type LeaseInput = LeaseBase &
  (
    | {
        readonly kind: "ordinary"
        readonly owner?: AdmissionOwner
      }
    | { readonly kind: "pre_bind"; readonly owner: Extract<AdmissionOwner, { readonly type: "scope" }> }
    | {
        readonly kind: "continuation"
        readonly owner: Exclude<AdmissionOwner, { readonly type: "job" }>
        readonly caller: SessionID
        readonly target: SessionID
        readonly originEpoch: bigint
        readonly invocation?: { readonly job: JobID; readonly lifetime: LifetimeID; readonly sequence: bigint }
      }
  )

export type MutationInput = {
  readonly id: MutationID
  readonly sessions: readonly SessionID[]
  readonly epochs: readonly { readonly session: SessionID; readonly epoch: bigint }[]
  readonly kind:
    | "revert"
    | "unrevert"
    | "remove_session"
    | "remove_message"
    | "remove_part"
    | "replace_part"
    | "revert_cleanup"
    // One lease covers a replay batch so a fence cannot leave only a prefix projected.
    | "replay"
}

export type Action =
  | {
      readonly type: "request"
      readonly instance: InstanceID
      readonly root: SessionID
      readonly operation: OperationID
      readonly view: ViewID
      readonly waiter: WaiterID
      readonly ticket: TicketID
      readonly repair: RepairID
    }
  | { readonly type: "waiter.interrupt"; readonly waiter: WaiterID }
  | { readonly type: "ticket.received"; readonly offer: Extract<Command, { readonly type: "ticket.offer" }> }
  | { readonly type: "ticket.dequeued"; readonly offer: Extract<Command, { readonly type: "ticket.offer" }> }
  | { readonly type: "ticket.accept"; readonly offer: Extract<Command, { readonly type: "ticket.offer" }> }
  | {
      readonly type: "ticket.offer_failed"
      readonly offer: Extract<Command, { readonly type: "ticket.offer" }>
    }
  | {
      readonly type: "worker.registered"
      readonly registration: Extract<Command, { readonly type: "worker.register" }>
      readonly worker: WorkerID
    }
  | {
      readonly type: "worker.registration_failed"
      readonly registration: Extract<Command, { readonly type: "worker.register" }>
    }
  | { readonly type: "worker.started"; readonly opening: Extract<Command, { readonly type: "worker.open" }> }
  | { readonly type: "supervisor.failed" }
  | {
      readonly type: "worker.exited"
      readonly operation: OperationID
      readonly ticket: TicketID
      readonly worker: WorkerID
      readonly repair: RepairID
      readonly revision: bigint
      readonly disposal: boolean
    }
  | {
      readonly type: "operation.claim"
      readonly operation: OperationID
      readonly repair: RepairID
      readonly revision: bigint
      readonly proofs: readonly ProofInput[]
      readonly signals: readonly EffectID[]
    }
  | { readonly type: "operation.merge"; readonly left: OperationID; readonly right: OperationID }
  | {
      readonly type: "participant.observe"
      readonly operation: OperationID
      readonly participant: ParticipantID
      readonly revision: bigint
    }
  | {
      readonly type: "view.require"
      readonly operation: OperationID
      readonly view: ViewID
      readonly nodes: readonly SessionID[]
      readonly facts: readonly FactInput[]
    }
  | { readonly type: "operation.advance"; readonly operation: OperationID; readonly to: Phase }
  | { readonly type: "lease.reserve"; readonly lease: LeaseInput }
  | {
      /** Revalidates an existing continuation lease and epoch without creating or binding one. */
      readonly type: "lease.reuse"
      readonly lease: LeaseID
      readonly session: SessionID
      readonly epoch: bigint
    }
  | {
      readonly type: "lease.bind"
      readonly lease: LeaseID
      readonly owner: AdmissionOwner
    }
  | {
      readonly type: "lease.finish"
      readonly lease: LeaseID
      readonly state: "retired" | "suppressed" | "failed"
    }
  | { readonly type: "mutation.reserve"; readonly mutation: MutationInput }
  | { readonly type: "mutation.activate"; readonly mutation: MutationID }
  | { readonly type: "mutation.retire"; readonly mutation: MutationID }
  | {
      readonly type: "effect.issue"
      readonly permit: EffectID
      readonly operation: OperationID
      readonly repair: RepairID
      readonly revision: bigint
      readonly effect: "signal" | "participant" | "plan_read" | "record_readback" | "release_verify"
    }
  | {
      readonly type: "effect.dispatch"
      readonly command: Extract<Command, { readonly type: "effect.run" }>
    }
  | {
      readonly type: "effect.return"
      readonly command: Extract<Command, { readonly type: "effect.run" }>
      readonly result: "success" | "failure"
    }
  | {
      readonly type: "quiescence.prove"
      readonly operation: OperationID
      readonly prior: ScanCapture
      readonly current: ScanCapture
    }
  | { readonly type: "planning.begin"; readonly operation: OperationID }
  | {
      readonly type: "planning.return"
      readonly read: Extract<Command, { readonly type: "plan.read" }>
      readonly identities: readonly { readonly session: SessionID; readonly identity?: Identity }[]
      readonly seed?: FreezeSeed
    }
  | { readonly type: "writer.next"; readonly operation: OperationID }
  | {
      readonly type: "pair.issue"
      readonly candidate: Extract<Command, { readonly type: "pair.candidate" }>
      readonly permit: PairID
    }
  | {
      readonly type: "pair.return"
      readonly write: Extract<Command, { readonly type: "pair.write" }>
      readonly message: "verified" | "failed"
      readonly part: "verified" | "absent" | "failed"
    }
  | {
      readonly type: "operation.fail"
      readonly operation: OperationID
      readonly repair: RepairID
      readonly revision: bigint
      readonly failure: FailureKind
    }
  | { readonly type: "release.prepare"; readonly operation: OperationID }
  | {
      readonly type: "release.commit"
      readonly check: Extract<Command, { readonly type: "release.verify" }>
    }
  | {
      readonly type: "waiter.delivered"
      readonly delivery: Extract<Command, { readonly type: "waiter.deliver" }>
      readonly waiter: WaiterID
    }
  | { readonly type: "cleanup"; readonly operation: OperationID; readonly revision: bigint }
  | { readonly type: "cleanup"; readonly lease: LeaseID }
  | { readonly type: "cleanup"; readonly permit: ArmID }
  | { readonly type: "cleanup"; readonly job: JobID; readonly lifetime: LifetimeID }
  | { readonly type: "dispose" }
  | {
      readonly type: "job.start"
      readonly request: RequestID
      readonly job: JobID
      readonly lifetime: LifetimeID
      readonly scope: ScopeID
      readonly lease: LeaseID
      readonly epoch: bigint
      readonly admissionRevision: bigint
      readonly operationRevision?: bigint
    }
  | {
      readonly type: "job.extend"
      readonly request: RequestID
      readonly job: JobID
      readonly lifetime: LifetimeID
      readonly lease: LeaseID
      readonly epoch: bigint
      readonly admissionRevision: bigint
      readonly operationRevision?: bigint
    }
  | {
      readonly type: "job.bind"
      readonly binding: Extract<Command, { readonly type: "job.bind" }>
      readonly decision:
        | { readonly type: "arm_allowed"; readonly permit: ArmID }
        | { readonly type: "cancellation_owned" }
        | { readonly type: "rejected" }
    }
  | {
      readonly type: "job.permit"
      readonly permit: ArmID
      readonly action: "consume" | "revoke"
    }
  | {
      readonly type: "job.registered"
      readonly registration: Extract<Command, { readonly type: "job.register" }>
    }
  | { readonly type: "job.binder_failed"; readonly job: JobID; readonly lifetime: LifetimeID }
  | { readonly type: "job.get"; readonly job: JobID; readonly lifetime: LifetimeID }
  | { readonly type: "job.promote"; readonly job: JobID; readonly lifetime: LifetimeID }
  | { readonly type: "job.wait_promotion"; readonly job: JobID; readonly lifetime: LifetimeID }
  | { readonly type: "job.wait"; readonly job: JobID; readonly lifetime: LifetimeID }
  | {
      readonly type: "job.observe"
      readonly job: JobID
      readonly lifetime: LifetimeID
      readonly sequence: bigint
    }
  | {
      readonly type: "job.deliver"
      readonly job: JobID
      readonly lifetime: LifetimeID
      readonly sequence: bigint
      readonly scope: ScopeID
    }
  | {
      readonly type: "job.cancel"
      readonly job: JobID
      readonly lifetime: LifetimeID
      readonly sequence?: bigint
    }
  | {
      readonly type: "job.terminal"
      readonly job: JobID
      readonly lifetime: LifetimeID
      readonly winner: "cancelled" | "completed" | "error"
    }

export type Event = Scoped<Action>

export type View = {
  readonly instance: InstanceID
  readonly authorityRevision: bigint
  readonly sequences: { readonly creation: bigint; readonly repair: bigint; readonly freeze: bigint }
  readonly supervisor: { readonly state: "running" | "disposing" | "disposed" | "failed" }
  readonly queue: readonly TicketID[]
  readonly tickets: readonly TicketView[]
  readonly operations: readonly OperationView[]
  readonly aliases: readonly { readonly alias: OperationID; readonly canonical: OperationID }[]
  readonly claims: readonly { readonly session: SessionID; readonly operation: OperationID }[]
  readonly epochs: readonly { readonly session: SessionID; readonly epoch: bigint }[]
  readonly fences: readonly FenceView[]
  readonly leases: readonly LeaseView[]
  readonly mutations: readonly MutationView[]
  readonly effects: readonly EffectView[]
  readonly pairs: readonly PairView[]
  readonly jobs: readonly JobView[]
  readonly armPermits: readonly ArmPermitView[]
}

export type TicketView = {
  readonly id: TicketID
  readonly operation: OperationID
  readonly repair: RepairID
  readonly revision: bigint
  readonly state: "reserved" | "enqueued" | "consumed" | "failed" | "cleared"
  readonly offer: "pending" | "received" | "failed"
  readonly dequeued: boolean
  readonly acceptance: "pending" | "accepted" | "failed"
  readonly start: "pending" | "opened" | "failed"
}

export type FenceView = {
  readonly session: SessionID
  readonly epoch: bigint
  readonly operation: OperationID
  readonly state: FenceState
}

export type WaiterView = {
  readonly id: WaiterID
  readonly view: ViewID
  readonly state: "provisional" | "attached" | "delivery_reserved" | "detached" | "settled"
  readonly deliveryRevision?: bigint
}

export type RootView = {
  readonly id: ViewID
  readonly root: SessionID
  readonly nodes: readonly SessionID[]
  readonly facts: readonly FactID[]
  readonly result: "pending" | "success" | "failure"
  readonly failureRevision?: bigint
}

export type FactView = FactInput & { readonly id: FactID; readonly key: string }

export type RecordMetadata = {
  readonly version: 1
  readonly freeze_owner_operation_id: OperationID
  readonly generation: number
  readonly fact_key: string
  readonly identity_source: Identity["source"]
  readonly source_user_message_id?: MessageID
} & (
  | {
      readonly record_kind: "self"
      readonly subject_session_id: SessionID
      readonly terminal_outcome: TerminalOutcome
      readonly state_at_fence?: "yielded_with_outstanding_work"
    }
  | {
      readonly record_kind: "edge"
      readonly subject_session_id: SessionID
      readonly owner_session_id: SessionID
      readonly child_session_id: SessionID
      readonly task_part_id?: PartID
      readonly terminal_outcome: TerminalOutcome
      readonly state_at_fence?: "yielded_with_outstanding_work"
    }
  | {
      readonly record_kind: "root"
      readonly requested_root_session_id: SessionID
      readonly subject_session_id: SessionID
      readonly branch_outcome: "quiesced"
      readonly terminal_outcome?: TerminalOutcome
      readonly state_at_fence?: "yielded_with_outstanding_work"
    }
)

export type FrozenPair = {
  readonly fact: FactView
  readonly freezeOwner: OperationID
  readonly generation: number
  readonly identity: Identity
  readonly message: MessageID
  readonly part: PartID
  readonly messageEvent: EventID
  readonly partEvent: EventID
  readonly messageTime: number
  readonly partTime: number
  readonly synthetic: true
  readonly text: string
  readonly metadata: RecordMetadata
  readonly messageBytes: string
  readonly partBytes: string
}

export type GenerationView = {
  readonly freezeOwner: OperationID
  readonly generation: number
  readonly freezeSequence: bigint
  readonly freezeRevision: bigint
  readonly facts: readonly FactID[]
  readonly records: readonly FrozenPair[]
  readonly committedPrefix: number
  readonly inFlight: readonly PairID[]
  readonly verified: readonly FactID[]
  readonly failure?: FailureKind
}

export type OperationView = {
  readonly id: OperationID
  readonly creationSequence: bigint
  readonly revision: bigint
  readonly phase: Phase
  readonly driver: Driver
  readonly repair?: RepairID
  readonly claims: readonly SessionID[]
  readonly edges: readonly { readonly id: EdgeID; readonly owner: SessionID; readonly child: SessionID }[]
  readonly views: readonly RootView[]
  readonly waiters: readonly WaiterView[]
  readonly executionLeases: readonly LeaseID[]
  readonly mutationLeases: readonly MutationID[]
  readonly participants: readonly { readonly id: ParticipantID; readonly revision: bigint }[]
  readonly aliases: readonly OperationID[]
  readonly facts: readonly FactView[]
  readonly successors: readonly FactView[]
  readonly generations: readonly GenerationView[]
  readonly planning?: PlanningCapture
  readonly delivery?: { readonly revision: bigint; readonly waiters: readonly WaiterID[] }
  readonly failure?: { readonly kind: FailureKind; readonly revision: bigint; readonly repair: RepairID }
}

export type LeaseView = LeaseInput & {
  readonly state: "reserved" | "bound" | "retired" | "suppressed" | "failed"
  readonly operation?: OperationID
  /**
   * Model-observed acquisition side. Callers cannot safely supply it, and adoption makes pre- and
   * post-fence external leases otherwise indistinguishable when `blockers` runs.
   */
  readonly acquisition: "pre_fence" | "post_fence"
}

export type MutationView = MutationInput & {
  readonly state: "reserved" | "active" | "retired"
  readonly operation?: OperationID
}

export type EffectView = {
  readonly id: EffectID
  readonly operation: OperationID
  readonly repair: RepairID
  readonly revision: bigint
  readonly effect: "signal" | "participant" | "plan_read" | "record_readback" | "release_verify"
  readonly state: "issued" | "in_flight" | "returned" | "revoked"
}

export type PairView = {
  readonly id: PairID
  readonly operation: OperationID
  readonly freezeOwner: OperationID
  readonly generation: number
  readonly fact: FactID
  readonly expectedPrefix: number
  readonly repair: RepairID
  readonly revision: bigint
  readonly state: "in_flight" | "returned" | "imported" | "failed"
}

export type ArmPermitView = {
  readonly id: ArmID
  readonly job: JobID
  readonly lifetime: LifetimeID
  readonly sequence: bigint
  readonly epoch: bigint
  readonly lease: LeaseID
  readonly admissionRevision: bigint
  readonly operationRevision?: bigint
  readonly state: "issued" | "consumed" | "revoked"
}

export type JobView = {
  readonly id: JobID
  readonly lifetime: LifetimeID
  readonly scope: ScopeID
  readonly state: "registered_unarmed" | "binding" | "armed" | "terminal"
  readonly armAttempt: "pending" | "armed" | "terminal"
  readonly accepted: readonly bigint[]
  readonly nextSequence: bigint
  readonly starts: readonly { readonly request: RequestID; readonly state: "owner" | "joined" | "settled" }[]
  readonly extensions: readonly {
    readonly request: RequestID
    readonly state: "waiting_for_arm" | "binding" | "accepted" | "rejected" | "settled"
    readonly sequence?: bigint
  }[]
  readonly promoted: boolean
  readonly observed: readonly bigint[]
  readonly delivered: readonly { readonly sequence: bigint; readonly scope: ScopeID }[]
  readonly winner?: "cancelled" | "completed" | "error"
}

type Proof = {
  readonly revision: bigint
  readonly capture: ScanCapture
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

type Operation = Mutable<OperationView> & {
  proof?: Proof
}

type Binding = Extract<Command, { readonly type: "job.bind" }>

type Model = Omit<Mutable<View>, "operations"> & {
  operations: Operation[]
  sessions: SessionID[]
  bindings: Binding[]
}

type Result = {
  readonly decision: Decision
  readonly commands?: readonly Command[]
  readonly authority?: boolean
}

function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => copy(item)) as unknown as T
  if (!value || typeof value !== "object") return value
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  Object.keys(source).forEach((key) => {
    result[key] = copy(source[key])
  })
  return result as T
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function encode(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (typeof value === "bigint") return `bigint:${value}`
  if (typeof value === "string") return `string:${JSON.stringify(value)}`
  if (typeof value === "number") return `number:${value}`
  if (typeof value === "boolean") return `boolean:${value}`
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`
  if (typeof value !== "object") return `${typeof value}:${String(value)}`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .toSorted(compare)
    .map((key) => `${JSON.stringify(key)}:${encode(object[key])}`)
    .join(",")}}`
}

function same(left: unknown, right: unknown) {
  return encode(left) === encode(right)
}

function unique<T extends string>(values: readonly T[]) {
  return [...new Set(values)].toSorted(compare)
}

function model(state: State): Model {
  return state as unknown as Model
}

function state(value: Model): State {
  return value as unknown as State
}

function operation(value: Model, operationID: OperationID) {
  const canonical = resolve(value, operationID)
  return value.operations.find((item) => item.id === canonical)
}

function resolve(value: Model, operationID: OperationID): OperationID {
  const alias = value.aliases.find((item) => item.alias === operationID)
  if (!alias || alias.canonical === operationID) return operationID
  return resolve(value, alias.canonical)
}

function epoch(value: Model, session: SessionID) {
  return value.epochs.find((item) => item.session === session)?.epoch ?? 0n
}

function repair(value: Operation) {
  if (value.driver.state !== "none") return value.driver.repair
  return value.repair
}

function normalize(value: Model) {
  value.sessions = unique(value.sessions)
  value.queue = unique(value.queue)
  value.tickets = value.tickets.toSorted((left, right) => compare(left.id, right.id))
  value.aliases = value.aliases.toSorted((left, right) => compare(left.alias, right.alias))
  value.claims = value.claims.toSorted((left, right) => compare(left.session, right.session))
  value.epochs = value.epochs.toSorted((left, right) => compare(left.session, right.session))
  value.fences = value.fences.toSorted((left, right) => compare(left.session, right.session))
  value.leases = value.leases.toSorted((left, right) => compare(left.id, right.id))
  value.mutations = value.mutations.toSorted((left, right) => compare(left.id, right.id))
  value.effects = value.effects.toSorted((left, right) => compare(left.id, right.id))
  value.pairs = value.pairs.toSorted((left, right) => compare(left.id, right.id))
  value.jobs = value.jobs
    .map((item) => ({
      ...item,
      accepted: [...item.accepted].toSorted((left, right) => Number(left - right)),
      starts: [...item.starts].toSorted((left, right) => compare(left.request, right.request)),
      extensions: [...item.extensions].toSorted((left, right) => compare(left.request, right.request)),
      observed: [...item.observed].toSorted((left, right) => Number(left - right)),
      delivered: [...item.delivered].toSorted((left, right) => {
        const sequence = Number(left.sequence - right.sequence)
        return sequence === 0 ? compare(left.scope, right.scope) : sequence
      }),
    }))
    .toSorted((left, right) => compare(left.id, right.id))
  value.armPermits = value.armPermits.toSorted((left, right) => compare(left.id, right.id))
  value.bindings = value.bindings.toSorted((left, right) => {
    const job = compare(left.job, right.job)
    if (job !== 0) return job
    return Number(left.sequence - right.sequence)
  })
  value.operations = value.operations
    .map((item) => ({
      ...item,
      claims: unique(item.claims),
      edges: [...item.edges].toSorted((left, right) => compare(left.id, right.id)),
      views: [...item.views]
        .map((entry) => ({ ...entry, nodes: unique(entry.nodes), facts: unique(entry.facts) }))
        .toSorted((left, right) => compare(left.id, right.id)),
      waiters: [...item.waiters].toSorted((left, right) => compare(left.id, right.id)),
      executionLeases: unique(item.executionLeases),
      mutationLeases: unique(item.mutationLeases),
      participants: [...item.participants].toSorted((left, right) => compare(left.id, right.id)),
      aliases: unique(item.aliases),
      facts: sortfacts(item.facts),
      successors: sortfacts(item.successors),
      generations: [...item.generations]
        .map((entry) => ({
          ...entry,
          facts: [...entry.facts],
          records: [...entry.records],
          inFlight: unique(entry.inFlight),
          verified: [...entry.verified],
        }))
        .toSorted((left, right) => {
          const generation = left.generation - right.generation
          return generation === 0 ? compare(left.freezeOwner, right.freezeOwner) : generation
        }),
    }))
    .toSorted((left, right) => compare(left.id, right.id))
}

function project(value: Model): View {
  normalize(value)
  return {
    instance: value.instance,
    authorityRevision: value.authorityRevision,
    sequences: copy(value.sequences),
    supervisor: copy(value.supervisor),
    queue: copy(value.queue),
    tickets: copy(value.tickets),
    operations: value.operations.map((item) => {
      const result: OperationView = {
        id: item.id,
        creationSequence: item.creationSequence,
        revision: item.revision,
        phase: copy(item.phase),
        driver: copy(item.driver),
        repair: item.repair,
        claims: copy(item.claims),
        edges: copy(item.edges),
        views: copy(item.views),
        waiters: copy(item.waiters),
        executionLeases: copy(item.executionLeases),
        mutationLeases: copy(item.mutationLeases),
        participants: copy(item.participants),
        aliases: copy(item.aliases),
        facts: copy(item.facts),
        successors: copy(item.successors),
        generations: copy(item.generations),
        planning: item.planning ? copy(item.planning) : undefined,
        delivery: item.delivery ? copy(item.delivery) : undefined,
        failure: item.failure ? copy(item.failure) : undefined,
      }
      return result
    }),
    aliases: copy(value.aliases),
    claims: copy(value.claims),
    epochs: copy(value.epochs),
    fences: copy(value.fences),
    leases: copy(value.leases),
    mutations: copy(value.mutations),
    effects: copy(value.effects),
    pairs: copy(value.pairs),
    jobs: copy(value.jobs),
    armPermits: copy(value.armPermits),
  }
}

function output(value: Model, result: Result): Step {
  if (result.authority !== false && result.decision.type === "applied") value.authorityRevision += 1n
  normalize(value)
  return {
    state: state(value),
    decision: result.decision,
    commands: result.commands ? copy(result.commands) : [],
  }
}

function unchanged(value: Model, decision: Decision): Step {
  return { state: state(value), decision, commands: [] }
}

function command<T extends CommandData>(value: Model, data: T): Scoped<T> {
  return { ...data, instance: value.instance } as Scoped<T>
}

function segments(values: readonly string[]) {
  return values.map((value) => `${value.length}:${value}`).join("|")
}

function factshape(value: FactInput) {
  if (value.type === "self") return segments(["self", value.subject])
  if (value.type === "edge" && value.taskPart !== undefined && value.edge !== undefined)
    return segments(["edge", value.subject, value.owner, value.child, value.taskPart, value.edge, "task_part+edge"])
  if (value.type === "edge" && value.taskPart !== undefined)
    return segments(["edge", value.subject, value.owner, value.child, value.taskPart, "task_part"])
  if (value.type === "edge" && value.edge !== undefined)
    return segments(["edge", value.subject, value.owner, value.child, value.edge, "edge"])
  if (value.type === "edge") return segments(["edge", value.subject, value.owner, value.child, "", "none"])
  return segments(["root", value.root])
}

function factkey(operationID: OperationID, value: FactInput) {
  return segments([operationID, factshape(value)])
}

function factview(operationID: OperationID, value: FactInput): FactView {
  const key = factkey(operationID, value)
  return { ...copy(value), id: id("fact", key), key }
}

function sortfacts(values: readonly FactView[]) {
  const output: FactView[] = []
  /**
   * Deduplicate by entry identity, not fact id. Distinct entries sharing an id must reach freeze's
   * coordinate-uniqueness check instead of being silently collapsed here.
   */
  const seen = new Set<FactView>()
  const active = new Set<SessionID>()
  const edges = values
    .filter((item): item is Extract<FactView, { readonly type: "edge" }> => item.type === "edge")
    .toSorted((left, right) => {
      const child = compare(left.child, right.child)
      if (child !== 0) return child
      const coordinate = compare(left.taskPart ?? left.edge ?? left.key, right.taskPart ?? right.edge ?? right.key)
      if (coordinate !== 0) return coordinate
      /**
       * Child and preferred coordinate can still tie when edges differ. The injective fact id gives
       * a total order so retry bytes do not depend on accumulation order.
       */
      return compare(left.id, right.id)
    })
  const append = (item: FactView) => {
    if (seen.has(item)) return
    seen.add(item)
    output.push(item)
  }
  const walk = (session: SessionID) => {
    if (active.has(session)) return
    active.add(session)
    edges
      .filter((item) => item.owner === session)
      .forEach((item) => {
        walk(item.child)
        append(item)
      })
    values
      .filter(
        (item): item is Extract<FactView, { readonly type: "self" }> =>
          item.type === "self" && item.subject === session,
      )
      .toSorted((left, right) => compare(left.key, right.key))
      .forEach(append)
    active.delete(session)
  }
  const roots = values
    .filter((item): item is Extract<FactView, { readonly type: "root" }> => item.type === "root")
    .toSorted((left, right) => compare(left.root, right.root))
  roots.forEach((item) => {
    walk(item.root)
    append(item)
  })
  const children = new Set(edges.map((item) => item.child))
  unique(edges.map((item) => item.owner).filter((item) => !children.has(item))).forEach(walk)
  values.toSorted((left, right) => compare(left.key, right.key)).forEach(append)
  return output
}

function fencephase(phase: Phase): FenceState | undefined {
  if (phase.type === "driver_starting" || phase.type === "claiming" || phase.type === "fencing") return "closing"
  if (phase.type === "quiescing") return "closing"
  if (phase.type === "planning") return "planning"
  if (phase.type === "freezing") return "freezing"
  if (phase.type === "recording") return "recording"
  if (phase.type === "planning_failed_identity_missing") return "planning_failed_identity_missing"
  if (phase.type === "quiescence_failed") return "quiescence_failed"
  if (phase.type === "record_failed") return "record_failed"
  if (phase.type === "closure_unavailable") return "closure_unavailable"
  if (phase.type === "released_pending_delivery" || phase.type === "complete") return undefined
  const exhaustive: never = phase
  return exhaustive
}

function updatefences(value: Model, current: Operation) {
  const phase = fencephase(current.phase)
  if (!phase) return
  value.fences = value.fences.map((item) =>
    resolve(value, item.operation) === current.id ? { ...item, operation: current.id, state: phase } : item,
  )
}

function capture(value: Model, current: Operation): PlanningCapture {
  return {
    operation: current.id,
    revision: current.revision,
    aliases: unique(current.aliases),
    claims: unique(current.claims),
    participants: [...current.participants].toSorted((left, right) => compare(left.id, right.id)),
    leases: unique(current.executionLeases),
    mutations: unique(current.mutationLeases),
    facts: sortfacts(current.facts).map((item) => item.id),
    successors: sortfacts(current.successors).map((item) => item.id),
    quiescenceRevision: current.proof?.revision ?? 0n,
  }
}

function scancapture(value: Model, current: Operation): ScanCapture {
  return {
    operation: current.id,
    revision: current.revision,
    claims: unique(current.claims),
    edges: unique(current.edges.map((item) => item.id)),
    participants: [...current.participants].toSorted((left, right) => compare(left.id, right.id)),
    leases: unique(current.executionLeases),
    mutations: unique(current.mutationLeases),
    effects: unique(
      value.effects.filter((item) => resolve(value, item.operation) === current.id).map((item) => item.id),
    ),
    successors: sortfacts(current.successors).map((item) => item.id),
  }
}

function transition(value: Model, decision: Decision, commands: readonly Command[] = [], authority = true) {
  return output(value, { decision, commands, authority })
}

function touch(value: Operation) {
  value.revision += 1n
  value.proof = undefined
}

function ticket(value: Model, ticketID: TicketID) {
  return value.tickets.find((item) => item.id === ticketID)
}

function lease(value: Model, leaseID: LeaseID) {
  return value.leases.find((item) => item.id === leaseID)
}

function mutation(value: Model, mutationID: MutationID) {
  return value.mutations.find((item) => item.id === mutationID)
}

function effect(value: Model, effectID: EffectID) {
  return value.effects.find((item) => item.id === effectID)
}

function pair(value: Model, pairID: PairID) {
  return value.pairs.find((item) => item.id === pairID)
}

function job(value: Model, jobID: JobID) {
  return value.jobs.find((item) => item.id === jobID)
}

function arm(value: Model, armID: ArmID) {
  return value.armPermits.find((item) => item.id === armID)
}

function replaceOperation(value: Model, current: Operation) {
  value.operations = value.operations.map((item) => (item.id === current.id ? current : item))
}

function replaceTicket(value: Model, current: TicketView) {
  value.tickets = value.tickets.map((item) => (item.id === current.id ? current : item))
}

function replaceLease(value: Model, current: LeaseView) {
  value.leases = value.leases.map((item) => (item.id === current.id ? current : item))
}

function replaceMutation(value: Model, current: MutationView) {
  value.mutations = value.mutations.map((item) => (item.id === current.id ? current : item))
}

function replaceEffect(value: Model, current: EffectView) {
  value.effects = value.effects.map((item) => (item.id === current.id ? current : item))
}

function replacePair(value: Model, current: PairView) {
  value.pairs = value.pairs.map((item) => (item.id === current.id ? current : item))
}

function replaceJob(value: Model, current: JobView) {
  value.jobs = value.jobs.map((item) => (item.id === current.id ? current : item))
}

function replaceArm(value: Model, current: ArmPermitView) {
  value.armPermits = value.armPermits.map((item) => (item.id === current.id ? current : item))
}

function offer(value: Model, current: Operation, currentTicket: TicketView) {
  return command(value, {
    type: "ticket.offer",
    ticket: currentTicket.id,
    operation: current.id,
    repair: currentTicket.repair,
    revision: currentTicket.revision,
  })
}

function registration(value: Model, current: TicketView) {
  return command(value, {
    type: "worker.register",
    ticket: current.id,
    operation: current.operation,
    repair: current.repair,
    revision: current.revision,
  })
}

function delivery(value: Model, current: Operation, failure?: FailureKind) {
  const waiters = current.waiters
    .filter((item) => item.state === "attached" || item.state === "provisional")
    .map((item) => item.id)
    .toSorted(compare)
  if (waiters.length === 0) return []
  const revision = current.revision
  current.waiters = current.waiters.map((item) =>
    waiters.includes(item.id) ? { ...item, state: "delivery_reserved", deliveryRevision: revision } : item,
  )
  current.delivery = { revision, waiters }
  return [command(value, { type: "waiter.deliver", operation: current.id, revision, failure, waiters })]
}

function fail(
  value: Model,
  current: Operation,
  kind: FailureKind,
  phase: Phase,
  attempt?: { readonly repair: RepairID; readonly ticket?: TicketID },
) {
  touch(current)
  current.phase = phase
  const repairID = attempt?.repair ?? repair(current) ?? id("repair", `${current.id}:failure:${current.revision}`)
  current.repair = repairID
  current.failure = { kind, revision: current.revision, repair: repairID }
  current.driver = {
    state: "failed",
    operation: current.id,
    repair: repairID,
    revision: current.revision,
    failureRevision: current.revision,
  }
  current.views = current.views.map((item) => ({ ...item, result: "failure", failureRevision: current.revision }))
  value.effects = value.effects.map((item) => {
    if (resolve(value, item.operation) !== current.id || item.repair !== repairID || item.state !== "issued")
      return item
    return { ...item, state: "revoked" }
  })
  if (attempt?.ticket) {
    const currentTicket = ticket(value, attempt.ticket)
    if (currentTicket)
      replaceTicket(value, {
        ...currentTicket,
        state: "failed",
        acceptance: "failed",
        start: "failed",
        offer: currentTicket.offer === "pending" ? "failed" : currentTicket.offer,
      })
    value.queue = value.queue.filter((item) => item !== attempt.ticket)
  }
  const commands = delivery(value, current, kind)
  replaceOperation(value, current)
  return commands
}

function create(value: Model, event: Extract<Event, { readonly type: "request" }>) {
  if (!value.epochs.some((item) => item.session === event.root)) {
    value.sessions = unique([...value.sessions, event.root])
    value.epochs = [...value.epochs, { session: event.root, epoch: 0n }]
  }
  value.sequences = {
    ...value.sequences,
    creation: value.sequences.creation + 1n,
    repair: value.sequences.repair + 1n,
  }
  const revision = 1n
  const current: Operation = {
    id: event.operation,
    creationSequence: value.sequences.creation,
    revision,
    phase: { type: "driver_starting" },
    driver: {
      state: "starting",
      operation: event.operation,
      ticket: event.ticket,
      repair: event.repair,
      revision,
    },
    repair: event.repair,
    claims: [],
    edges: [],
    views: [{ id: event.view, root: event.root, nodes: [event.root], facts: [], result: "pending" }],
    waiters: [{ id: event.waiter, view: event.view, state: "provisional" }],
    executionLeases: [],
    mutationLeases: [],
    participants: [],
    aliases: [],
    facts: [],
    successors: [],
    generations: [],
  }
  const currentTicket: TicketView = {
    id: event.ticket,
    operation: event.operation,
    repair: event.repair,
    revision,
    state: "reserved",
    offer: "pending",
    dequeued: false,
    acceptance: "pending",
    start: "pending",
  }
  value.operations = [...value.operations, current]
  value.tickets = [...value.tickets, currentTicket]
  if (value.supervisor.state === "running")
    return transition(value, { type: "applied" }, [offer(value, current, currentTicket)])
  const commands = fail(
    value,
    current,
    "closure_unavailable",
    { type: "closure_unavailable" },
    {
      repair: event.repair,
      ticket: event.ticket,
    },
  )
  return transition(value, { type: "applied" }, commands)
}

function request(value: Model, event: Extract<Event, { readonly type: "request" }>) {
  if (value.supervisor.state === "disposed" || value.supervisor.state === "disposing")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const existing = value.operations.find(
    (item) =>
      item.phase.type !== "released_pending_delivery" &&
      item.phase.type !== "complete" &&
      item.views.some((entry) => entry.root === event.root),
  )
  if (!existing) return create(value, event)
  if (existing.waiters.some((item) => item.id === event.waiter))
    return unchanged(value, { type: "noop", reason: "duplicate" })
  const root = existing.views.find((item) => item.root === event.root) ?? existing.views[0]
  if (!root) return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const active = existing.driver.state === "starting" || existing.driver.state === "running"
  const currentTicket = existing.driver.state === "starting" ? ticket(value, existing.driver.ticket) : undefined
  const accepted = active && (existing.driver.state === "running" || currentTicket?.acceptance === "accepted")
  existing.waiters = [
    ...existing.waiters,
    { id: event.waiter, view: root.id, state: accepted ? "attached" : "provisional" },
  ]
  if (active) {
    replaceOperation(value, existing)
    return transition(value, { type: "joined", operation: existing.id, repair: repair(existing) })
  }
  touch(existing)
  existing.repair = event.repair
  existing.driver = {
    state: "starting",
    operation: existing.id,
    ticket: event.ticket,
    repair: event.repair,
    revision: existing.revision,
  }
  if (existing.phase.type === "closure_unavailable") existing.phase = { type: "driver_starting" }
  const nextTicket: TicketView = {
    id: event.ticket,
    operation: existing.id,
    repair: event.repair,
    revision: existing.revision,
    state: "reserved",
    offer: "pending",
    dequeued: false,
    acceptance: "pending",
    start: "pending",
  }
  value.tickets = [...value.tickets, nextTicket]
  replaceOperation(value, existing)
  return transition(value, { type: "joined", operation: existing.id, repair: event.repair }, [
    offer(value, existing, nextTicket),
  ])
}

function exactOffer(value: Model, current: TicketView, offer: Extract<Command, { readonly type: "ticket.offer" }>) {
  return same(
    offer,
    command(value, {
      type: "ticket.offer",
      ticket: current.id,
      operation: current.operation,
      repair: current.repair,
      revision: current.revision,
    }),
  )
}

function received(value: Model, event: Extract<Event, { readonly type: "ticket.received" }>) {
  const current = ticket(value, event.offer.ticket)
  if (!current || !exactOffer(value, current, event.offer)) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.offer === "received") return unchanged(value, { type: "noop", reason: "duplicate" })
  if (current.offer === "failed" || current.state === "failed" || current.state === "cleared")
    return unchanged(value, { type: "noop", reason: "stale" })
  replaceTicket(value, { ...current, offer: "received" })
  value.queue = unique([...value.queue, current.id])
  return transition(value, { type: "applied" })
}

function registerIfReady(value: Model, current: TicketView) {
  if (!current.dequeued || current.acceptance !== "accepted" || current.state !== "enqueued") return []
  return [registration(value, current)]
}

function dequeued(value: Model, event: Extract<Event, { readonly type: "ticket.dequeued" }>) {
  const current = ticket(value, event.offer.ticket)
  if (!current || !exactOffer(value, current, event.offer) || current.state === "failed" || current.state === "cleared")
    return unchanged(value, { type: "noop", reason: "stale" })
  if (current.offer !== "received") return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (current.dequeued) return unchanged(value, { type: "noop", reason: "duplicate" })
  const next = { ...current, dequeued: true }
  replaceTicket(value, next)
  value.queue = value.queue.filter((item) => item !== current.id)
  return transition(value, { type: "applied" }, registerIfReady(value, next))
}

function accept(value: Model, event: Extract<Event, { readonly type: "ticket.accept" }>) {
  const current = ticket(value, event.offer.ticket)
  if (!current || !exactOffer(value, current, event.offer) || current.state === "failed" || current.state === "cleared")
    return unchanged(value, { type: "noop", reason: "stale" })
  if (current.offer !== "received") return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (current.acceptance === "accepted") return unchanged(value, { type: "noop", reason: "duplicate" })
  const next: TicketView = { ...current, state: "enqueued", acceptance: "accepted" }
  replaceTicket(value, next)
  const currentOperation = operation(value, current.operation)
  if (!currentOperation) return unchanged(model(copy(state(value))), { type: "noop", reason: "stale" })
  currentOperation.waiters = currentOperation.waiters.map((item) =>
    item.state === "provisional" ? { ...item, state: "attached" } : item,
  )
  if (currentOperation.phase.type === "driver_starting") currentOperation.phase = { type: "claiming" }
  replaceOperation(value, currentOperation)
  return transition(value, { type: "applied" }, registerIfReady(value, next))
}

function offerFailed(value: Model, event: Extract<Event, { readonly type: "ticket.offer_failed" }>) {
  const current = ticket(value, event.offer.ticket)
  if (!current || !exactOffer(value, current, event.offer)) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.offer === "received") return unchanged(value, { type: "noop", reason: "stale" })
  if (current.state === "failed" || current.state === "cleared")
    return unchanged(value, { type: "noop", reason: "settled" })
  const currentOperation = operation(value, current.operation)
  if (!currentOperation) return unchanged(value, { type: "noop", reason: "stale" })
  const commands = fail(
    value,
    currentOperation,
    "closure_unavailable",
    { type: "closure_unavailable" },
    {
      repair: current.repair,
      ticket: current.id,
    },
  )
  return transition(value, { type: "applied" }, commands)
}

function stateful(value: Model, current: Operation, waiterID: WaiterID) {
  const views = current.views.some((item) => item.facts.length > 0 || item.result !== "pending")
  const fences = value.fences.some((item) => resolve(value, item.operation) === current.id)
  const effects = value.effects.some((item) => resolve(value, item.operation) === current.id)
  const waiters = current.waiters.some(
    (item) =>
      item.id !== waiterID &&
      (item.state === "provisional" || item.state === "attached" || item.state === "delivery_reserved"),
  )
  return views || fences || effects || waiters
}

function interrupt(value: Model, event: Extract<Event, { readonly type: "waiter.interrupt" }>) {
  const current = value.operations.find((item) => item.waiters.some((waiter) => waiter.id === event.waiter))
  const target = current?.waiters.find((item) => item.id === event.waiter)
  if (!current || !target) return unchanged(value, { type: "noop", reason: "stale" })
  if (target.state === "detached" || target.state === "settled")
    return unchanged(value, { type: "noop", reason: target.state === "settled" ? "settled" : "duplicate" })
  if (target.state === "delivery_reserved") return unchanged(value, { type: "noop", reason: "stale" })
  if (target.state === "attached") {
    current.waiters = current.waiters.map((item) => (item.id === event.waiter ? { ...item, state: "detached" } : item))
    replaceOperation(value, current)
    return transition(value, { type: "applied" })
  }
  const driverTicket = current.driver.state === "starting" ? ticket(value, current.driver.ticket) : undefined
  const remaining = current.waiters.filter((item) => item.id !== event.waiter && item.state === "provisional")
  if (!driverTicket || driverTicket.acceptance === "accepted" || remaining.length > 0) {
    current.waiters = current.waiters.map((item) => (item.id === event.waiter ? { ...item, state: "detached" } : item))
    replaceOperation(value, current)
    return transition(value, { type: "applied" })
  }
  replaceTicket(value, { ...driverTicket, state: "cleared", acceptance: "failed", start: "failed" })
  value.queue = value.queue.filter((item) => item !== driverTicket.id)
  if (!stateful(value, current, event.waiter)) {
    value.operations = value.operations.filter((item) => item.id !== current.id)
    return transition(value, { type: "applied" })
  }
  const retained = current.failure
  current.waiters = current.waiters.map((item) => (item.id === event.waiter ? { ...item, state: "detached" } : item))
  current.driver = retained
    ? {
        state: "failed",
        operation: current.id,
        repair: retained.repair,
        revision: retained.revision,
        failureRevision: retained.revision,
      }
    : { state: "none", operation: current.id }
  current.repair = retained?.repair ?? current.repair
  replaceOperation(value, current)
  return transition(value, { type: "applied" })
}

function workerRegistered(value: Model, event: Extract<Event, { readonly type: "worker.registered" }>) {
  const currentTicket = ticket(value, event.registration.ticket)
  if (!currentTicket) return unchanged(value, { type: "noop", reason: "stale" })
  const exact = same(event.registration, registration(value, currentTicket))
  if (!exact) return unchanged(value, { type: "noop", reason: "stale" })
  const current = operation(value, currentTicket.operation)
  if (
    currentTicket.state !== "enqueued" ||
    !currentTicket.dequeued ||
    currentTicket.acceptance !== "accepted" ||
    !current ||
    current.driver.state !== "starting" ||
    current.driver.ticket !== currentTicket.id ||
    current.driver.repair !== currentTicket.repair ||
    current.driver.revision !== currentTicket.revision
  ) {
    if (currentTicket.state === "consumed") return unchanged(value, { type: "noop", reason: "duplicate" })
    if (currentTicket.acceptance === "accepted") return unchanged(value, { type: "rejected", reason: "unverified" })
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  }
  current.driver = {
    state: "running",
    operation: current.id,
    ticket: currentTicket.id,
    worker: event.worker,
    repair: currentTicket.repair,
    revision: currentTicket.revision,
    gate: "pending",
  }
  replaceOperation(value, current)
  replaceTicket(value, { ...currentTicket, state: "consumed" })
  return transition(value, { type: "applied" }, [
    command(value, {
      type: "worker.open",
      ticket: currentTicket.id,
      worker: event.worker,
      operation: current.id,
      repair: currentTicket.repair,
      revision: currentTicket.revision,
    }),
  ])
}

function registrationFailed(value: Model, event: Extract<Event, { readonly type: "worker.registration_failed" }>) {
  const currentTicket = ticket(value, event.registration.ticket)
  if (!currentTicket) return unchanged(value, { type: "noop", reason: "stale" })
  const current = operation(value, currentTicket.operation)
  const exact = same(event.registration, registration(value, currentTicket))
  if (!exact || !current) return unchanged(value, { type: "noop", reason: "stale" })
  if (!currentTicket.dequeued || currentTicket.acceptance !== "accepted" || current.driver.state !== "starting")
    return unchanged(value, { type: "rejected", reason: "unverified" })
  const commands = fail(
    value,
    current,
    "closure_unavailable",
    { type: "closure_unavailable" },
    {
      repair: currentTicket.repair,
      ticket: currentTicket.id,
    },
  )
  return transition(value, { type: "applied" }, commands)
}

function workerStarted(value: Model, event: Extract<Event, { readonly type: "worker.started" }>) {
  const current = operation(value, event.opening.operation)
  const currentTicket = ticket(value, event.opening.ticket)
  if (!current || !currentTicket) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.driver.state !== "running") return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const exact =
    event.opening.instance === value.instance &&
    current.driver.ticket === event.opening.ticket &&
    current.driver.worker === event.opening.worker &&
    current.driver.repair === event.opening.repair &&
    current.driver.revision === event.opening.revision
  if (!exact) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.driver.gate === "opened") return unchanged(value, { type: "noop", reason: "duplicate" })
  if (current.driver.gate === "failed") return unchanged(value, { type: "noop", reason: "settled" })
  current.driver = { ...current.driver, gate: "opened" }
  replaceOperation(value, current)
  replaceTicket(value, { ...currentTicket, start: "opened" })
  return transition(value, { type: "applied" }, [
    command(value, {
      type: "driver.run",
      worker: current.driver.worker,
      operation: current.id,
      repair: current.driver.repair,
      revision: current.driver.revision,
    }),
  ])
}

function supervisorFailed(value: Model) {
  if (value.supervisor.state !== "running") return unchanged(value, { type: "noop", reason: "settled" })
  value.supervisor = { state: "failed" }
  const commands = value.operations.flatMap((current) => {
    const pending =
      current.driver.state === "starting" || (current.driver.state === "running" && current.driver.gate === "pending")
    if (!pending) return []
    const ticketID =
      current.driver.state === "starting" || current.driver.state === "running" ? current.driver.ticket : undefined
    if (!ticketID) return []
    const repairID = repair(current)
    if (!repairID) return []
    return fail(
      value,
      current,
      "closure_unavailable",
      { type: "closure_unavailable" },
      {
        repair: repairID,
        ticket: ticketID,
      },
    )
  })
  return transition(value, { type: "applied" }, commands)
}

function supervisorDisposed(value: Model) {
  if (value.supervisor.state === "disposed") return unchanged(value, { type: "noop", reason: "settled" })
  value.supervisor = { state: "disposed" }
  const commands = value.operations.flatMap((current) => {
    const pending =
      current.driver.state === "starting" || (current.driver.state === "running" && current.driver.gate === "pending")
    if (!pending) return []
    const ticketID =
      current.driver.state === "starting" || current.driver.state === "running" ? current.driver.ticket : undefined
    if (!ticketID) return []
    const repairID = repair(current)
    if (!repairID) return []
    return fail(
      value,
      current,
      "closure_unavailable",
      { type: "closure_unavailable" },
      {
        repair: repairID,
        ticket: ticketID,
      },
    )
  })
  return transition(value, { type: "applied" }, commands)
}

function workerExited(value: Model, event: Extract<Event, { readonly type: "worker.exited" }>) {
  if (event.disposal) return unchanged(value, { type: "noop", reason: "settled" })
  const current = value.operations.find((item) => item.id === event.operation)
  if (!current || current.driver.state !== "running") return unchanged(value, { type: "noop", reason: "stale" })
  const exact =
    current.driver.ticket === event.ticket &&
    current.driver.worker === event.worker &&
    current.driver.repair === event.repair &&
    current.driver.revision === event.revision
  if (!exact || current.phase.type === "released_pending_delivery" || current.phase.type === "complete")
    return unchanged(value, { type: "noop", reason: "stale" })
  /**
   * An unexpected worker exit is `closure_unavailable`. This seam cannot distinguish deliberate
   * quiescence exhaustion from a defect; the driver records deliberate failure before exiting, which
   * makes this event stale.
   */
  const commands = fail(
    value,
    current,
    "closure_unavailable",
    { type: "closure_unavailable" },
    {
      repair: event.repair,
      ticket: event.ticket,
    },
  )
  return transition(value, { type: "applied" }, commands)
}

function older(left: Operation, right: Operation) {
  if (left.creationSequence < right.creationSequence) return left
  if (left.creationSequence > right.creationSequence) return right
  return compare(left.id, right.id) <= 0 ? left : right
}

function mergefacts(left: readonly FactView[], right: readonly FactView[]) {
  const values = [...left, ...right]
  return sortfacts(
    values.filter((item, index) => values.findIndex((other) => factshape(other) === factshape(item)) === index),
  )
}

function combine(value: Model, left: Operation, right: Operation) {
  if (left.id === right.id) return left
  const winner = older(left, right)
  const loser = winner.id === left.id ? right : left
  winner.claims = unique([...winner.claims, ...loser.claims])
  winner.edges = [...winner.edges, ...loser.edges].filter(
    (item, index, values) => values.findIndex((other) => other.id === item.id) === index,
  )
  winner.views = [...winner.views, ...loser.views].filter(
    (item, index, values) => values.findIndex((other) => other.id === item.id) === index,
  )
  winner.waiters = [...winner.waiters, ...loser.waiters].filter(
    (item, index, values) => values.findIndex((other) => other.id === item.id) === index,
  )
  winner.executionLeases = unique([...winner.executionLeases, ...loser.executionLeases])
  winner.mutationLeases = unique([...winner.mutationLeases, ...loser.mutationLeases])
  winner.participants = unique([...winner.participants, ...loser.participants].map((item) => item.id)).map(
    (participantID) => ({
      id: participantID,
      revision: [...winner.participants, ...loser.participants]
        .filter((item) => item.id === participantID)
        .reduce((revision, item) => (item.revision > revision ? item.revision : revision), 0n),
    }),
  )
  winner.aliases = unique([...winner.aliases, loser.id, ...loser.aliases])
  winner.generations = [...winner.generations, ...loser.generations].filter(
    (item, index, values) =>
      values.findIndex((other) => other.freezeOwner === item.freezeOwner && other.generation === item.generation) ===
      index,
  )
  const recorded = new Set(winner.generations.flatMap((item) => item.facts))
  const merged = [...winner.facts, ...loser.facts].reduce(
    (result, item) => {
      if (result.facts.some((entry) => entry.id === item.id)) return result
      const prior = recorded.has(item.id)
        ? undefined
        : result.facts.find((entry) => factshape(entry) === factshape(item))
      if (prior) {
        result.remap.set(item.id, prior.id)
        return result
      }
      result.facts.push(item)
      return result
    },
    { facts: [] as FactView[], remap: new Map<FactID, FactID>() },
  )
  winner.facts = sortfacts(merged.facts)
  winner.views = winner.views.map((item) => ({
    ...item,
    facts: unique(item.facts.map((fact) => merged.remap.get(fact) ?? fact)),
  }))
  winner.successors = mergefacts(
    winner.successors,
    loser.successors.map((item) => {
      const target = merged.remap.get(item.id)
      if (!target) return item
      return winner.facts.find((fact) => fact.id === target) ?? item
    }),
  )
  winner.failure = winner.failure ?? loser.failure
  winner.successors = mergefacts(
    winner.successors,
    winner.facts.filter((item) => !recorded.has(item.id)),
  )
  value.aliases = [
    ...value.aliases.filter((item) => item.alias !== loser.id),
    { alias: loser.id, canonical: winner.id },
    ...loser.aliases.map((alias) => ({ alias, canonical: winner.id })),
  ]
  value.aliases = value.aliases.map((item) => (item.canonical === loser.id ? { ...item, canonical: winner.id } : item))
  value.claims = value.claims.map((item) =>
    resolve(value, item.operation) === loser.id || item.operation === loser.id
      ? { ...item, operation: winner.id }
      : item,
  )
  value.claims = value.claims.filter(
    (item, index, values) => values.findIndex((other) => other.session === item.session) === index,
  )
  value.fences = value.fences.map((item) => (item.operation === loser.id ? { ...item, operation: winner.id } : item))
  value.fences = value.fences.filter(
    (item, index, values) => values.findIndex((other) => other.session === item.session) === index,
  )
  value.leases = value.leases.map((item) => (item.operation === loser.id ? { ...item, operation: winner.id } : item))
  value.mutations = value.mutations.map((item) =>
    item.operation === loser.id ? { ...item, operation: winner.id } : item,
  )
  value.effects = value.effects.map((item) =>
    item.operation === loser.id && item.state === "issued" ? { ...item, state: "revoked" } : item,
  )
  value.tickets = value.tickets.map((item) =>
    item.operation === loser.id && item.state !== "consumed"
      ? { ...item, state: "failed", acceptance: "failed", start: "failed" }
      : item,
  )
  value.queue = value.queue.filter((ticketID) => ticket(value, ticketID)?.operation !== loser.id)
  value.operations = value.operations.filter((item) => item.id !== loser.id)
  replaceOperation(value, winner)
  return winner
}

function claim(value: Model, event: Extract<Event, { readonly type: "operation.claim" }>) {
  const direct = operation(value, event.operation)
  if (!direct || direct.id !== event.operation) return unchanged(value, { type: "noop", reason: "stale" })
  if (direct.phase.type === "driver_starting")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (repair(direct) !== event.repair || direct.revision !== event.revision)
    return unchanged(value, { type: "noop", reason: "stale" })
  const connected = event.proofs.filter(
    (item): item is Extract<ProofInput, { readonly value: "proven_connected" }> => item.value === "proven_connected",
  )
  const incomplete = event.proofs.filter(
    (item): item is Extract<ProofInput, { readonly value: "root_anchored_incomplete" }> =>
      item.value === "root_anchored_incomplete",
  )
  if (connected.length === 0 && incomplete.length === 0) return unchanged(value, { type: "noop", reason: "disjoint" })
  const active = unique(connected.map((item) => item.active).filter((item) => !direct.claims.includes(item)))
  if (event.signals.length !== active.length || unique(event.signals).length !== event.signals.length)
    return unchanged(value, { type: "rejected", reason: "unverified" })
  const nodes = unique(connected.flatMap((item) => item.path))
  const edges = connected.flatMap((item) =>
    item.edges.filter((edge) =>
      item.path.some((session, index) => session === edge.owner && item.path[index + 1] === edge.child),
    ),
  )
  direct.claims = unique([...direct.claims, ...nodes])
  direct.edges = [...direct.edges, ...edges].filter(
    (item, index, values) => values.findIndex((other) => other.id === item.id) === index,
  )
  const failureRevision = direct.revision + 1n
  direct.views = direct.views.map((item) =>
    incomplete.some((proof) => proof.root === item.root) ? { ...item, result: "failure", failureRevision } : item,
  )
  nodes.forEach((session) => {
    const existing = value.claims.find((item) => item.session === session)
    if (!existing) value.claims = [...value.claims, { session, operation: direct.id }]
    if (!value.fences.some((item) => item.session === session))
      value.fences = [
        ...value.fences,
        { session, epoch: epoch(value, session), operation: direct.id, state: "closing" },
      ]
  })
  const owners = unique(
    nodes
      .map((session) => value.claims.find((item) => item.session === session)?.operation)
      .filter((item): item is OperationID => item !== undefined),
  )
  const merged = owners.reduce((current, ownerID) => {
    const other = operation(value, ownerID)
    return other ? combine(value, current, other) : current
  }, direct)
  value.claims = value.claims.map((item) => (nodes.includes(item.session) ? { ...item, operation: merged.id } : item))
  value.fences = value.fences.map((item) => (nodes.includes(item.session) ? { ...item, operation: merged.id } : item))
  value.leases = value.leases.map((item) => {
    if (!nodes.includes(item.session) || item.operation) return item
    merged.executionLeases = unique([...merged.executionLeases, item.id])
    return { ...item, operation: merged.id }
  })
  value.mutations = value.mutations.map((item) => {
    if (!item.sessions.some((session) => nodes.includes(session)) || item.operation) return item
    merged.mutationLeases = unique([...merged.mutationLeases, item.id])
    return { ...item, operation: merged.id }
  })
  touch(merged)
  updatefences(value, merged)
  const repairID = repair(merged) ?? event.repair
  const commands = unique(event.signals).map((permit) => {
    const current: EffectView = {
      id: permit,
      operation: merged.id,
      repair: repairID,
      revision: merged.revision,
      effect: "signal",
      state: "issued",
    }
    if (!effect(value, permit)) value.effects = [...value.effects, current]
    return command(value, {
      type: "effect.run",
      permit,
      operation: merged.id,
      repair: repairID,
      revision: merged.revision,
      effect: "signal",
    })
  })
  replaceOperation(value, merged)
  return transition(value, { type: "applied" }, commands)
}

function merge(value: Model, event: Extract<Event, { readonly type: "operation.merge" }>) {
  const left = operation(value, event.left)
  const right = operation(value, event.right)
  if (!left || !right || left.id === right.id) return unchanged(value, { type: "noop", reason: "stale" })
  if (!left.claims.some((session) => right.claims.includes(session)))
    return unchanged(value, { type: "noop", reason: "disjoint" })
  const current = combine(value, left, right)
  touch(current)
  updatefences(value, current)
  replaceOperation(value, current)
  return transition(value, { type: "applied" })
}

function participant(value: Model, event: Extract<Event, { readonly type: "participant.observe" }>) {
  const current = operation(value, event.operation)
  if (!current || current.id !== event.operation) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.phase.type === "driver_starting")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const previous = current.participants.find((item) => item.id === event.participant)
  if (previous && previous.revision >= event.revision)
    return unchanged(value, { type: "noop", reason: previous.revision === event.revision ? "duplicate" : "stale" })
  current.participants = [
    ...current.participants.filter((item) => item.id !== event.participant),
    { id: event.participant, revision: event.revision },
  ]
  touch(current)
  replaceOperation(value, current)
  return transition(value, { type: "applied" })
}

function requireView(value: Model, event: Extract<Event, { readonly type: "view.require" }>) {
  const current = operation(value, event.operation)
  if (!current || current.id !== event.operation) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.phase.type === "driver_starting")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const root = current.views.find((item) => item.id === event.view)
  if (!root) return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const additions = event.facts.map((item) => factview(current.id, item))
  const facts = mergefacts(current.facts, additions)
  const nodes = unique([...root.nodes, ...event.nodes])
  const factIDs = unique([...root.facts, ...additions.map((item) => item.id)])
  const changed = !same(nodes, root.nodes) || !same(factIDs, root.facts) || !same(facts, current.facts)
  if (!changed) return unchanged(value, { type: "noop", reason: "duplicate" })
  current.views = current.views.map((item) => (item.id === root.id ? { ...item, nodes, facts: factIDs } : item))
  current.facts = facts
  if (current.generations.length > 0) {
    const recorded = new Set(current.generations.flatMap((item) => item.facts))
    current.successors = mergefacts(
      current.successors,
      additions.filter((item) => !recorded.has(item.id)),
    )
  }
  touch(current)
  replaceOperation(value, current)
  return transition(value, { type: "applied" })
}

function advance(value: Model, event: Extract<Event, { readonly type: "operation.advance" }>) {
  const current = operation(value, event.operation)
  if (!current || current.id !== event.operation) return unchanged(value, { type: "noop", reason: "stale" })
  const from = current.phase
  const target = event.to
  const valid =
    (from.type === "claiming" && target.type === "fencing") ||
    (from.type === "fencing" && target.type === "quiescing") ||
    (from.type === "quiescence_failed" && (target.type === "fencing" || target.type === "quiescing")) ||
    (from.type === "planning_failed_identity_missing" && target.type === "planning") ||
    (from.type === "record_failed" &&
      target.type === "recording" &&
      current.generations.some((item) => item.generation === target.generation)) ||
    (from.type === "recording" &&
      target.type === "quiescing" &&
      current.successors.length > 0 &&
      current.generations.every(
        (item) => !item.failure && item.inFlight.length === 0 && item.committedPrefix === item.facts.length,
      ))
  if (!valid) return unchanged(value, { type: "rejected", reason: "invalid_phase" })
  if (current.driver.state !== "running" || current.driver.gate !== "opened")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  current.phase = copy(event.to)
  current.failure = undefined
  if (from.type === "record_failed" && target.type === "recording")
    current.generations = current.generations.map((item) =>
      item.generation === target.generation ? { ...item, failure: undefined } : item,
    )
  touch(current)
  updatefences(value, current)
  replaceOperation(value, current)
  return transition(value, { type: "applied" })
}

function reserveLease(value: Model, event: Extract<Event, { readonly type: "lease.reserve" }>) {
  const currentEpoch = epoch(value, event.lease.session)
  if (event.lease.epoch !== currentEpoch) return unchanged(value, { type: "rejected", reason: "stale_epoch" })
  if (event.lease.kind === "continuation" && event.lease.originEpoch !== currentEpoch)
    return unchanged(value, { type: "rejected", reason: "stale_epoch" })
  // Read the fence once, before any branch that installs a lease, so every construction below
  // stamps the same observation rather than each re-deriving it. `LeaseView.acquisition` says why
  // the model owns this fact instead of the caller.
  const currentFence = value.fences.find((item) => item.session === event.lease.session)
  const acquisition = currentFence ? ("post_fence" as const) : ("pre_fence" as const)
  const previous = lease(value, event.lease.id)
  if (previous) {
    if (
      event.lease.retry === "post_closure_external_retry" &&
      previous.retry === "initial" &&
      previous.origin === "external" &&
      previous.epoch !== event.lease.epoch
    ) {
      // Derive from the current fence so a fresh fence cannot be bypassed by retry status.
      replaceLease(value, { ...copy(event.lease), state: "reserved", acquisition })
      return transition(value, { type: "applied" })
    }
    return unchanged(value, { type: "noop", reason: "duplicate" })
  }
  if (!currentFence) {
    value.leases = [...value.leases, { ...copy(event.lease), state: "reserved", acquisition }]
    return transition(value, { type: "applied" })
  }
  const current = operation(value, currentFence.operation)
  if (!current) return unchanged(value, { type: "rejected", reason: "fenced" })
  if (event.lease.origin === "internal") {
    value.leases = [...value.leases, { ...copy(event.lease), state: "suppressed", operation: current.id, acquisition }]
    current.executionLeases = unique([...current.executionLeases, event.lease.id])
    replaceOperation(value, current)
    return transition(value, { type: "applied" })
  }
  const adopted: LeaseView = { ...copy(event.lease), state: "reserved", operation: current.id, acquisition }
  value.leases = [...value.leases, adopted]
  if (current.phase.type === "planning") {
    current.executionLeases = unique([...current.executionLeases, event.lease.id])
    touch(current)
    replaceOperation(value, current)
  }
  return transition(value, { type: "joined", operation: current.id, repair: repair(current) })
}

/**
 * Revalidates a causal continuation against both its carried and original epoch. It creates no lease
 * or owner change; the observer remains responsible for the single terminal disposition.
 */
function reuseLease(value: Model, event: Extract<Event, { readonly type: "lease.reuse" }>) {
  const current = lease(value, event.lease)
  if (!current || current.session !== event.session || current.kind !== "continuation")
    return unchanged(value, { type: "noop", reason: "stale" })
  const currentEpoch = epoch(value, event.session)
  if (event.epoch !== currentEpoch || current.epoch !== event.epoch || current.originEpoch !== event.epoch)
    return unchanged(value, { type: "rejected", reason: "stale_epoch" })
  if (current.state !== "reserved" && current.state !== "bound")
    return unchanged(value, { type: "noop", reason: "settled" })
  return transition(value, { type: "applied" }, [], false)
}

function bindLease(value: Model, event: Extract<Event, { readonly type: "lease.bind" }>) {
  const current = lease(value, event.lease)
  if (!current) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.epoch !== epoch(value, current.session))
    return unchanged(value, { type: "rejected", reason: "stale_epoch" })
  if (current.state !== "reserved")
    return unchanged(value, { type: "noop", reason: current.state === "bound" ? "duplicate" : "settled" })
  replaceLease(value, { ...current, owner: copy(event.owner), state: "bound" } as LeaseView)
  const owner = current.operation ? operation(value, current.operation) : undefined
  if (owner) {
    touch(owner)
    replaceOperation(value, owner)
  }
  return transition(value, { type: "applied" })
}

function finishLease(value: Model, event: Extract<Event, { readonly type: "lease.finish" }>) {
  const current = lease(value, event.lease)
  if (!current) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.state === "retired" || current.state === "suppressed" || current.state === "failed")
    return unchanged(value, { type: "noop", reason: "settled" })
  replaceLease(value, { ...current, state: event.state })
  const owner = current.operation ? operation(value, current.operation) : undefined
  if (owner) {
    if (event.state === "failed") {
      const repairID = repair(owner) ?? id("repair", `${owner.id}:lease-failure`)
      const commands = fail(value, owner, "quiescence_failed", { type: "quiescence_failed" }, { repair: repairID })
      return transition(value, { type: "applied" }, commands)
    }
    touch(owner)
    replaceOperation(value, owner)
  }
  return transition(value, { type: "applied" })
}

function reserveMutation(value: Model, event: Extract<Event, { readonly type: "mutation.reserve" }>) {
  if (mutation(value, event.mutation.id)) return unchanged(value, { type: "noop", reason: "duplicate" })
  const stale = event.mutation.epochs.some((item) => epoch(value, item.session) !== item.epoch)
  if (stale) return unchanged(value, { type: "rejected", reason: "stale_epoch" })
  const fenced = event.mutation.sessions.some((session) => value.fences.some((item) => item.session === session))
  if (fenced) return unchanged(value, { type: "rejected", reason: "fenced" })
  value.mutations = [...value.mutations, { ...copy(event.mutation), state: "reserved" }]
  return transition(value, { type: "applied" })
}

function activateMutation(value: Model, event: Extract<Event, { readonly type: "mutation.activate" }>) {
  const current = mutation(value, event.mutation)
  if (!current) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.state === "retired") return unchanged(value, { type: "noop", reason: "settled" })
  if (current.state === "active") return unchanged(value, { type: "noop", reason: "duplicate" })
  replaceMutation(value, { ...current, state: "active" })
  return transition(value, { type: "applied" })
}

function retireMutation(value: Model, event: Extract<Event, { readonly type: "mutation.retire" }>) {
  const current = mutation(value, event.mutation)
  if (!current) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.state === "retired") return unchanged(value, { type: "noop", reason: "settled" })
  replaceMutation(value, { ...current, state: "retired" })
  return transition(value, { type: "applied" })
}

function issueEffect(value: Model, event: Extract<Event, { readonly type: "effect.issue" }>) {
  if (effect(value, event.permit)) return unchanged(value, { type: "noop", reason: "duplicate" })
  const current = operation(value, event.operation)
  if (!current || current.id !== event.operation) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.phase.type === "driver_starting")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (
    repair(current) !== event.repair ||
    current.revision !== event.revision ||
    current.phase.type === "closure_unavailable" ||
    current.phase.type === "released_pending_delivery" ||
    current.phase.type === "complete"
  )
    return unchanged(value, { type: "noop", reason: "stale" })
  value.effects = [
    ...value.effects,
    {
      id: event.permit,
      operation: event.operation,
      repair: event.repair,
      revision: event.revision,
      effect: event.effect,
      state: "issued",
    },
  ]
  return transition(value, { type: "applied" }, [
    command(value, {
      type: "effect.run",
      permit: event.permit,
      operation: event.operation,
      repair: event.repair,
      revision: event.revision,
      effect: event.effect,
    }),
  ])
}

function exactEffect(value: Model, current: EffectView, run: Extract<Command, { readonly type: "effect.run" }>) {
  return (
    run.instance === value.instance &&
    current.id === run.permit &&
    current.operation === run.operation &&
    current.repair === run.repair &&
    current.revision === run.revision &&
    current.effect === run.effect
  )
}

function dispatchEffect(value: Model, event: Extract<Event, { readonly type: "effect.dispatch" }>) {
  const current = effect(value, event.command.permit)
  if (!current || !exactEffect(value, current, event.command))
    return unchanged(value, { type: "noop", reason: "stale" })
  if (current.state !== "issued")
    return unchanged(value, { type: "noop", reason: current.state === "in_flight" ? "duplicate" : "stale" })
  replaceEffect(value, { ...current, state: "in_flight" })
  return transition(value, { type: "applied" })
}

function returnEffect(value: Model, event: Extract<Event, { readonly type: "effect.return" }>) {
  const current = effect(value, event.command.permit)
  if (!current || !exactEffect(value, current, event.command))
    return unchanged(value, { type: "noop", reason: "stale" })
  if (current.state === "issued") return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (current.state !== "in_flight")
    return unchanged(value, { type: "noop", reason: current.state === "returned" ? "duplicate" : "stale" })
  replaceEffect(value, { ...current, state: "returned" })
  if (event.result === "failure") {
    const owner = operation(value, current.operation)
    if (!owner) return transition(value, { type: "applied" })
    if (current.repair !== repair(owner)) return transition(value, { type: "applied" })
    const retained = owner.failure
    if (
      retained &&
      owner.delivery &&
      retained.repair === current.repair &&
      retained.revision === owner.delivery.revision
    )
      return transition(value, { type: "applied" })
    const failure =
      current.effect === "record_readback" || current.effect === "release_verify"
        ? { kind: "record_failed" as const, phase: { type: "record_failed" } as const }
        : current.effect === "plan_read"
          ? { kind: "planning_failed" as const, phase: { type: "planning_failed_identity_missing" } as const }
          : { kind: "quiescence_failed" as const, phase: { type: "quiescence_failed" } as const }
    const commands = fail(value, owner, failure.kind, failure.phase, { repair: current.repair })
    return transition(value, { type: "applied" }, commands)
  }
  return transition(value, { type: "applied" })
}

function blockers(value: Model, current: Operation) {
  const leases = current.executionLeases.some((leaseID) => {
    const item = lease(value, leaseID)
    if (!item) return false
    /**
     * Acquisition timing, not origin, determines blocking. Post-fence work is suppressed or parked
     * behind release, so blocking on it would deadlock closure. Any unsettled pre-fence lease may
     * still own work and therefore blocks.
     */
    if (item.acquisition === "post_fence") return false
    return item.state === "reserved" || item.state === "bound" || item.state === "failed"
  })
  const mutations = current.mutationLeases.some((mutationID) => mutation(value, mutationID)?.state !== "retired")
  const effects = value.effects.some(
    (item) => resolve(value, item.operation) === current.id && (item.state === "issued" || item.state === "in_flight"),
  )
  return leases || mutations || effects
}

function prove(value: Model, event: Extract<Event, { readonly type: "quiescence.prove" }>) {
  const current = operation(value, event.operation)
  if (!current || current.id !== event.operation || current.phase.type !== "quiescing")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const fresh = scancapture(value, current)
  if (!same(event.prior, event.current) || !same(event.current, fresh) || blockers(value, current))
    return unchanged(value, { type: "rejected", reason: "unverified" })
  current.proof = { revision: current.revision, capture: fresh }
  replaceOperation(value, current)
  return transition(value, { type: "applied" })
}

function plantargets(current: Operation) {
  const facts = current.successors.length > 0 ? current.successors : current.facts
  return unique(
    facts.map((item) => {
      if (item.type === "self") return item.subject
      if (item.type === "edge") return item.owner
      return item.root
    }),
  )
}

function beginPlanning(value: Model, event: Extract<Event, { readonly type: "planning.begin" }>) {
  const current = operation(value, event.operation)
  if (!current || current.id !== event.operation || current.phase.type !== "quiescing" || !current.proof)
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (current.proof.revision !== current.revision)
    return unchanged(value, { type: "rejected", reason: "stale_revision" })
  if (!same(current.proof.capture, scancapture(value, current)))
    return unchanged(value, { type: "rejected", reason: "unverified" })
  current.revision += 1n
  current.phase = { type: "planning" }
  current.planning = capture(value, current)
  updatefences(value, current)
  const read: PlanRead = {
    type: "plan.read",
    operation: current.id,
    repair: repair(current) ?? id("repair", `${current.id}:planning`),
    revision: current.revision,
    capture: copy(current.planning),
    targets: plantargets(current),
  }
  replaceOperation(value, current)
  return transition(value, { type: "applied" }, [command(value, read)])
}

function identityFor(
  identities: readonly { readonly session: SessionID; readonly identity?: Identity }[],
  fact: FactView,
) {
  const session = fact.type === "root" ? fact.root : fact.type === "edge" ? fact.owner : fact.subject
  return identities.find((item) => item.session === session)?.identity
}

function validIdentity(identity: Identity | undefined): identity is Identity {
  if (!identity) return false
  if (identity.source === "prior_user_message") return identity.sourceMessage !== undefined
  return identity.sourceMessage === undefined
}

function metadata(fact: FactView, owner: OperationID, generation: number, identity: Identity): RecordMetadata {
  const common = {
    version: 1 as const,
    freeze_owner_operation_id: owner,
    generation,
    fact_key: fact.key,
    identity_source: identity.source,
  }
  const source = identity.sourceMessage ? { source_user_message_id: identity.sourceMessage } : {}
  if (fact.type === "self") {
    const yielded = fact.yielded ? { state_at_fence: "yielded_with_outstanding_work" as const } : {}
    return {
      ...common,
      ...source,
      record_kind: "self",
      subject_session_id: fact.subject,
      terminal_outcome: fact.outcome,
      ...yielded,
    }
  }
  if (fact.type === "edge") {
    const task = fact.taskPart ? { task_part_id: fact.taskPart } : {}
    const yielded = fact.yielded ? { state_at_fence: "yielded_with_outstanding_work" as const } : {}
    return {
      ...common,
      ...source,
      record_kind: "edge",
      subject_session_id: fact.subject,
      owner_session_id: fact.owner,
      child_session_id: fact.child,
      ...task,
      terminal_outcome: fact.outcome,
      ...yielded,
    }
  }
  const direct = fact.direct ? { terminal_outcome: fact.direct.outcome } : {}
  const yielded = fact.direct?.yielded ? { state_at_fence: "yielded_with_outstanding_work" as const } : {}
  return {
    ...common,
    ...source,
    record_kind: "root",
    requested_root_session_id: fact.root,
    subject_session_id: fact.root,
    branch_outcome: "quiesced",
    ...direct,
    ...yielded,
  }
}

function record(
  fact: FactView,
  owner: OperationID,
  generation: number,
  identity: Identity,
  coordinate: FrozenCoordinates,
  messageTime: number,
  partTime: number,
): FrozenPair {
  const data = metadata(fact, owner, generation, identity)
  const sentence = (outcome: TerminalOutcome, yielded: boolean) => {
    const state = yielded ? "The Task had yielded with attached work outstanding at the fence. " : ""
    if (outcome === "cancelled") return `${state}Cancellation won physical closure.`
    if (outcome === "completed") return `${state}The tracked execution completed before cancellation took effect.`
    if (outcome === "error") return `${state}The tracked execution ended with an error before cancellation took effect.`
    return `${state}The terminal outcome could not be established.`
  }
  const text =
    fact.type === "self"
      ? `[Branch closure] This Session's prior Task execution: ${sentence(fact.outcome, fact.yielded)}`
      : fact.type === "edge"
        ? `[Branch closure] Child Session ${fact.child}: ${sentence(fact.outcome, fact.yielded)} Owner Session: ${fact.owner}.`
        : fact.direct
          ? `[Branch closure] Requested Session ${fact.root}: ${sentence(fact.direct.outcome, fact.direct.yielded)} Its in-scope Task branch reached conversational quiescence.`
          : `[Branch closure] Requested Session ${fact.root}: Its in-scope Task branch reached conversational quiescence.`
  const messageBytes = JSON.stringify({
    id: coordinate.message,
    event: coordinate.messageEvent,
    time: messageTime,
    synthetic: true,
    identity,
  })
  const partBytes = JSON.stringify({
    id: coordinate.part,
    event: coordinate.partEvent,
    time: partTime,
    synthetic: true,
    text,
    metadata: data,
  })
  return {
    fact: copy(fact),
    freezeOwner: owner,
    generation,
    identity: copy(identity),
    message: coordinate.message,
    part: coordinate.part,
    messageEvent: coordinate.messageEvent,
    partEvent: coordinate.partEvent,
    messageTime,
    partTime,
    synthetic: true,
    text,
    metadata: data,
    messageBytes,
    partBytes,
  }
}

function planningReturn(value: Model, event: Extract<Event, { readonly type: "planning.return" }>) {
  const current = operation(value, event.read.operation)
  if (!current || current.id !== event.read.operation || current.phase.type !== "planning" || !current.planning)
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const exact =
    event.read.instance === value.instance &&
    repair(current) === event.read.repair &&
    current.revision === event.read.revision &&
    same(current.planning, event.read.capture) &&
    same(capture(value, current), event.read.capture) &&
    same(plantargets(current), event.read.targets)
  if (!exact) {
    current.phase = { type: "quiescing" }
    current.planning = undefined
    current.proof = undefined
    replaceOperation(value, current)
    return transition(value, { type: "noop", reason: "stale" }, [], false)
  }
  const facts = sortfacts(current.successors.length > 0 ? current.successors : current.facts)
  const identities = facts.map((fact) => identityFor(event.identities, fact))
  if (identities.some((item) => !validIdentity(item))) {
    const commands = fail(
      value,
      current,
      "planning_failed",
      { type: "planning_failed_identity_missing" },
      { repair: event.read.repair },
    )
    value.authorityRevision += 1n
    return transition(value, { type: "rejected", reason: "missing_identity" }, commands, false)
  }
  if (!event.seed || event.seed.coordinates.length !== facts.length)
    return unchanged(value, { type: "rejected", reason: "unverified" })
  const coordinates = facts.map((fact) => event.seed?.coordinates.find((item) => item.fact === fact.id))
  const coordinateIDs = event.seed.coordinates.flatMap((item) => [
    item.message,
    item.part,
    item.messageEvent,
    item.partEvent,
  ])
  if (
    coordinates.some((item) => !item) ||
    new Set(event.seed.coordinates.map((item) => item.fact)).size !== facts.length ||
    new Set(coordinateIDs).size !== coordinateIDs.length
  )
    return unchanged(value, { type: "rejected", reason: "unverified" })
  /**
   * No facts means no generation or rows. The operation still follows normal release so it advances
   * epochs, removes fences, settles waiters, and cleans up.
   */
  if (facts.length === 0) {
    current.phase = { type: "recording" }
    current.planning = undefined
    current.proof = undefined
    updatefences(value, current)
    replaceOperation(value, current)
    return transition(value, { type: "applied" })
  }
  const generation = Math.max(0, ...current.generations.map((item) => item.generation)) + 1
  const sequence = value.sequences.freeze + 1n
  const base = Math.max(event.seed.clockMillis, event.seed.highWaterMillis + 1)
  const records = facts.map((fact, index) =>
    record(
      fact,
      current.id,
      generation,
      identities[index] as Identity,
      coordinates[index] as FrozenCoordinates,
      base + index * 2,
      base + index * 2 + 1,
    ),
  )
  const frozen: GenerationView = {
    freezeOwner: current.id,
    generation,
    freezeSequence: sequence,
    freezeRevision: event.read.revision,
    facts: facts.map((item) => item.id),
    records,
    committedPrefix: 0,
    inFlight: [],
    verified: [],
  }
  value.sequences = { ...value.sequences, freeze: sequence }
  current.generations = [...current.generations, frozen]
  current.phase = { type: "recording", generation }
  current.planning = undefined
  current.proof = undefined
  if (current.successors.length > 0) current.successors = []
  updatefences(value, current)
  replaceOperation(value, current)
  return transition(value, { type: "applied" })
}

function nextPair(value: Model, event: Extract<Event, { readonly type: "writer.next" }>) {
  const current = operation(value, event.operation)
  if (!current || current.id !== event.operation) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.phase.type !== "recording") return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  // No-work recording has no pair; `settled` tells the writer sweep it is done.
  if (current.phase.generation === undefined) return unchanged(value, { type: "noop", reason: "settled" })
  const generationID = current.phase.generation
  const generation =
    current.generations.find((item) => item.freezeOwner === current.id && item.generation === generationID) ??
    current.generations.find((item) => item.generation === generationID)
  if (!generation || generation.failure || generation.inFlight.length > 0)
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const fact = generation.facts[generation.committedPrefix]
  if (!fact) return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const repairID = repair(current)
  if (!repairID) return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  return transition(
    value,
    { type: "applied" },
    [
      command(value, {
        type: "pair.candidate",
        operation: current.id,
        repair: repairID,
        revision: current.revision,
        freezeOwner: generation.freezeOwner,
        generation: generation.generation,
        fact,
        expectedPrefix: generation.committedPrefix,
      }),
    ],
    false,
  )
}

function issuePair(value: Model, event: Extract<Event, { readonly type: "pair.issue" }>) {
  if (pair(value, event.permit)) return unchanged(value, { type: "noop", reason: "duplicate" })
  const current = operation(value, event.candidate.operation)
  if (!current || current.id !== event.candidate.operation)
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (current.phase.type !== "recording") return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const generation = current.generations.find(
    (item) => item.freezeOwner === event.candidate.freezeOwner && item.generation === event.candidate.generation,
  )
  const expected = generation?.facts[generation.committedPrefix]
  const exact =
    generation &&
    !generation.failure &&
    generation.inFlight.length === 0 &&
    event.candidate.instance === value.instance &&
    event.candidate.repair === repair(current) &&
    event.candidate.revision === current.revision &&
    event.candidate.expectedPrefix === generation.committedPrefix &&
    event.candidate.fact === expected
  if (!exact || !generation) return unchanged(value, { type: "rejected", reason: "unverified" })
  const currentPair: PairView = {
    id: event.permit,
    operation: event.candidate.operation,
    freezeOwner: event.candidate.freezeOwner,
    generation: event.candidate.generation,
    fact: event.candidate.fact,
    expectedPrefix: event.candidate.expectedPrefix,
    repair: event.candidate.repair,
    revision: event.candidate.revision,
    state: "in_flight",
  }
  value.pairs = [...value.pairs, currentPair]
  current.generations = current.generations.map((item) =>
    item.freezeOwner === generation.freezeOwner && item.generation === generation.generation
      ? { ...item, inFlight: unique([...item.inFlight, event.permit]) }
      : item,
  )
  replaceOperation(value, current)
  return transition(value, { type: "applied" }, [
    command(value, { type: "pair.write", permit: event.permit, candidate: copy(event.candidate) }),
  ])
}

function returnPair(value: Model, event: Extract<Event, { readonly type: "pair.return" }>) {
  const currentPair = pair(value, event.write.permit)
  if (!currentPair) return unchanged(value, { type: "noop", reason: "stale" })
  const candidate = command(value, {
    type: "pair.candidate",
    operation: currentPair.operation,
    repair: currentPair.repair,
    revision: currentPair.revision,
    freezeOwner: currentPair.freezeOwner,
    generation: currentPair.generation,
    fact: currentPair.fact,
    expectedPrefix: currentPair.expectedPrefix,
  })
  const exact = same(event.write, command(value, { type: "pair.write", permit: currentPair.id, candidate }))
  if (!exact) return unchanged(value, { type: "noop", reason: "stale" })
  if (currentPair.state !== "in_flight")
    return unchanged(value, { type: "noop", reason: currentPair.state === "failed" ? "settled" : "duplicate" })
  const canonical = resolve(value, currentPair.operation)
  const current = operation(value, canonical)
  const generation = current?.generations.find(
    (item) => item.freezeOwner === currentPair.freezeOwner && item.generation === currentPair.generation,
  )
  if (!current || !generation || generation.committedPrefix !== currentPair.expectedPrefix)
    return unchanged(value, { type: "noop", reason: "stale" })
  const success = event.message === "verified" && event.part === "verified"
  current.generations = current.generations.map((item) => {
    if (item.freezeOwner !== generation.freezeOwner || item.generation !== generation.generation) return item
    if (!success)
      return {
        ...item,
        inFlight: item.inFlight.filter((permit) => permit !== currentPair.id),
        failure: "record_failed",
      }
    return {
      ...item,
      committedPrefix: item.committedPrefix + 1,
      inFlight: item.inFlight.filter((permit) => permit !== currentPair.id),
      verified: [...item.verified, currentPair.fact],
    }
  })
  if (!success) {
    const commands = fail(value, current, "record_failed", { type: "record_failed" }, { repair: currentPair.repair })
    replacePair(value, { ...currentPair, state: "failed" })
    return transition(value, { type: "applied" }, commands)
  }
  replaceOperation(value, current)
  replacePair(value, {
    ...currentPair,
    state: success ? (canonical === currentPair.operation ? "returned" : "imported") : "failed",
  })
  return transition(value, { type: "applied" })
}

function failOperation(value: Model, event: Extract<Event, { readonly type: "operation.fail" }>) {
  const current = operation(value, event.operation)
  if (!current || current.id !== event.operation) return unchanged(value, { type: "noop", reason: "stale" })
  if (repair(current) !== event.repair || current.revision !== event.revision)
    return unchanged(value, { type: "noop", reason: "stale" })
  const phase =
    event.failure === "record_failed" && current.phase.type === "recording"
      ? ({ type: "record_failed" } as const)
      : (event.failure === "quiescence_failed" || event.failure === "scope_incomplete") &&
          (current.phase.type === "fencing" || current.phase.type === "quiescing")
        ? ({ type: "quiescence_failed" } as const)
        : event.failure === "planning_failed" && current.phase.type === "planning"
          ? ({ type: "planning_failed_identity_missing" } as const)
          : event.failure === "closure_unavailable"
            ? ({ type: "closure_unavailable" } as const)
            : undefined
  if (!phase) return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const commands = fail(value, current, event.failure, phase, { repair: event.repair })
  return transition(value, { type: "applied" }, commands)
}

function releaseCheck(value: Model, current: Operation): ReleaseCheck {
  return {
    type: "release.verify",
    operation: current.id,
    repair: repair(current) ?? id("repair", `${current.id}:release`),
    revision: current.revision,
    claims: unique(current.claims),
    aliases: unique(current.aliases),
    generations: current.generations
      .map((item) => ({ freezeOwner: item.freezeOwner, generation: item.generation }))
      .toSorted((left, right) => {
        const generation = left.generation - right.generation
        return generation === 0 ? compare(left.freezeOwner, right.freezeOwner) : generation
      }),
    facts: sortfacts(current.facts).map((item) => item.id),
    views: current.views.map((item) => item.id).toSorted(compare),
  }
}

function readyToRelease(value: Model, current: Operation) {
  if (current.phase.type !== "recording" || current.successors.length > 0) return false
  // A generation-free recording must hold none; a generation-bearing recording must hold at least one.
  if (current.phase.generation === undefined ? current.generations.length !== 0 : current.generations.length === 0)
    return false
  if (current.mutationLeases.some((mutationID) => mutation(value, mutationID)?.state !== "retired")) return false
  if (
    value.effects.some(
      (item) =>
        resolve(value, item.operation) === current.id && (item.state === "issued" || item.state === "in_flight"),
    )
  )
    return false
  return current.generations.every(
    (item) => !item.failure && item.inFlight.length === 0 && item.committedPrefix === item.facts.length,
  )
}

function prepareRelease(value: Model, event: Extract<Event, { readonly type: "release.prepare" }>) {
  const current = operation(value, event.operation)
  if (!current || current.id !== event.operation || !readyToRelease(value, current))
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  return transition(value, { type: "applied" }, [command(value, releaseCheck(value, current))], false)
}

function commitRelease(value: Model, event: Extract<Event, { readonly type: "release.commit" }>) {
  const current = operation(value, event.check.operation)
  if (!current || current.id !== event.check.operation) return unchanged(value, { type: "noop", reason: "stale" })
  if (!readyToRelease(value, current) || !same(command(value, releaseCheck(value, current)), event.check))
    return unchanged(value, { type: "noop", reason: "stale" })
  touch(current)
  current.phase = { type: "released_pending_delivery" }
  current.failure = undefined
  current.views = current.views.map((item) => ({ ...item, result: "success", failureRevision: undefined }))
  // Fence-reference safety depends on this invariant: every release removes the operation's fences
  // and advances every claimed Session epoch in the same transition. No abort/dispose path may drop
  // a fence without the corresponding bump; otherwise a later operation could reuse stale truth.
  current.claims.forEach((session) => {
    const next = epoch(value, session) + 1n
    value.epochs = [...value.epochs.filter((item) => item.session !== session), { session, epoch: next }]
  })
  value.fences = value.fences.filter((item) => resolve(value, item.operation) !== current.id)
  value.claims = value.claims.filter((item) => resolve(value, item.operation) !== current.id)
  value.leases = value.leases.map((item) =>
    item.operation === current.id && item.origin === "external" && item.state === "reserved"
      ? { ...item, state: "suppressed" }
      : item,
  )
  const waiters = current.waiters
    .filter((item) => item.state === "attached" || item.state === "provisional")
    .map((item) => item.id)
    .toSorted(compare)
  current.waiters = current.waiters.map((item) =>
    waiters.includes(item.id) ? { ...item, state: "delivery_reserved", deliveryRevision: current.revision } : item,
  )
  current.delivery = { revision: current.revision, waiters }
  replaceOperation(value, current)
  return transition(value, { type: "applied" }, [
    command(value, { type: "waiter.deliver", operation: current.id, revision: current.revision, waiters }),
  ])
}

function delivered(value: Model, event: Extract<Event, { readonly type: "waiter.delivered" }>) {
  const current = operation(value, event.delivery.operation)
  if (!current) return unchanged(value, { type: "noop", reason: "stale" })
  const target = current.waiters.find((item) => item.id === event.waiter)
  if (
    !target ||
    !current.delivery ||
    event.delivery.instance !== value.instance ||
    event.delivery.failure !== current.failure?.kind ||
    !same(current.delivery, {
      revision: event.delivery.revision,
      waiters: event.delivery.waiters,
    })
  )
    return unchanged(value, { type: "noop", reason: "stale" })
  if (target.state === "settled") return unchanged(value, { type: "noop", reason: "settled" })
  if (target.state !== "delivery_reserved" || target.deliveryRevision !== event.delivery.revision)
    return unchanged(value, { type: "noop", reason: "stale" })
  current.waiters = current.waiters.map((item) => (item.id === target.id ? { ...item, state: "settled" } : item))
  replaceOperation(value, current)
  return transition(value, { type: "applied" })
}

function retryLease(current: LeaseView) {
  return current.origin === "external" && current.retry === "initial" && current.acquisition === "post_fence"
}

function removableLease(value: Model, current: LeaseView) {
  if (current.state === "reserved" || current.state === "bound") return false
  if (retryLease(current)) return false
  // A failed pre-fence lease is evidence, not ordinary terminal history. It can be adopted by a
  // later closure operation even when no operation owned it at failure time; deleting it here would
  // make that later quiescence proof fail open. Keep the full witness until a distinct, explicitly
  // designed recovery protocol can replace it with equivalent blocker evidence.
  if (current.state === "failed") return false
  if (value.bindings.some((item) => item.lease === current.id)) return false
  if (value.armPermits.some((item) => item.lease === current.id)) return false
  return true
}

function cleanupOperation(
  value: Model,
  event: Extract<Event, { readonly type: "cleanup"; readonly operation: OperationID }>,
) {
  const current = value.operations.find((item) => item.id === event.operation)
  if (!current || current.revision !== event.revision) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.phase.type !== "released_pending_delivery")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const pending = current.waiters.some((item) => item.state === "delivery_reserved")
  const effects = value.effects.some(
    (item) => item.operation === current.id && (item.state === "issued" || item.state === "in_flight"),
  )
  const pairs = value.pairs.some((item) => item.operation === current.id && item.state === "in_flight")
  if (pending || effects || pairs) return unchanged(value, { type: "rejected", reason: "unverified" })
  const tickets = new Set(value.tickets.filter((item) => item.operation === current.id).map((item) => item.id))
  value.operations = value.operations.filter((item) => item.id !== current.id)
  value.tickets = value.tickets.filter((item) => item.operation !== current.id)
  value.queue = value.queue.filter((item) => !tickets.has(item))
  value.aliases = value.aliases.filter((item) => item.alias !== current.id && item.canonical !== current.id)
  value.leases = value.leases.filter((item) => item.operation !== current.id || !removableLease(value, item))
  return transition(value, { type: "applied" })
}

function cleanupLease(value: Model, event: Extract<Event, { readonly type: "cleanup"; readonly lease: LeaseID }>) {
  const current = lease(value, event.lease)
  if (!current) return unchanged(value, { type: "noop", reason: "stale" })
  if (!removableLease(value, current)) return unchanged(value, { type: "noop", reason: "settled" })
  value.leases = value.leases.filter((item) => item.id !== current.id)
  return transition(value, { type: "applied" }, [], false)
}

function cleanupPermit(value: Model, event: Extract<Event, { readonly type: "cleanup"; readonly permit: ArmID }>) {
  const current = arm(value, event.permit)
  if (!current) return unchanged(value, { type: "noop", reason: "stale" })
  const owner = job(value, current.job)
  if (!owner || owner.lifetime !== current.lifetime || owner.state !== "terminal")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (current.state !== "issued") return unchanged(value, { type: "noop", reason: "settled" })
  replaceArm(value, { ...current, state: "revoked" })
  return transition(value, { type: "applied" }, [], false)
}

function cleanupJob(value: Model, event: Extract<Event, { readonly type: "cleanup"; readonly job: JobID }>) {
  const current = job(value, event.job)
  const exact = current?.lifetime === event.lifetime ? current : undefined
  if (exact && exact.state !== "terminal") return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  const permits = value.armPermits.filter((item) => item.job === event.job && item.lifetime === event.lifetime)
  if (permits.some((item) => item.state === "issued"))
    return unchanged(value, { type: "rejected", reason: "unverified" })
  const bindings = value.bindings.filter((item) => item.job === event.job && item.lifetime === event.lifetime)
  const owned = value.leases.filter((item) => {
    const owner = item.owner
    return owner?.type === "job" && owner.job === event.job && owner.lifetime === event.lifetime
  })
  if (!exact && permits.length === 0 && bindings.length === 0 && owned.length === 0)
    return unchanged(value, { type: "noop", reason: "stale" })
  const leases = new Set([
    ...bindings.map((item) => item.lease),
    ...permits.map((item) => item.lease),
    ...owned.map((item) => item.id),
  ])
  value.jobs = value.jobs.filter((item) => item.id !== event.job || item.lifetime !== event.lifetime)
  value.bindings = value.bindings.filter((item) => item.job !== event.job || item.lifetime !== event.lifetime)
  value.armPermits = value.armPermits.filter((item) => item.job !== event.job || item.lifetime !== event.lifetime)
  value.leases = value.leases.filter((item) => !leases.has(item.id) || !removableLease(value, item))
  return transition(value, { type: "applied" }, [], false)
}

function cleanup(value: Model, event: Extract<Event, { readonly type: "cleanup" }>) {
  if ("operation" in event) return cleanupOperation(value, event)
  if ("lease" in event) return cleanupLease(value, event)
  if ("permit" in event) return cleanupPermit(value, event)
  return cleanupJob(value, event)
}

function bindingCommand(
  value: Model,
  input: {
    readonly request: RequestID
    readonly job: JobID
    readonly lifetime: LifetimeID
    readonly sequence: bigint
    readonly lease: LeaseID
    readonly epoch: bigint
    readonly admissionRevision: bigint
    readonly operationRevision?: bigint
  },
): Binding {
  return command(value, { type: "job.bind", ...input })
}

function validLease(
  value: Model,
  input: {
    readonly lease: LeaseID
    readonly epoch: bigint
    readonly admissionRevision: bigint
  },
) {
  const current = lease(value, input.lease)
  return (
    current?.state === "reserved" &&
    current.epoch === input.epoch &&
    epoch(value, current.session) === input.epoch &&
    input.admissionRevision === value.authorityRevision
  )
}

function startJob(value: Model, event: Extract<Event, { readonly type: "job.start" }>) {
  const current = job(value, event.job)
  if (current && current.lifetime === event.lifetime && current.state !== "terminal") {
    if (current.starts.some((item) => item.request === event.request))
      return unchanged(value, { type: "noop", reason: "duplicate" })
    const base = value.bindings.find(
      (item) => item.job === current.id && item.lifetime === current.lifetime && item.sequence === 0n,
    )
    const exact =
      base &&
      base.lease === event.lease &&
      base.epoch === event.epoch &&
      base.admissionRevision === event.admissionRevision &&
      base.operationRevision === event.operationRevision &&
      current.scope === event.scope
    if (!exact) return unchanged(value, { type: "rejected", reason: "stale_revision" })
    replaceJob(value, {
      ...current,
      starts: [...current.starts, { request: event.request, state: "joined" }],
    })
    return transition(value, { type: "joined" })
  }
  if (current && current.lifetime === event.lifetime && current.state === "terminal")
    return unchanged(value, { type: "rejected", reason: "stale_token" })
  if (current && current.state !== "terminal") return unchanged(value, { type: "rejected", reason: "stale_token" })
  if (!validLease(value, event)) return unchanged(value, { type: "rejected", reason: "stale_revision" })
  const binding = bindingCommand(value, {
    request: event.request,
    job: event.job,
    lifetime: event.lifetime,
    sequence: 0n,
    lease: event.lease,
    epoch: event.epoch,
    admissionRevision: event.admissionRevision,
    operationRevision: event.operationRevision,
  })
  const next: JobView = {
    id: event.job,
    lifetime: event.lifetime,
    scope: event.scope,
    state: "registered_unarmed",
    armAttempt: "pending",
    accepted: [],
    nextSequence: 1n,
    starts: [{ request: event.request, state: "owner" }],
    extensions: [],
    promoted: false,
    observed: [],
    delivered: [],
  }
  if (current) value.jobs = value.jobs.filter((item) => item.id !== current.id)
  value.jobs = [...value.jobs, next]
  // A terminal lifetime's outcome reader may still owe exact cleanup while core has already opened
  // the same-JobID replacement barrier. Keep the old exact bindings as dependency coordinates until
  // `job.cleanup` removes that lifetime; filtering them here would orphan its scope-owned leases.
  value.bindings = [...value.bindings, binding]
  return transition(value, { type: "applied" }, [binding])
}

function extendJob(value: Model, event: Extract<Event, { readonly type: "job.extend" }>) {
  const current = job(value, event.job)
  if (!current) return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (current.lifetime !== event.lifetime) return unchanged(value, { type: "rejected", reason: "stale_token" })
  if (current.state === "terminal") return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (current.extensions.some((item) => item.request === event.request))
    return unchanged(value, { type: "noop", reason: "duplicate" })
  if (!validLease(value, event)) return unchanged(value, { type: "rejected", reason: "stale_revision" })
  if (current.armAttempt !== "armed") {
    value.bindings = [
      ...value.bindings,
      bindingCommand(value, {
        request: event.request,
        job: event.job,
        lifetime: event.lifetime,
        sequence: -1n,
        lease: event.lease,
        epoch: event.epoch,
        admissionRevision: event.admissionRevision,
        operationRevision: event.operationRevision,
      }),
    ]
    replaceJob(value, {
      ...current,
      extensions: [...current.extensions, { request: event.request, state: "waiting_for_arm" }],
    })
    return transition(value, { type: "joined" })
  }
  const sequence = current.nextSequence
  const binding = bindingCommand(value, {
    request: event.request,
    job: event.job,
    lifetime: event.lifetime,
    sequence,
    lease: event.lease,
    epoch: event.epoch,
    admissionRevision: event.admissionRevision,
    operationRevision: event.operationRevision,
  })
  value.bindings = [...value.bindings, binding]
  replaceJob(value, {
    ...current,
    nextSequence: sequence + 1n,
    extensions: [...current.extensions, { request: event.request, state: "binding", sequence }],
  })
  return transition(value, { type: "joined" }, [binding])
}

function bindingRefusal(value: Model, current: JobView, binding: Binding) {
  const extension = current.extensions.find((item) => item.sequence === binding.sequence)
  if (binding.sequence > 0n && extension) {
    replaceJob(value, {
      ...current,
      extensions: current.extensions.map((item) =>
        item.request === extension.request ? { ...item, state: "rejected" } : item,
      ),
    })
    const currentLease = lease(value, binding.lease)
    if (currentLease) replaceLease(value, { ...currentLease, state: "suppressed" })
    return transition(value, { type: "applied" })
  }
  return terminalJob(value, current, "cancelled")
}

function bindJob(value: Model, event: Extract<Event, { readonly type: "job.bind" }>) {
  const current = job(value, event.binding.job)
  if (!current) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.lifetime !== event.binding.lifetime) return unchanged(value, { type: "rejected", reason: "stale_token" })
  const expected = value.bindings.find(
    (item) => item.job === event.binding.job && item.lifetime === event.binding.lifetime && item.sequence === 0n,
  )
  const bySequence = value.bindings.find(
    (item) =>
      item.job === event.binding.job &&
      item.lifetime === event.binding.lifetime &&
      item.sequence === event.binding.sequence,
  )
  if (!bySequence) {
    if (expected && event.binding.sequence !== expected.sequence)
      return unchanged(value, { type: "rejected", reason: "stale_sequence" })
    return unchanged(value, { type: "noop", reason: "stale" })
  }
  if (bySequence.epoch !== event.binding.epoch) return unchanged(value, { type: "rejected", reason: "stale_epoch" })
  if (
    bySequence.admissionRevision !== event.binding.admissionRevision ||
    bySequence.operationRevision !== event.binding.operationRevision
  )
    return unchanged(value, { type: "rejected", reason: "stale_revision" })
  if (bySequence.lease !== event.binding.lease) return unchanged(value, { type: "rejected", reason: "stale_token" })
  if (!same(bySequence, event.binding)) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.state === "terminal") return unchanged(value, { type: "noop", reason: "stale" })
  if (event.decision.type !== "arm_allowed") return bindingRefusal(value, current, event.binding)
  if (arm(value, event.decision.permit)) return unchanged(value, { type: "noop", reason: "duplicate" })
  const base = event.binding.sequence === 0n
  const extension = current.extensions.find(
    (item) => item.sequence === event.binding.sequence && item.state === "binding",
  )
  if ((base && current.state !== "registered_unarmed") || (!base && (!extension || current.state !== "armed")))
    return unchanged(value, { type: "noop", reason: "stale" })
  const permit: ArmPermitView = {
    id: event.decision.permit,
    job: current.id,
    lifetime: current.lifetime,
    sequence: event.binding.sequence,
    epoch: event.binding.epoch,
    lease: event.binding.lease,
    admissionRevision: event.binding.admissionRevision,
    operationRevision: event.binding.operationRevision,
    state: "issued",
  }
  value.armPermits = [...value.armPermits, permit]
  if (base) replaceJob(value, { ...current, state: "binding" })
  return transition(value, { type: "applied" })
}

function terminalJob(value: Model, current: JobView, winner: "cancelled" | "completed" | "error") {
  const next: JobView = {
    ...current,
    state: "terminal",
    armAttempt: "terminal",
    starts: current.starts.map((item) => ({ ...item, state: "settled" })),
    extensions: current.extensions.map((item) => ({ ...item, state: "settled" })),
    winner,
  }
  replaceJob(value, next)
  const leases = new Set(
    value.bindings
      .filter((item) => item.job === current.id && item.lifetime === current.lifetime)
      .map((item) => item.lease),
  )
  value.leases = value.leases.map((item) =>
    leases.has(item.id) && (item.state === "reserved" || item.state === "bound") ? { ...item, state: "retired" } : item,
  )
  return transition(value, { type: "applied" }, [
    command(value, { type: "job.close", job: current.id, lifetime: current.lifetime, scope: current.scope }),
  ])
}

function permitJob(value: Model, event: Extract<Event, { readonly type: "job.permit" }>) {
  const currentPermit = arm(value, event.permit)
  if (!currentPermit) return unchanged(value, { type: "noop", reason: "stale" })
  if (currentPermit.state !== "issued") {
    const reason = event.action === "consume" && currentPermit.state === "consumed" ? "duplicate" : "stale"
    return unchanged(value, { type: "noop", reason })
  }
  const current = job(value, currentPermit.job)
  if (!current || current.lifetime !== currentPermit.lifetime) {
    // The runtime CAS has already settled this exact permit. A fresh same-JobID lifetime may have
    // replaced the terminal row before that acknowledgement reached the model; preserve the new
    // lifetime, settle only the old permit, and request exact orphan cleanup.
    replaceArm(value, { ...currentPermit, state: event.action === "consume" ? "consumed" : "revoked" })
    return transition(value, { type: "applied" }, [
      command(value, { type: "job.cleanup", job: currentPermit.job, lifetime: currentPermit.lifetime }),
    ])
  }
  if (current.state === "terminal") {
    replaceArm(value, { ...currentPermit, state: event.action === "consume" ? "consumed" : "revoked" })
    return transition(value, { type: "applied" }, [
      command(value, { type: "job.close", job: current.id, lifetime: current.lifetime, scope: current.scope }),
    ])
  }
  if (event.action === "revoke") {
    replaceArm(value, { ...currentPermit, state: "revoked" })
    return terminalJob(value, current, "cancelled")
  }
  const binding = value.bindings.find(
    (item) =>
      item.job === currentPermit.job &&
      item.lifetime === currentPermit.lifetime &&
      item.sequence === currentPermit.sequence,
  )
  const exact =
    binding &&
    binding.epoch === currentPermit.epoch &&
    binding.lease === currentPermit.lease &&
    binding.admissionRevision === currentPermit.admissionRevision &&
    binding.operationRevision === currentPermit.operationRevision
  if (!exact) return unchanged(value, { type: "noop", reason: "stale" })
  const base = currentPermit.sequence === 0n
  const extension = current.extensions.find(
    (item) => item.sequence === currentPermit.sequence && item.state === "binding",
  )
  if ((base && current.state !== "binding") || (!base && (!extension || current.state !== "armed")))
    return unchanged(value, { type: "noop", reason: "stale" })
  replaceArm(value, { ...currentPermit, state: "consumed" })
  const currentLease = lease(value, currentPermit.lease)
  if (currentLease)
    replaceLease(value, {
      ...currentLease,
      state: "bound",
      owner: {
        type: "job",
        job: current.id,
        lifetime: current.lifetime,
        sequence: currentPermit.sequence,
      },
    } as LeaseView)
  const next = base
    ? { ...current, state: "armed" as const, accepted: unique([...current.accepted.map(String), "0"]).map(BigInt) }
    : {
        ...current,
        accepted: [...current.accepted, currentPermit.sequence],
        extensions: current.extensions.map((item) =>
          item.request === extension?.request ? { ...item, state: "accepted" as const } : item,
        ),
      }
  replaceJob(value, next)
  return transition(value, { type: "applied" }, [
    command(value, {
      type: "job.register",
      job: current.id,
      lifetime: current.lifetime,
      sequence: currentPermit.sequence,
      permit: currentPermit.id,
    }),
  ])
}

function registeredJob(value: Model, event: Extract<Event, { readonly type: "job.registered" }>) {
  const current = job(value, event.registration.job)
  const currentPermit = arm(value, event.registration.permit)
  if (!current || !currentPermit) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.state === "terminal") return unchanged(value, { type: "noop", reason: "settled" })
  const exact =
    same(
      event.registration,
      command(value, {
        type: "job.register",
        job: currentPermit.job,
        lifetime: currentPermit.lifetime,
        sequence: currentPermit.sequence,
        permit: currentPermit.id,
      }),
    ) &&
    current.lifetime === currentPermit.lifetime &&
    currentPermit.state === "consumed" &&
    current.accepted.includes(currentPermit.sequence)
  if (!exact) return unchanged(value, { type: "noop", reason: "stale" })
  if (event.registration.sequence === 0n && current.armAttempt === "armed")
    return unchanged(value, { type: "noop", reason: "duplicate" })
  if (event.registration.sequence > 0n) {
    const extension = current.extensions.find((item) => item.sequence === event.registration.sequence)
    if (!extension || extension.state === "settled") return unchanged(value, { type: "noop", reason: "duplicate" })
    replaceJob(value, {
      ...current,
      extensions: current.extensions.map((item) =>
        item.request === extension.request ? { ...item, state: "settled" } : item,
      ),
    })
    return transition(value, { type: "applied" }, [
      command(value, {
        type: "job.run",
        job: current.id,
        lifetime: current.lifetime,
        sequence: event.registration.sequence,
      }),
    ])
  }
  const waiting = current.extensions.filter((item) => item.state === "waiting_for_arm")
  const commands: Command[] = [
    command(value, { type: "job.run", job: current.id, lifetime: current.lifetime, sequence: 0n }),
  ]
  const allocation = waiting.reduce(
    (result, extension) => {
      const binding = value.bindings.find(
        (item) => item.job === current.id && item.lifetime === current.lifetime && item.request === extension.request,
      )
      if (!binding) return result
      const next = { ...binding, sequence: result.sequence }
      value.bindings = value.bindings.map((item) => (item === binding ? next : item))
      result.commands.push(next)
      result.extensions.push({ ...extension, state: "binding", sequence: result.sequence })
      return { ...result, sequence: result.sequence + 1n }
    },
    {
      sequence: current.nextSequence,
      commands: [] as Binding[],
      extensions: [] as JobView["extensions"][number][],
    },
  )
  commands.push(...allocation.commands)
  replaceJob(value, {
    ...current,
    state: "armed",
    armAttempt: "armed",
    starts: current.starts.map((item) => ({ ...item, state: "settled" })),
    extensions: current.extensions.map(
      (item) => allocation.extensions.find((entry) => entry.request === item.request) ?? item,
    ),
    nextSequence: allocation.sequence,
  })
  return transition(value, { type: "applied" }, commands)
}

function binderFailed(value: Model, event: Extract<Event, { readonly type: "job.binder_failed" }>) {
  const current = job(value, event.job)
  if (!current) return unchanged(value, { type: "noop", reason: "stale" })
  if (current.lifetime !== event.lifetime) return unchanged(value, { type: "rejected", reason: "stale_token" })
  if (current.state === "terminal" || current.armAttempt === "armed")
    return unchanged(value, { type: "noop", reason: "settled" })
  return terminalJob(value, current, "error")
}

function exactJob(value: Model, jobID: JobID, lifetime: LifetimeID) {
  const current = job(value, jobID)
  if (!current) return { current: undefined, decision: { type: "rejected", reason: "invalid_transition" } as Decision }
  if (current.lifetime !== lifetime)
    return { current: undefined, decision: { type: "rejected", reason: "stale_token" } as Decision }
  return { current, decision: undefined }
}

function getJob(value: Model, event: Extract<Event, { readonly type: "job.get" }>) {
  const result = exactJob(value, event.job, event.lifetime)
  if (!result.current) return unchanged(value, result.decision as Decision)
  return transition(value, { type: "applied" }, [], false)
}

function promoteJob(value: Model, event: Extract<Event, { readonly type: "job.promote" }>) {
  const result = exactJob(value, event.job, event.lifetime)
  if (!result.current) return unchanged(value, result.decision as Decision)
  const current = result.current
  if (current.state === "terminal") return unchanged(value, { type: "noop", reason: "settled" })
  if (current.state !== "armed" || current.armAttempt !== "armed")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  if (current.promoted) return unchanged(value, { type: "noop", reason: "duplicate" })
  replaceJob(value, { ...current, promoted: true })
  return transition(value, { type: "applied" })
}

function waitPromotion(value: Model, event: Extract<Event, { readonly type: "job.wait_promotion" }>) {
  const result = exactJob(value, event.job, event.lifetime)
  if (!result.current) return unchanged(value, result.decision as Decision)
  const current = result.current
  if (current.state === "terminal") return unchanged(value, { type: "noop", reason: "settled" })
  if (current.state !== "armed" || current.armAttempt !== "armed")
    return unchanged(value, { type: "rejected", reason: "invalid_transition" })
  return unchanged(value, { type: "joined" })
}

function waitJob(value: Model, event: Extract<Event, { readonly type: "job.wait" }>) {
  const result = exactJob(value, event.job, event.lifetime)
  if (!result.current) return unchanged(value, result.decision as Decision)
  if (result.current.state === "terminal") return unchanged(value, { type: "noop", reason: "settled" })
  return unchanged(value, { type: "joined" })
}

function observeJob(value: Model, event: Extract<Event, { readonly type: "job.observe" }>) {
  const result = exactJob(value, event.job, event.lifetime)
  if (!result.current) return unchanged(value, result.decision as Decision)
  const current = result.current
  if (!current.accepted.includes(event.sequence))
    return unchanged(value, { type: "rejected", reason: "stale_sequence" })
  if (current.observed.includes(event.sequence)) return unchanged(value, { type: "noop", reason: "duplicate" })
  replaceJob(value, { ...current, observed: [...current.observed, event.sequence] })
  return transition(value, { type: "applied" })
}

function deliverJob(value: Model, event: Extract<Event, { readonly type: "job.deliver" }>) {
  const result = exactJob(value, event.job, event.lifetime)
  if (!result.current) return unchanged(value, result.decision as Decision)
  const current = result.current
  if (!current.accepted.includes(event.sequence))
    return unchanged(value, { type: "rejected", reason: "stale_sequence" })
  if (current.delivered.some((item) => item.sequence === event.sequence && item.scope === event.scope))
    return unchanged(value, { type: "noop", reason: "duplicate" })
  replaceJob(value, {
    ...current,
    delivered: [...current.delivered, { sequence: event.sequence, scope: event.scope }],
  })
  return transition(value, { type: "applied" })
}

function cancelJob(value: Model, event: Extract<Event, { readonly type: "job.cancel" }>) {
  const result = exactJob(value, event.job, event.lifetime)
  if (!result.current) return unchanged(value, result.decision as Decision)
  const current = result.current
  if (event.sequence !== undefined && !current.accepted.includes(event.sequence))
    return unchanged(value, { type: "rejected", reason: "stale_sequence" })
  if (current.state === "terminal") return unchanged(value, { type: "noop", reason: "settled" })
  return terminalJob(value, current, "cancelled")
}

function finishJob(value: Model, event: Extract<Event, { readonly type: "job.terminal" }>) {
  const result = exactJob(value, event.job, event.lifetime)
  if (!result.current) return unchanged(value, result.decision as Decision)
  if (result.current.state === "terminal") return unchanged(value, { type: "noop", reason: "settled" })
  return terminalJob(value, result.current, event.winner)
}

export function id<K extends IDKind>(kind: K, value: string): ID<K> {
  return value as ID<K>
}

export function make(input: { readonly instance: InstanceID; readonly sessions?: readonly SessionID[] }): State {
  const sessions = unique(input.sessions ?? [])
  const value: Model = {
    instance: input.instance,
    authorityRevision: 0n,
    sequences: { creation: 0n, repair: 0n, freeze: 0n },
    supervisor: { state: "running" },
    queue: [],
    tickets: [],
    operations: [],
    aliases: [],
    claims: [],
    epochs: sessions.map((session) => ({ session, epoch: 0n })),
    fences: [],
    leases: [],
    mutations: [],
    effects: [],
    pairs: [],
    jobs: [],
    armPermits: [],
    sessions,
    bindings: [],
  }
  normalize(value)
  return state(value)
}

export function step(state: State, event: Event): Step {
  const value = model(state)
  if (event.instance !== value.instance) return unchanged(value, { type: "rejected", reason: "wrong_instance" })
  const next = copy(value)
  if (event.type === "request") return request(next, event)
  if (event.type === "waiter.interrupt") return interrupt(next, event)
  if (event.type === "ticket.received") return received(next, event)
  if (event.type === "ticket.offer_failed") return offerFailed(next, event)
  if (event.type === "ticket.dequeued") return dequeued(next, event)
  if (event.type === "ticket.accept") return accept(next, event)
  if (event.type === "worker.registered") return workerRegistered(next, event)
  if (event.type === "worker.registration_failed") return registrationFailed(next, event)
  if (event.type === "worker.started") return workerStarted(next, event)
  if (event.type === "worker.exited") return workerExited(next, event)
  if (event.type === "supervisor.failed") return supervisorFailed(next)
  if (event.type === "dispose") return supervisorDisposed(next)
  if (event.type === "operation.claim") return claim(next, event)
  if (event.type === "operation.merge") return merge(next, event)
  if (event.type === "participant.observe") return participant(next, event)
  if (event.type === "view.require") return requireView(next, event)
  if (event.type === "operation.advance") return advance(next, event)
  if (event.type === "lease.reserve") return reserveLease(next, event)
  if (event.type === "lease.reuse") return reuseLease(next, event)
  if (event.type === "lease.bind") return bindLease(next, event)
  if (event.type === "lease.finish") return finishLease(next, event)
  if (event.type === "mutation.reserve") return reserveMutation(next, event)
  if (event.type === "mutation.activate") return activateMutation(next, event)
  if (event.type === "mutation.retire") return retireMutation(next, event)
  if (event.type === "effect.issue") return issueEffect(next, event)
  if (event.type === "effect.dispatch") return dispatchEffect(next, event)
  if (event.type === "effect.return") return returnEffect(next, event)
  if (event.type === "quiescence.prove") return prove(next, event)
  if (event.type === "planning.begin") return beginPlanning(next, event)
  if (event.type === "planning.return") return planningReturn(next, event)
  if (event.type === "writer.next") return nextPair(next, event)
  if (event.type === "pair.issue") return issuePair(next, event)
  if (event.type === "pair.return") return returnPair(next, event)
  if (event.type === "operation.fail") return failOperation(next, event)
  if (event.type === "release.prepare") return prepareRelease(next, event)
  if (event.type === "release.commit") return commitRelease(next, event)
  if (event.type === "waiter.delivered") return delivered(next, event)
  if (event.type === "cleanup") return cleanup(next, event)
  if (event.type === "job.start") return startJob(next, event)
  if (event.type === "job.extend") return extendJob(next, event)
  if (event.type === "job.bind") return bindJob(next, event)
  if (event.type === "job.permit") return permitJob(next, event)
  if (event.type === "job.registered") return registeredJob(next, event)
  if (event.type === "job.binder_failed") return binderFailed(next, event)
  if (event.type === "job.get") return getJob(next, event)
  if (event.type === "job.promote") return promoteJob(next, event)
  if (event.type === "job.wait_promotion") return waitPromotion(next, event)
  if (event.type === "job.wait") return waitJob(next, event)
  if (event.type === "job.observe") return observeJob(next, event)
  if (event.type === "job.deliver") return deliverJob(next, event)
  if (event.type === "job.cancel") return cancelJob(next, event)
  if (event.type === "job.terminal") return finishJob(next, event)
  const exhaustive: never = event
  return unchanged(next, exhaustive)
}

export function view(state: State): View {
  return copy(project(copy(model(state))))
}

// Admission-seam accessors. `view` deep-copies the whole model, which is far too costly for a
// guard on every prompt turn and Task start. These read exactly the two facts an admission seam
// needs and return fresh records, so no internal reference escapes.
export function fence(state: State, session: SessionID): FenceView | undefined {
  const current = model(state).fences.find((item) => item.session === session)
  if (!current) return undefined
  return { session: current.session, epoch: current.epoch, operation: current.operation, state: current.state }
}

export function sessionEpoch(state: State, session: SessionID): bigint {
  return model(state).epochs.find((item) => item.session === session)?.epoch ?? 0n
}

export function scan(state: State, operationID: OperationID): ScanCapture {
  const value = model(state)
  const current = operation(value, operationID)
  if (current) return copy(scancapture(value, current))
  return {
    operation: operationID,
    revision: 0n,
    claims: [],
    edges: [],
    participants: [],
    leases: [],
    mutations: [],
    effects: [],
    successors: [],
  }
}

export * as SessionClosureModel from "./model"
