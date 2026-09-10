import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Queue, Ref, Schema, Scope, Semaphore } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { SessionID } from "../schema"
import { SessionToolPartPermit } from "../toolpart-permit"
import { SessionClosureModel as Model } from "./model"
import { SessionClosurePorts as Ports } from "./ports"

export { LocationError } from "./ports"

export type Outcome = {
  readonly operation: Model.OperationID
  readonly view: Model.ViewID
}

export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionClosureError", {
  kind: Schema.Literals([
    "scope_incomplete",
    "quiescence_failed",
    "planning_failed",
    "record_failed",
    "closure_unavailable",
  ]),
  operation: Schema.String,
}) {}

// Raised when lower-level admission is declined. Reasons use the model's fence vocabulary plus
// `wrong_instance` for events addressed to another runtime.
export class AdmissionRefused extends Schema.TaggedErrorClass<AdmissionRefused>()("SessionClosureAdmissionRefused", {
  session: Schema.String,
  reason: Schema.Literals([
    "closing",
    "planning",
    "planning_failed_identity_missing",
    "freezing",
    "recording",
    "quiescence_failed",
    "record_failed",
    "closure_unavailable",
    "wrong_instance",
  ]),
}) {}

export type Admission =
  | {
      readonly type: "admitted"
      readonly lease: Model.LeaseID
      readonly epoch: bigint
      readonly instance: Model.InstanceID
    }
  | {
      readonly type: "fenced"
      readonly state: Model.FenceState
      readonly operation: Model.OperationID
      readonly epoch: bigint
    }
  /**
   * External reservations on a fenced session join the intersecting operation instead of being
   * suppressed. `release` completes when committed state drops the fence. Returning the adopted
   * lease lets the retry use the model's replace-once path instead of creating a fresh reservation.
   */
  | {
      readonly type: "joined"
      readonly lease: Model.LeaseID
      readonly state: Model.FenceState
      readonly operation: Model.OperationID
      readonly epoch: bigint
      readonly instance: Model.InstanceID
      readonly repair?: Model.RepairID
      readonly release: Effect.Effect<void>
    }

/**
 * Registered before executable setup and replaced once a Runner or shell takes ownership. The
 * deferred gives a landing fence an interruptible handle; a ScopeID alone is not signalable. This
 * covers plugin, template, prompt, command-expansion, and shell setup before a Runner exists.
 */
export type PreBindOwner = {
  readonly id: Model.ScopeID
  /** Completed by the coordinator when a fence intersects this owner's session. */
  readonly signal: Deferred.Deferred<void>
}

/** How an admission lease settled. */
export type LeaseDisposition = "retired" | "suppressed" | "failed"

/**
 * Causal provenance prevents a delayed continuation from reminting at a newer epoch. Omitting
 * `originEpoch` is safe only when reservation occurs before the waiter is scheduled, while the
 * observed and originating epochs are still the same.
 */
export type ContinuationProvenance = {
  readonly caller: SessionID
  readonly target: SessionID
  readonly originEpoch?: bigint
  readonly invocation?: {
    readonly job: Model.JobID
    readonly lifetime: Model.LifetimeID
    readonly sequence: bigint
  }
}

type ReserveInput = {
  readonly session: SessionID
  readonly origin: "external" | "internal"
  readonly retry: "initial" | "post_closure_external_retry"
  readonly source: string
  readonly owner: PreBindOwner
  /**
   * Reuse the adopted lease only for an external post-closure retry. A new id would take the
   * ordinary reservation path and bypass replace-once; ambient continuation reuse uses `ReuseInput`.
   */
  readonly lease?: Model.LeaseID
} & ({ readonly kind?: "pre_bind" } | ({ readonly kind: "continuation" } & ContinuationProvenance))

/**
 * Revalidate an existing continuation lease without registering another owner or minting another
 * lease. Refusal settles this same lease.
 */
type ReuseInput = {
  readonly session: SessionID
  readonly origin: "internal"
  readonly retry: "initial"
  readonly source: string
  readonly lease: Model.LeaseID
  readonly epoch: bigint
  readonly revalidate: "ambient_continuation"
}

export type AcquireInput = ReserveInput | ReuseInput

const isReuseInput = (input: AcquireInput): input is ReuseInput => "revalidate" in input

// Destructive mutations are rejected on fenced sessions rather than recorded as suppressed or joined.
export type MutationAdmission =
  | { readonly type: "reserved"; readonly mutation: Model.MutationID }
  | { readonly type: "refused"; readonly reason: "fenced" | "stale_epoch" | "duplicate" | "wrong_instance" }

export type ReserveMutationInput = {
  readonly sessions: readonly SessionID[]
  readonly kind: Model.MutationInput["kind"]
}

/**
 * These capabilities arrive per request because their adapters depend transitively on
 * `SessionClosure`. Putting them on `Ports` would close a layer cycle back to `SessionClosure`;
 * `LayerNodeTree` memoizes after recursion, so that cycle overflows instead of producing a useful
 * diagnostic. One concrete path is `SessionClosure -> Ports -> Discovery -> SessionRunState ->
 * SessionClosure`. `Ports.node` must therefore remain dependency-free.
 *
 * Late binding also gives production and tests one source. Missing capabilities never fall back to
 * instance state.
 */
export type RequestInput = {
  readonly root: SessionID
  readonly runState: Ports.RunStateCapability
  // Missing and enumerated-empty differ: only an empty enumeration proves no active work. Treating
  // absence as empty would manufacture a no-work result, so absence fails closed.
  readonly discovery?: Ports.DiscoveryCapability
  // Missing lineage leaves a proven path incomplete; it cannot make the proof unsound.
  readonly lineage?: Ports.LineageCapability
  // Consulted only after quiescence; absence degrades terminal outcomes to `unknown`.
  readonly toolPart?: Ports.ToolPartCapability
  /**
   * Kept in coordinator authority rather than forwarded to the driver; a driver that validates
   * sessions could widen its own scope. The driver enumerates evidence while the coordinator decides
   * which sessions belong to this instance. Absence fails closed.
   */
  readonly validateSession?: (session: Model.SessionID) => Effect.Effect<boolean>
  // Forwarded to `driver.command` because `plan.read` is external. Missing capability differs from
  // a resolved empty identity set.
  readonly planIdentity?: Ports.PlanIdentityCapability
  // Separate from identity because it reads row timestamps. Absence uses zero; later exact readback
  // still fails closed on collision.
  readonly highWater?: Ports.HighWaterCapability
  /** Request-borne record capability, forwarded only to `driver.command`. */
  readonly record?: Ports.RecordCapability
}

type RequestCapabilities = Omit<RequestInput, "root">

export interface Interface {
  readonly request: (input: RequestInput) => Effect.Effect<Outcome, Failure | Ports.LocationError>
  readonly view: Effect.Effect<Model.View, Ports.LocationError>
  readonly identity: Effect.Effect<Ports.RuntimeIdentity, Ports.LocationError>
  readonly acquire: (input: AcquireInput) => Effect.Effect<Admission, Ports.LocationError>
  readonly bind: (lease: Model.LeaseID, owner: Model.AdmissionOwner) => Effect.Effect<void, Ports.LocationError>
  readonly retire: (lease: Model.LeaseID, disposition?: LeaseDisposition) => Effect.Effect<void, Ports.LocationError>
  readonly reserveMutation: (input: ReserveMutationInput) => Effect.Effect<MutationAdmission, Ports.LocationError>
  readonly activateMutation: (mutation: Model.MutationID) => Effect.Effect<void, Ports.LocationError>
  readonly retireMutation: (mutation: Model.MutationID) => Effect.Effect<void, Ports.LocationError>
  /**
   * The coordinator supplies revisions it owns; the caller supplies the lease and epoch it observed.
   */
  readonly jobStart: (input: JobStartInput) => Effect.Effect<JobBindOutcome, Ports.LocationError>
  readonly jobExtend: (input: JobExtendInput) => Effect.Effect<JobBindOutcome, Ports.LocationError>
  /**
   * Compare-and-set between registry consumption and fence revocation. A successful consume also
   * transfers lease ownership to the job invocation. A false consume means revocation won and the
   * caller must produce no run effects.
   */
  readonly jobPermit: (permit: Model.ArmID, action: "consume" | "revoke") => Effect.Effect<boolean, Ports.LocationError>
  readonly jobRegistered: (input: JobRegisteredInput) => Effect.Effect<void, Ports.LocationError>
  readonly jobBinderFailed: (job: Model.JobID, lifetime: Model.LifetimeID) => Effect.Effect<void, Ports.LocationError>
  readonly jobCancel: (
    job: Model.JobID,
    lifetime: Model.LifetimeID,
    sequence?: bigint,
  ) => Effect.Effect<void, Ports.LocationError>
  /** Core's exact natural/cancelled lifetime winner, published before its waiters are released. */
  readonly jobTerminal: (input: JobTerminalInput) => Effect.Effect<void, Ports.LocationError>
}

export type JobStartInput = {
  readonly request: Model.RequestID
  readonly job: Model.JobID
  readonly lifetime: Model.LifetimeID
  readonly scope: Model.ScopeID
  readonly lease: Model.LeaseID
  readonly epoch: bigint
}

export type JobExtendInput = Omit<JobStartInput, "scope">

export type JobRegisteredInput = {
  readonly job: Model.JobID
  readonly lifetime: Model.LifetimeID
  readonly sequence: bigint
  readonly permit: Model.ArmID
}

export type JobTerminalInput = {
  readonly job: Model.JobID
  readonly lifetime: Model.LifetimeID
  readonly winner: "cancelled" | "completed" | "error"
}

/**
 * `joined` parks an extension on an arm attempt already in progress. The caller waits for that
 * shared attempt rather than retrying the bind.
 */
export type JobBindOutcome =
  | {
      readonly type: "arm_allowed"
      readonly permit: Model.ArmID
      readonly sequence: bigint
      readonly claim: Effect.Effect<boolean>
    }
  | { readonly type: "cancellation_owned" }
  | { readonly type: "rejected" }
  | { readonly type: "joined" }

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionClosure") {}

type Acceptance = "accepted" | "failed"
type StartDecision =
  | {
      readonly type: "opened"
      readonly opening: Extract<Model.Command, { readonly type: "worker.open" }>
    }
  | { readonly type: "failed" }

type TicketResource = {
  readonly offer: Extract<Model.Command, { readonly type: "ticket.offer" }>
  readonly acceptance: Deferred.Deferred<Acceptance>
  readonly start: Deferred.Deferred<StartDecision>
  readonly capabilities: RequestCapabilities
}

type WaiterResource = {
  readonly id: Model.WaiterID
  readonly view: Model.ViewID
  readonly done: Deferred.Deferred<Outcome, Failure>
}

type WorkerResource = {
  readonly id: Model.WorkerID
  readonly ticket: Model.TicketID
  readonly operation: Model.OperationID
  readonly repair: Model.RepairID
  readonly revision: bigint
  readonly capabilities: RequestCapabilities
  readonly control: Ports.Control
  fiber?: Fiber.Fiber<void, unknown>
}

type DescriptorResult = {
  readonly result: Ports.EffectResult
  readonly participant?: {
    readonly id: Model.ParticipantID
    readonly revision: bigint
  }
  readonly participantResult?: Ports.ParticipantResult
}

type EffectDescriptor = {
  readonly operation: Model.OperationID
  readonly repair: Model.RepairID
  readonly revision: bigint
  readonly run: Effect.Effect<DescriptorResult, unknown>
  readonly complete?: (result: DescriptorResult | undefined, accepted: boolean) => void
}

// Runtime handle for a pre-bind owner, carrying its session for fence selection.
type ScopeResource = {
  readonly session: Model.SessionID
  readonly signal: Deferred.Deferred<void>
}

// Runtime handle for a joined external admission awaiting fence release.
type ReleaseResource = {
  readonly session: Model.SessionID
  readonly deferred: Deferred.Deferred<void>
}

/**
 * Runtime CAS cell for an arm permit. The registry claims and the coordinator revokes the same
 * atomic cell, so neither side needs to nest its lock inside the other's. The model stores only the
 * permit name and its durable state.
 */
type PermitResource = {
  readonly session: Model.SessionID
  readonly claim: Effect.Effect<boolean>
  readonly revoke: Effect.Effect<boolean>
}

type JobActivity = {
  readonly active: number
  readonly cleanup: boolean
}

/**
 * `claim` and `revoke` close over one `Ref`, so only one transition from `issued` can win. Keeping
 * the cell local avoids coupling the model's LifetimeID to the registry's opaque token type; only
 * their compare-and-set semantics need to agree.
 */
const permitCell = (session: Model.SessionID) =>
  Effect.map(
    Ref.make<"issued" | "consumed" | "revoked">("issued"),
    (state): PermitResource => ({
      session,
      claim: Ref.modify(state, (current) => [current === "issued", current === "issued" ? "consumed" : current]),
      revoke: Ref.modify(state, (current) => [current === "issued", current === "issued" ? "revoked" : current]),
    }),
  )

type Runtime = {
  readonly identity: Ports.RuntimeIdentity
  readonly lock: Semaphore.Semaphore
  readonly scope: Scope.Closeable
  readonly queue: Queue.Queue<Extract<Model.Command, { readonly type: "ticket.offer" }>>
  readonly ports: Ports.RuntimePorts
  /**
   * Mint-only capability. Consumers receive a non-issuing interface, preventing downstream minting
   * by type. It stays off RuntimePorts to preserve Ports.node's dependency-free layer boundary and
   * is threaded through the per-instance Runtime instead.
   */
  readonly toolPartIssuer: SessionToolPartPermit.IssuerInterface
  readonly participants: ReadonlyMap<Model.ParticipantID, Ports.Participant>
  /**
   * Process-local identity per live `(Session, epoch)`. Operation ids can change during merging, so
   * the epoch rather than the operation is the stable generation boundary. Attachment snapshots use
   * the same object as a weak key.
   */
  readonly participantFences: Map<Model.SessionID, { readonly epoch: bigint; readonly ref: Ports.ParticipantFenceRef }>
  readonly state: { value: Model.State }
  readonly tickets: Map<Model.TicketID, TicketResource>
  readonly waiters: Map<Model.WaiterID, WaiterResource>
  readonly workers: Map<Model.WorkerID, WorkerResource>
  readonly effects: Map<Model.EffectID, EffectDescriptor>
  /** Signalable pre-bind owners keyed by the ScopeID stored in the pure model. */
  readonly scopes: Map<Model.ScopeID, ScopeResource>
  /**
   * Owners selected under the lock and signalled after its release. Inline completion could resume
   * a finalizer that re-enters the coordinator and deadlocks on the same semaphore. Keeping the
   * selection and signalling in separate phases makes re-entry safe by construction.
   */
  readonly pending: Set<Model.ScopeID>
  /** External admissions awaiting fence release, keyed by adopted lease to prevent overwrite. */
  readonly releases: Map<Model.LeaseID, ReleaseResource>
  /** Joined admissions to wake outside the authority lock before they re-enter `acquire`. */
  readonly released: Set<Deferred.Deferred<void>>
  /** Arm permit cells retained only while they can still decide claim versus revocation. */
  readonly permits: Map<Model.ArmID, PermitResource>
  /**
   * Bind outcomes still reading terminal state. The live counter defers compaction when a physical
   * terminal lands between event application and the outcome read. Without it, a real cancellation
   * could be compacted into an unexplained rejection.
   */
  readonly jobs: Map<Model.JobID, Map<Model.LifetimeID, JobActivity>>
  /** Permits selected under the lock and revoked after release to avoid recursive lock acquisition. */
  readonly revoking: Set<Model.ArmID>
  control: Ports.Control
  disposing: boolean
  supervisor?: Fiber.Fiber<void, unknown>
}

type RuntimeDraft = Omit<Runtime, "control">

type EventInput = Model.Event extends infer Event
  ? Event extends { readonly instance: Model.InstanceID }
    ? Omit<Event, "instance">
    : never
  : never

const scoped = <T extends EventInput>(runtime: Runtime, event: T): Extract<Model.Event, { readonly type: T["type"] }> =>
  ({ ...event, instance: runtime.identity.instance }) as unknown as Extract<Model.Event, { readonly type: T["type"] }>

const key = (input: {
  readonly directory: string
  readonly worktree: string
  readonly project: string
  readonly workspace: string
}) => `${input.workspace}\u0000${input.project}\u0000${input.worktree}\u0000${input.directory}`

const participantFenceRef = () => Object.freeze(Object.create(null)) as Ports.ParticipantFenceRef

type ParticipantFenceResource = { readonly epoch: bigint; readonly ref: Ports.ParticipantFenceRef }

/** Project the pure model's live `(Session, epoch)` fences into process-local identities. */
export function reconcileParticipantFences(
  resources: Map<Model.SessionID, ParticipantFenceResource>,
  fences: readonly Model.FenceView[],
) {
  const live = new Set(fences.map((item) => item.session))
  for (const fence of fences) {
    const current = resources.get(fence.session)
    if (current?.epoch === fence.epoch) continue
    resources.set(fence.session, { epoch: fence.epoch, ref: participantFenceRef() })
  }
  for (const session of resources.keys()) {
    if (!live.has(session)) resources.delete(session)
  }
}

const actualIdentity = Effect.gen(function* () {
  const instance = yield* InstanceState.context
  const workspace = String(yield* InstanceState.workspaceID)
  return key({
    directory: instance.directory,
    worktree: instance.worktree,
    project: instance.project.id,
    workspace,
  })
})

const validate = (runtime: Runtime) =>
  Effect.gen(function* () {
    const actual = yield* actualIdentity
    const expected = key(runtime.identity)
    if (actual === expected) return
    return yield* Effect.fail(new Ports.LocationError({ expected, actual }))
  })

// Mutation and the out-of-lock drain are one uninterruptible publication. The semaphore is released
// before `flush`, allowing resumed finalizers to re-enter without deadlock while still preventing an
// interrupt between fence commit and its revocation drain.
const locked = <A>(runtime: Runtime, run: () => A) =>
  Effect.uninterruptible(
    runtime.lock
      .withPermits(1)(Effect.sync(run))
      .pipe(Effect.tap(() => flush(runtime))),
  )

/**
 * Revoke the runtime cell first and update the model only if revocation wins. A prior claim is a
 * normal pre-fence admission and must not be rewritten as revoked; it is cancelled through the whole
 * job token instead.
 */
const revokePermit = (runtime: Runtime, permit: Model.ArmID) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const resource = runtime.permits.get(permit)
      if (!resource) return
      const won = yield* resource.revoke
      if (!won) return
      yield* apply(runtime, scoped(runtime, { type: "job.permit", permit, action: "revoke" }))
    }),
  )

/**
 * Claim the runtime cell and acknowledge consumption in the model as one effect. The registry calls
 * this outside its own lock, so registry and coordinator locks are sequential rather than nested.
 * Returning the bare CAS would leave the model in `issued` after the runtime cell became consumed.
 */
const consumePermit = (runtime: Runtime, permit: Model.ArmID, cell: PermitResource) =>
  Effect.uninterruptible(
    cell.claim.pipe(
      Effect.flatMap((won) =>
        won === false
          ? Effect.succeed(false)
          : apply(runtime, scoped(runtime, { type: "job.permit", permit, action: "consume" })).pipe(Effect.as(true)),
      ),
    ),
  )

/**
 * A missing handle is a loss only while its lease remains `reserved`. Once bound, the Runner or
 * shell owns the work and `runtime.scopes` normally has no entry. Settling the lease as failed also
 * fails its operation atomically; failing the operation alone would leave a permanent blocker and
 * prevent future quiescence proofs.
 *
 * This snapshot may race settlement, so the model revalidates under the lock and no-ops if another
 * path already settled the lease.
 */
const ownerLost = (runtime: Runtime, scope: Model.ScopeID) =>
  Effect.gen(function* () {
    const lost = Model.view(runtime.state.value).leases.filter(
      (item) => item.owner?.type === "scope" && item.owner.id === scope && item.state === "reserved",
    )
    yield* Effect.logWarning("closure pre-bind owner lost before signalling", {
      scope,
      leases: lost.map((item) => item.id),
    })
    // Apply sequentially so each failure's waiter-delivery commands are interpreted.
    yield* Effect.forEach(lost, (item) => settleLease(runtime, item.id, "failed"), { discard: true })
  })

const flush = (runtime: Runtime) =>
  Effect.uninterruptible(
    Effect.suspend(() => {
      if (runtime.pending.size === 0 && runtime.released.size === 0 && runtime.revoking.size === 0) return Effect.void
      const due = [...runtime.pending]
      runtime.pending.clear()
      // Clear every set before effects run, so re-entry sees an empty drain instead of recursing.
      const revoked = [...runtime.revoking]
      runtime.revoking.clear()
      const woken = [...runtime.released]
      runtime.released.clear()
      return Effect.forEach(revoked, (permit) => revokePermit(runtime, permit), { discard: true }).pipe(
        Effect.andThen(
          Effect.forEach(woken, (deferred) => Deferred.succeed(deferred, undefined).pipe(Effect.asVoid), {
            discard: true,
          }),
        ),
        Effect.andThen(
          Effect.forEach(
            due,
            (scope) => {
              const resource = runtime.scopes.get(scope)
              // A reserved owner with no signalable handle can never be reached by the fence.
              if (!resource) return ownerLost(runtime, scope)
              // Signal without awaiting unwinding or imposing a timeout; an uninterruptible owner
              // remains pending and fenced.
              return Deferred.succeed(resource.signal, undefined).pipe(Effect.asVoid)
            },
            { discard: true },
          ),
        ),
      )
    }),
  )

const store = (runtime: Runtime, state: Model.State) => {
  runtime.state.value = state
  const view = Model.view(state)
  const active = new Set(
    view.effects
      .filter((effect) => effect.state === "issued" || effect.state === "in_flight")
      .map((effect) => effect.id),
  )
  for (const permit of runtime.effects.keys()) {
    if (!active.has(permit)) runtime.effects.delete(permit)
  }
  // Select live owners from the committed lease view.
  const fenced = new Set(view.fences.map((item) => item.session))
  // Project `(Session, epoch)` to a process-local object so operation merges preserve correlation.
  // A changed epoch gets a new identity; releasing the fence drops the strong root.
  reconcileParticipantFences(runtime.participantFences, view.fences)
  // Session removal is not a fence, but it must signal continuation leases delivering into the
  // departing session. A settled mutation leaves the view, so every visible removal is still live.
  const departing = new Set<Model.SessionID>()
  for (const mutation of view.mutations) {
    if (mutation.kind !== "remove_session") continue
    for (const session of mutation.sessions) departing.add(session)
  }
  const live = new Set<Model.ScopeID>()
  for (const lease of view.leases) {
    // Continuations own the same signalable scope shape as pre-bind leases.
    if (lease.kind !== "pre_bind" && lease.kind !== "continuation") continue
    if (lease.state === "retired" || lease.state === "suppressed" || lease.state === "failed") continue
    const owner = lease.owner
    if (!owner || owner.type !== "scope") continue
    live.add(owner.id)
    // Fences stop pre-bind setup; removal stops continuations delivering into the session.
    if (lease.kind === "pre_bind" && fenced.has(lease.session)) runtime.pending.add(owner.id)
    if (lease.kind === "continuation" && departing.has(lease.session)) runtime.pending.add(owner.id)
  }
  // Drop handles once their leases settle.
  for (const scope of runtime.scopes.keys()) {
    if (!live.has(scope)) runtime.scopes.delete(scope)
  }
  // A fence revokes only `issued` permits. A consumed permit is already a pre-fence admission and
  // must be cancelled through its job rather than rewritten as revoked.
  const settled = new Set<Model.ArmID>()
  for (const permit of view.armPermits) {
    if (permit.state !== "issued") {
      settled.add(permit.id)
      continue
    }
    const owner = view.leases.find((item) => item.id === permit.lease)
    if (owner && fenced.has(owner.session)) runtime.revoking.add(permit.id)
  }
  // Reap cells on explicit settlement, not absence. A cell is published before its model event, so
  // absence is temporarily expected and cannot prove the cell is stale. Rejected binds clean up their
  // exact unpublished cell separately.
  for (const permit of runtime.permits.keys()) {
    if (settled.has(permit)) runtime.permits.delete(permit)
  }
  // Wake joined admissions from committed fence state so every release path is covered.
  for (const [lease, resource] of runtime.releases) {
    if (fenced.has(resource.session)) continue
    runtime.releases.delete(lease)
    runtime.released.add(resource.deferred)
  }
}

const reduce = (runtime: Runtime, event: Model.Event) =>
  locked(runtime, () => {
    const step = Model.step(runtime.state.value, event)
    store(runtime, step.state)
    return step
  })

const operation = (state: Model.State, operationID: Model.OperationID) =>
  Model.view(state).operations.find((item) => item.id === operationID)

const currentWorker = (runtime: Runtime, authority: Ports.WorkerAuthority | undefined) => {
  if (!authority) return false
  const current = operation(runtime.state.value, authority.operation)
  if (!current || current.driver.state !== "running" || current.driver.gate !== "opened") return false
  return (
    current.driver.ticket === authority.ticket &&
    current.driver.worker === authority.worker &&
    current.driver.repair === authority.repair &&
    current.driver.revision === authority.revision
  )
}

const responseEvent = (event: Ports.DriverEvent) =>
  event.type === "planning.return" || event.type === "pair.return" || event.type === "release.commit"

const stale = (runtime: Runtime): Model.Step => ({
  state: runtime.state.value,
  decision: { type: "noop", reason: "stale" },
  commands: [],
})

const repair = (current: Model.OperationView | undefined, fallback: string) => {
  if (!current) return Model.id("repair", fallback)
  if (current.driver.state !== "none") return current.driver.repair
  return current.repair ?? Model.id("repair", fallback)
}

const makeID = <K extends Model.IDKind>(kind: K) => Model.id(kind, `${kind}_${crypto.randomUUID()}`)

function interpretAll(runtime: Runtime, commands: readonly Model.Command[]): Effect.Effect<void> {
  return Effect.forEach(commands, (command) => interpret(runtime, command), {
    concurrency: "unbounded",
    discard: true,
  })
}

const retentionCommands = (commands: readonly Model.Command[]) =>
  commands.filter((command) => command.type === "job.close" || command.type === "job.cleanup")

const ordinaryCommands = (commands: readonly Model.Command[]) =>
  commands.filter((command) => command.type !== "job.close" && command.type !== "job.cleanup")

function apply(runtime: Runtime, event: Model.Event): Effect.Effect<Model.Step> {
  return Effect.gen(function* () {
    // Commit retention acknowledgements under the same mask so terminal state cannot become visible
    // before cleanup has an owner. Ordinary external commands remain interruptible afterward.
    const step = yield* Effect.uninterruptible(
      reduce(runtime, event).pipe(Effect.tap((result) => interpretAll(runtime, retentionCommands(result.commands)))),
    )
    yield* interpretAll(runtime, ordinaryCommands(step.commands))
    return step
  })
}

const settleLease = (runtime: Runtime, lease: Model.LeaseID, state: LeaseDisposition) =>
  Effect.uninterruptible(
    apply(runtime, scoped(runtime, { type: "lease.finish", lease, state })).pipe(
      Effect.andThen(apply(runtime, scoped(runtime, { type: "cleanup", lease }))),
      Effect.asVoid,
    ),
  )

const beginJobOutcome = (runtime: Runtime, job: Model.JobID, lifetime: Model.LifetimeID) =>
  locked(runtime, () => {
    const lifetimes = runtime.jobs.get(job) ?? new Map<Model.LifetimeID, JobActivity>()
    const current = lifetimes.get(lifetime)
    lifetimes.set(lifetime, { active: (current?.active ?? 0) + 1, cleanup: current?.cleanup ?? false })
    runtime.jobs.set(job, lifetimes)
  })

const trackJobOutcome = <A, E, R>(
  runtime: Runtime,
  job: Model.JobID,
  lifetime: Model.LifetimeID,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.uninterruptibleMask((restore) =>
    beginJobOutcome(runtime, job, lifetime).pipe(
      Effect.andThen(restore(effect)),
      Effect.ensuring(finishJobOutcome(runtime, job, lifetime)),
    ),
  )

const commitJobCleanup = (runtime: Runtime, job: Model.JobID, lifetime: Model.LifetimeID) => {
  const step = Model.step(runtime.state.value, scoped(runtime, { type: "cleanup", job, lifetime }))
  store(runtime, step.state)
  return step
}

const finishJobOutcome = (runtime: Runtime, job: Model.JobID, lifetime: Model.LifetimeID) =>
  Effect.gen(function* () {
    const step = yield* locked(runtime, () => {
      const lifetimes = runtime.jobs.get(job)
      const current = lifetimes?.get(lifetime)
      if (!lifetimes || !current) return
      if (current.active > 1) {
        lifetimes.set(lifetime, { ...current, active: current.active - 1 })
        return
      }
      lifetimes.delete(lifetime)
      if (lifetimes.size === 0) runtime.jobs.delete(job)
      if (!current.cleanup) return
      return commitJobCleanup(runtime, job, lifetime)
    })
    if (step) yield* interpretAll(runtime, step.commands)
  })

function runJobClose(
  runtime: Runtime,
  command: Extract<Model.Command, { readonly type: "job.close" | "job.cleanup" }>,
) {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      // Revoke each runtime cell before erasing its model permit. If a concurrent claim wins, its
      // consume event observes the terminal job and emits a fresh close instead of losing cleanup.
      const permits = yield* locked(runtime, () =>
        Model.view(runtime.state.value).armPermits.filter(
          (item) => item.job === command.job && item.lifetime === command.lifetime && item.state === "issued",
        ),
      )
      yield* Effect.forEach(
        permits,
        (permit) =>
          Effect.gen(function* () {
            const resource = yield* locked(runtime, () => runtime.permits.get(permit.id))
            if (!resource) return
            if (!(yield* resource.revoke)) return
            yield* apply(runtime, scoped(runtime, { type: "cleanup", permit: permit.id }))
          }),
        { discard: true },
      )

      const step = yield* locked(runtime, () => {
        const lifetimes = runtime.jobs.get(command.job)
        const current = lifetimes?.get(command.lifetime)
        if (!lifetimes || !current) return commitJobCleanup(runtime, command.job, command.lifetime)
        lifetimes.set(command.lifetime, { ...current, cleanup: true })
        return
      })
      if (step) yield* interpretAll(runtime, step.commands)
    }),
  )
}

const interruptWaiter = (runtime: Runtime, waiter: Model.WaiterID) =>
  Effect.gen(function* () {
    const step = yield* apply(runtime, scoped(runtime, { type: "waiter.interrupt", waiter }))
    yield* locked(runtime, () => runtime.waiters.delete(waiter))
    return step
  })

function deliver(runtime: Runtime, command: Extract<Model.Command, { readonly type: "waiter.deliver" }>) {
  return Effect.gen(function* () {
    if (runtime.ports.hooks.beforeWaiterDelivery) yield* runtime.ports.hooks.beforeWaiterDelivery(command)
    yield* Effect.forEach(
      command.waiters,
      (waiterID) =>
        Effect.gen(function* () {
          const target = yield* locked(runtime, () => runtime.waiters.get(waiterID))
          if (target) {
            const result = { operation: command.operation, view: target.view }
            if (command.failure) {
              yield* Deferred.fail(
                target.done,
                new Failure({ kind: command.failure, operation: String(command.operation) }),
              ).pipe(Effect.asVoid)
            }
            if (!command.failure) yield* Deferred.succeed(target.done, result).pipe(Effect.asVoid)
          }
          yield* apply(
            runtime,
            scoped(runtime, {
              type: "waiter.delivered",
              delivery: command,
              waiter: waiterID,
            }),
          )
          yield* locked(runtime, () => runtime.waiters.delete(waiterID))
        }),
      { concurrency: "unbounded", discard: true },
    )
    if (runtime.ports.hooks.afterWaiterDelivery) yield* runtime.ports.hooks.afterWaiterDelivery(command)
    if (command.failure) return
    yield* apply(
      runtime,
      scoped(runtime, {
        type: "cleanup",
        operation: command.operation,
        revision: command.revision,
      }),
    )
  })
}

/**
 * Certify the current worker and mint its ToolPart authority in one critical section, eliminating a
 * validation-to-allocation gap. The synchronous mint performs no I/O, suspension, or coordinator
 * re-entry; registry resolution remains outside the lock. Returning both values together prevents
 * any coordinator path from minting without current-worker certification.
 */
const authorize = (
  runtime: Runtime,
  command: Extract<Model.Command, { readonly type: "driver.run" }>,
  minter: SessionToolPartPermit.Minter,
) =>
  locked(runtime, () => {
    const worker = runtime.workers.get(command.worker)
    if (!worker) return
    if (
      worker.operation !== command.operation ||
      worker.repair !== command.repair ||
      worker.revision !== command.revision
    )
      return
    return {
      worker,
      authority: minter.mint({
        instance: String(runtime.identity.instance),
        operation: String(command.operation),
      }),
    }
  })

function runDriver(runtime: Runtime, command: Extract<Model.Command, { readonly type: "driver.run" }>) {
  return Effect.gen(function* () {
    // Resolve the per-instance registry outside the lock; `authorize` mints inside the worker check.
    // `ensuring` revokes on every exit and waits for writes already admitted under the grant's gate,
    // so interruption cannot leave authority live.
    const minter = yield* runtime.toolPartIssuer.minter
    const authorized = yield* authorize(runtime, command, minter)
    if (!authorized) return
    const worker = authorized.worker
    // Spell fields explicitly so `validateSession`, the coordinator's scope authority, is never
    // forwarded to the driver.
    const authority = authorized.authority
    yield* runtime.ports.driver
      .run({
        command,
        control: worker.control,
        runState: worker.capabilities.runState,
        participants: [...runtime.participants.keys()],
        discovery: worker.capabilities.discovery,
        lineage: worker.capabilities.lineage,
        toolPart: worker.capabilities.toolPart,
        toolPartGrant: authority.grant,
      })
      .pipe(Effect.ensuring(authority.revoke))
  })
}

const externalOperation = (command: Ports.ExternalCommand) => {
  if (command.type === "pair.write") return command.candidate.operation
  if (command.type === "job.bind") return
  if (command.type === "job.register") return
  if (command.type === "job.run") return
  if (command.type === "job.close") return
  if (command.type === "job.cleanup") return
  return command.operation
}

const commandWorker = (runtime: Runtime, command: Ports.ExternalCommand) =>
  locked(runtime, () => {
    const operationID = externalOperation(command)
    if (!operationID) return
    const current = operation(runtime.state.value, operationID)
    if (!current || current.driver.state !== "running" || current.driver.gate !== "opened") return
    return runtime.workers.get(current.driver.worker)
  })

function runExternal(runtime: Runtime, command: Ports.ExternalCommand) {
  return Effect.gen(function* () {
    const operationID = externalOperation(command)
    const worker = yield* commandWorker(runtime, command)
    if (operationID && !worker) return
    yield* runtime.ports.driver.command({
      command,
      control: worker?.control ?? runtime.control,
      runState: worker?.capabilities.runState,
      // `plan.read` is external, so identity reaches the driver through this command path.
      planIdentity: worker?.capabilities.planIdentity,
      // High-water uses a separate adapter because it reads Message and Part row columns.
      highWater: worker?.capabilities.highWater,
      record: worker?.capabilities.record,
    })
  })
}

const returnEffect = (
  runtime: Runtime,
  command: Extract<Model.Command, { readonly type: "effect.run" }>,
  descriptor: EffectDescriptor,
  result: DescriptorResult,
) =>
  locked(runtime, () => {
    const returned = Model.step(
      runtime.state.value,
      scoped(runtime, { type: "effect.return", command, result: result.result }),
    )
    store(runtime, returned.state)
    if (returned.decision.type !== "applied" || result.result !== "success" || !result.participant)
      return { step: returned, participantAccepted: false }
    const current = operation(runtime.state.value, command.operation)
    const currentRepair = repair(current, `${command.operation}:stale-participant`)
    if (!current || current.id !== command.operation || currentRepair !== command.repair)
      return { step: returned, participantAccepted: false }
    const observed = Model.step(
      runtime.state.value,
      scoped(runtime, {
        type: "participant.observe",
        operation: command.operation,
        participant: result.participant.id,
        revision: result.participant.revision,
      }),
    )
    store(runtime, observed.state)
    return {
      step: {
        state: observed.state,
        decision: observed.decision,
        commands: [...returned.commands, ...observed.commands],
      } satisfies Model.Step,
      participantAccepted:
        observed.decision.type === "applied" ||
        (observed.decision.type === "noop" && observed.decision.reason === "duplicate"),
    }
  })

function runEffect(runtime: Runtime, command: Extract<Model.Command, { readonly type: "effect.run" }>) {
  return Effect.gen(function* () {
    if (runtime.ports.hooks.beforeEffectDispatch) yield* runtime.ports.hooks.beforeEffectDispatch(command)
    const claimed = yield* locked(runtime, () => {
      const installed = runtime.effects.get(command.permit)
      const dispatched = Model.step(runtime.state.value, scoped(runtime, { type: "effect.dispatch", command }))
      store(runtime, dispatched.state)
      const descriptor = dispatched.decision.type === "applied" ? installed : undefined
      if (!descriptor) runtime.effects.delete(command.permit)
      return { dispatched, descriptor, installed }
    })
    yield* interpretAll(runtime, claimed.dispatched.commands)
    if (!claimed.descriptor) {
      claimed.installed?.complete?.(undefined, false)
      return
    }
    const exit = yield* Effect.exit(claimed.descriptor.run)
    const result = Exit.isSuccess(exit) ? exit.value : ({ result: "failure" } as const)
    const returned = yield* returnEffect(runtime, command, claimed.descriptor, result)
    claimed.descriptor.complete?.(result, returned.participantAccepted)
    yield* interpretAll(runtime, returned.step.commands)
  })
}

const workerFinalizer = (runtime: Runtime, worker: WorkerResource) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      if (!runtime.disposing && runtime.ports.hooks.beforeWorkerExit) {
        const hook = runtime.ports.hooks.beforeWorkerExit({
          operation: worker.operation,
          ticket: worker.ticket,
          worker: worker.id,
          repair: worker.repair,
          revision: worker.revision,
        })
        yield* hook.pipe(Effect.catchCause(() => Effect.void))
      }
      const step = yield* reduce(
        runtime,
        scoped(runtime, {
          type: "worker.exited",
          operation: worker.operation,
          ticket: worker.ticket,
          worker: worker.id,
          repair: worker.repair,
          revision: worker.revision,
          disposal: runtime.disposing,
        }),
      )
      yield* locked(runtime, () => runtime.workers.delete(worker.id))
      yield* interpretAll(runtime, step.commands)
      if (runtime.ports.hooks.afterWorkerExit)
        yield* runtime.ports.hooks.afterWorkerExit({
          operation: worker.operation,
          ticket: worker.ticket,
          worker: worker.id,
          repair: worker.repair,
          revision: worker.revision,
          decision: step.decision,
        })
    }),
  )

const workerEffect = (runtime: Runtime, worker: WorkerResource, gate: Deferred.Deferred<StartDecision>) =>
  Effect.gen(function* () {
    const decision = yield* Deferred.await(gate)
    if (decision.type === "failed") return
    yield* apply(runtime, scoped(runtime, { type: "worker.started", opening: decision.opening }))
  }).pipe(Effect.ensuring(workerFinalizer(runtime, worker)))

const registrationFailure = (
  runtime: Runtime,
  registration: Extract<Model.Command, { readonly type: "worker.register" }>,
  ticket: TicketResource | undefined,
) =>
  Effect.gen(function* () {
    const step = yield* apply(runtime, scoped(runtime, { type: "worker.registration_failed", registration }))
    if (ticket) {
      yield* Deferred.succeed(ticket.start, { type: "failed" }).pipe(Effect.asVoid)
      yield* locked(runtime, () => {
        if (runtime.tickets.get(registration.ticket) === ticket) runtime.tickets.delete(registration.ticket)
      })
    }
    return step
  })

function registerWorker(runtime: Runtime, registration: Extract<Model.Command, { readonly type: "worker.register" }>) {
  return Effect.gen(function* () {
    const ticket = yield* locked(runtime, () => runtime.tickets.get(registration.ticket))
    if (!ticket) {
      yield* registrationFailure(runtime, registration, undefined)
      return
    }
    const hook = runtime.ports.hooks.beforeWorkerRegister
      ? runtime.ports.hooks.beforeWorkerRegister(registration)
      : Effect.void
    const ready = yield* Effect.exit(hook)
    if (Exit.isFailure(ready)) {
      yield* registrationFailure(runtime, registration, ticket)
      return
    }
    const workerID = makeID("worker")
    const authority: Ports.WorkerAuthority = Object.freeze({
      operation: registration.operation,
      ticket: registration.ticket,
      worker: workerID,
      repair: registration.repair,
      revision: registration.revision,
    })
    const worker: WorkerResource = {
      id: workerID,
      ticket: registration.ticket,
      operation: registration.operation,
      repair: registration.repair,
      revision: registration.revision,
      capabilities: ticket.capabilities,
      control: control(runtime, authority),
    }
    const fiber = yield* workerEffect(runtime, worker, ticket.start).pipe(
      Effect.forkIn(runtime.scope, { startImmediately: true }),
    )
    worker.fiber = fiber
    const promoted = yield* locked(runtime, () => {
      const step = Model.step(
        runtime.state.value,
        scoped(runtime, { type: "worker.registered", registration, worker: worker.id }),
      )
      store(runtime, step.state)
      if (step.decision.type === "applied") runtime.workers.set(worker.id, worker)
      return step
    })
    if (promoted.decision.type !== "applied") {
      yield* Deferred.succeed(ticket.start, { type: "failed" }).pipe(Effect.asVoid)
      yield* Fiber.interrupt(fiber)
      yield* registrationFailure(runtime, registration, ticket)
      return
    }
    yield* interpretAll(runtime, promoted.commands)
  })
}

function openWorker(runtime: Runtime, opening: Extract<Model.Command, { readonly type: "worker.open" }>) {
  return Effect.gen(function* () {
    if (runtime.ports.hooks.beforeWorkerOpen) yield* runtime.ports.hooks.beforeWorkerOpen(opening)
    const ticket = yield* locked(runtime, () => runtime.tickets.get(opening.ticket))
    if (!ticket) return
    yield* Deferred.succeed(ticket.start, { type: "opened", opening }).pipe(Effect.asVoid)
    yield* locked(runtime, () => {
      if (runtime.tickets.get(opening.ticket) === ticket) runtime.tickets.delete(opening.ticket)
    })
  })
}

/**
 * Decide from lease authority: missing, non-reserved, or stale leases reject; adopted or currently
 * fenced leases become cancellation-owned; everything else may arm. Check both operation and fence
 * because a lease reserved after the operation claim can be fenced without an operation stamp, while
 * an adopted lease can retain its operation after the direct fence lookup changes.
 */
const decideBind = (
  runtime: Runtime,
  command: Extract<Model.Command, { readonly type: "job.bind" }>,
):
  | { readonly type: "rejected" }
  | { readonly type: "cancellation_owned" }
  | { readonly type: "arm_allowed"; readonly session: Model.SessionID } => {
  const view = Model.view(runtime.state.value)
  const owner = view.leases.find((item) => item.id === command.lease)
  if (!owner || owner.state !== "reserved") return { type: "rejected" }
  if ((view.epochs.find((item) => item.session === owner.session)?.epoch ?? 0n) !== command.epoch)
    return { type: "rejected" }
  if (owner.operation || view.fences.some((item) => item.session === owner.session))
    return { type: "cancellation_owned" }
  return { type: "arm_allowed", session: owner.session }
}

/**
 * Apply the bind decision before the originating `apply` returns so callers can read it from the
 * committed view. Publish the permit cell before its model event; otherwise a fence in that window
 * could select an ArmID with nothing to revoke. Store reconciliation tolerates that temporary
 * cell-before-model ordering.
 */
function runJobBind(runtime: Runtime, command: Extract<Model.Command, { readonly type: "job.bind" }>) {
  return Effect.gen(function* () {
    const decision = yield* locked(runtime, () => decideBind(runtime, command))
    if (decision.type !== "arm_allowed") {
      yield* apply(runtime, scoped(runtime, { type: "job.bind", binding: command, decision: { type: decision.type } }))
      return
    }
    const permit = makeID("arm")
    const cell = yield* permitCell(decision.session)
    const reap = locked(runtime, () => {
      const current = Model.view(runtime.state.value).armPermits.find((item) => item.id === permit)
      if (current?.state === "issued") return
      if (runtime.permits.get(permit) === cell) runtime.permits.delete(permit)
    })
    // Publication and model acknowledgement form one bracket. On exit, absence is decisive for this
    // exact bind even though generic reconciliation cannot reap cells merely because they are absent.
    yield* Effect.uninterruptible(
      locked(runtime, () => runtime.permits.set(permit, cell)).pipe(
        Effect.andThen(
          apply(
            runtime,
            scoped(runtime, { type: "job.bind", binding: command, decision: { type: "arm_allowed", permit } }),
          ),
        ),
        Effect.ensuring(reap),
      ),
    )
  })
}

/**
 * Complete the arm attempt through the model's command/event path rather than leaking coordinator
 * protocol into core. Preserve the registration unchanged because the model revalidates its exact
 * permit coordinates.
 */
function runJobRegister(runtime: Runtime, command: Extract<Model.Command, { readonly type: "job.register" }>) {
  return apply(runtime, scoped(runtime, { type: "job.registered", registration: command })).pipe(Effect.asVoid)
}

/**
 * Revalidate the candidate against committed state and mint its PairID under the authority lock.
 * Unlike an ArmID, a PairID has no runtime CAS cell: the committed in-flight PairView is the permit,
 * so adding another cell would create a second authority source. The storage command runs only after
 * the lock is released.
 */
function runPairCandidate(runtime: Runtime, command: Extract<Model.Command, { readonly type: "pair.candidate" }>) {
  return Effect.gen(function* () {
    const issued = yield* locked(runtime, () => {
      const permit = makeID("pair")
      const step = Model.step(runtime.state.value, scoped(runtime, { type: "pair.issue", candidate: command, permit }))
      store(runtime, step.state)
      return step
    })
    yield* interpretAll(runtime, issued.commands)
  })
}

function interpret(runtime: Runtime, command: Model.Command): Effect.Effect<void> {
  if (command.type === "ticket.offer") return Effect.die(new Error("ticket.offer escaped its request owner"))
  if (command.type === "job.bind") return runJobBind(runtime, command)
  if (command.type === "job.register") return runJobRegister(runtime, command)
  if (command.type === "job.close" || command.type === "job.cleanup") return runJobClose(runtime, command)
  if (command.type === "pair.candidate") return runPairCandidate(runtime, command)
  if (command.type === "worker.register") return registerWorker(runtime, command)
  if (command.type === "worker.open") return openWorker(runtime, command)
  if (command.type === "driver.run") return runDriver(runtime, command)
  if (command.type === "waiter.deliver") return deliver(runtime, command)
  if (command.type === "effect.run") return runEffect(runtime, command)
  return runExternal(runtime, command)
}

const failGates = (tickets: readonly TicketResource[]) =>
  Effect.forEach(
    tickets,
    (ticket) =>
      Effect.all([
        Deferred.succeed(ticket.acceptance, "failed"),
        Deferred.succeed(ticket.start, { type: "failed" }),
      ]).pipe(Effect.asVoid),
    { concurrency: "unbounded", discard: true },
  )

const supervisorExit = (runtime: Runtime, ready: Deferred.Deferred<void>) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      if (runtime.disposing) return
      const failed = yield* locked(runtime, () => {
        const step = Model.step(runtime.state.value, scoped(runtime, { type: "supervisor.failed" }))
        store(runtime, step.state)
        return { step, tickets: Array.from(runtime.tickets.values()) }
      })
      yield* failGates(failed.tickets)
      yield* locked(runtime, () => runtime.tickets.clear())
      yield* interpretAll(runtime, failed.step.commands)
      yield* Deferred.succeed(ready, undefined).pipe(Effect.asVoid)
    }),
  )

const supervisor = (runtime: Runtime, ready: Deferred.Deferred<void>) =>
  Effect.gen(function* () {
    if (runtime.ports.hooks.supervisorReady) yield* runtime.ports.hooks.supervisorReady(runtime.identity)
    yield* Deferred.succeed(ready, undefined)
    yield* Effect.gen(function* () {
      if (runtime.ports.hooks.beforeSupervisorTake) yield* runtime.ports.hooks.beforeSupervisorTake(runtime.identity)
      const offer = yield* Queue.take(runtime.queue)
      const ticket = yield* locked(runtime, () => runtime.tickets.get(offer.ticket))
      if (!ticket) return
      const acceptance = yield* Deferred.await(ticket.acceptance)
      if (acceptance === "failed") return
      yield* apply(runtime, scoped(runtime, { type: "ticket.dequeued", offer }))
    }).pipe(Effect.forever)
  }).pipe(Effect.ensuring(supervisorExit(runtime, ready)))

const dispose = (runtime: Runtime) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const disposed = yield* locked(runtime, () => {
        runtime.disposing = true
        const step = Model.step(runtime.state.value, scoped(runtime, { type: "dispose" }))
        store(runtime, step.state)
        return { step, tickets: Array.from(runtime.tickets.values()) }
      })
      yield* failGates(disposed.tickets)
      yield* locked(runtime, () => runtime.tickets.clear())
      yield* interpretAll(runtime, disposed.step.commands)
      yield* Queue.shutdown(runtime.queue)
      yield* Scope.close(runtime.scope, Exit.void)
    }),
  )

const control = (runtime: RuntimeDraft, authority?: Ports.WorkerAuthority): Ports.Control => {
  const self = runtime as Runtime
  const transition: Ports.Control["transition"] = (event) =>
    validate(self).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const step = yield* Effect.uninterruptible(
            locked(self, () => {
              if (!responseEvent(event) && !currentWorker(self, authority)) return stale(self)
              const next = Model.step(self.state.value, { ...event, instance: self.identity.instance } as Model.Event)
              store(self, next.state)
              return next
            }).pipe(Effect.tap((result) => interpretAll(self, retentionCommands(result.commands)))),
          )
          yield* interpretAll(self, ordinaryCommands(step.commands))
          return step
        }),
      ),
    ) as Ports.Control["transition"] extends (event: infer _E) => infer Result ? Result : never

  const issueDescriptor = (input: {
    readonly operation: Model.OperationID
    readonly effect: "signal" | "participant" | "record_readback"
    readonly make: (input: {
      readonly operation: Model.OperationID
      readonly repair: Model.RepairID
      readonly revision: bigint
    }) => EffectDescriptor
  }) =>
    validate(self).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const issued = yield* locked(self, () => {
            if (!currentWorker(self, authority)) return stale(self)
            const current = operation(self.state.value, input.operation)
            if (!current || !authority) return stale(self)
            const repairID = authority.repair
            const revision = current.revision
            const permit = makeID("effect")
            const step = Model.step(
              self.state.value,
              scoped(self, {
                type: "effect.issue",
                permit,
                operation: input.operation,
                repair: repairID,
                revision,
                effect: input.effect,
              }),
            )
            store(self, step.state)
            if (step.decision.type === "applied")
              self.effects.set(permit, input.make({ operation: input.operation, repair: repairID, revision }))
            return step
          })
          yield* interpretAll(self, issued.commands)
          return issued
        }),
      ),
    )

  const issue: Ports.Control["issue"] = (input) =>
    issueDescriptor({
      operation: input.operation,
      effect: input.effect,
      make: (coordinates) => ({
        ...coordinates,
        run: input.run.pipe(Effect.map((result) => ({ result }))),
      }),
    })

  const claim: Ports.Control["claim"] = (input) =>
    validate(self).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const authorized = yield* locked(self, () => currentWorker(self, authority))
          if (!authorized) return stale(self)
          const sessions = [
            ...new Set(
              input.proofs.flatMap((proof) => {
                if (proof.value === "proven_connected")
                  return [
                    proof.root,
                    proof.active,
                    ...proof.path,
                    ...proof.edges.flatMap((edge) => [edge.owner, edge.child]),
                  ]
                if (proof.value === "root_anchored_incomplete")
                  return [proof.root, ...proof.path, ...proof.edges.flatMap((edge) => [edge.owner, edge.child])]
                if (proof.value === "proven_disjoint") return [proof.root, proof.active]
                return [proof.root]
              }),
            ),
          ]
          const known = yield* locked(
            self,
            () => new Set(Model.view(self.state.value).epochs.map((item) => item.session)),
          )
          // This request-borne capability avoids the SessionClosure layer cycle and remains
          // coordinator-only. Missing capability or worker state rejects unknown sessions.
          const validateSession = yield* locked(self, () =>
            authority ? self.workers.get(authority.worker)?.capabilities.validateSession : undefined,
          )
          const valid = yield* Effect.forEach(
            sessions,
            (session) => {
              if (known.has(session)) return Effect.succeed(true)
              if (!validateSession) return Effect.succeed(false)
              return validateSession(session)
            },
            { concurrency: "unbounded" },
          )
          const invalid = sessions.find((_, index) => valid[index] !== true)
          if (invalid)
            return yield* Effect.fail(
              new Ports.LocationError({ expected: key(self.identity), actual: `session:${invalid}` }),
            )
          const claimed = yield* locked(self, () => {
            if (!currentWorker(self, authority)) return stale(self)
            const current = operation(self.state.value, input.operation)
            if (!current || !authority) return stale(self)
            const repairID = authority.repair
            const revision = current.revision
            const signals = input.signals.map(() => makeID("effect"))
            const step = Model.step(
              self.state.value,
              scoped(self, {
                type: "operation.claim",
                operation: input.operation,
                repair: repairID,
                revision,
                proofs: input.proofs,
                signals,
              }),
            )
            store(self, step.state)
            if (step.decision.type === "applied")
              signals.forEach((permit, index) => {
                const run = input.signals[index]
                if (!run) return
                const emitted = step.commands.some(
                  (command) => command.type === "effect.run" && command.permit === permit,
                )
                if (!emitted) return
                const descriptor: EffectDescriptor = {
                  operation: input.operation,
                  repair: repairID,
                  revision: revision + 1n,
                  run: run.pipe(Effect.map((result) => ({ result }))),
                }
                const command = step.commands.find(
                  (item): item is Extract<Model.Command, { readonly type: "effect.run" }> =>
                    item.type === "effect.run" && item.permit === permit,
                )
                if (!command) return
                self.effects.set(permit, { ...descriptor, revision: command.revision, repair: command.repair })
              })
            return step
          })
          const canonical = Model.view(claimed.state).operations.find(
            (item) => item.id === input.operation || item.aliases.includes(input.operation),
          )?.id
          const invoke = (callback: typeof input.beforeSignals) => {
            if (claimed.decision.type !== "applied" || !canonical || !callback) return Effect.void
            return callback(canonical)
          }
          // Capture participant fence truth after the claim commits but before signals dispatch.
          // Preserve callback failures without making this cross-module, lock-taking work
          // uninterruptible; signals still run before an ordinary callback failure is raised.
          const before = yield* Effect.exit(invoke(input.beforeSignals))
          yield* interpretAll(self, claimed.commands)
          // This callback may be skipped if signal interpretation defects; keep its duties retryable.
          const after = yield* Effect.exit(invoke(input.afterSignals))
          if (Exit.isFailure(before)) return yield* Effect.failCause(before.cause)
          if (Exit.isFailure(after)) return yield* Effect.failCause(after.cause)
          return claimed
        }),
      ),
    )

  const issueParticipant: Ports.Control["issueParticipant"] = (input) => {
    const participant = self.participants.get(input.participant)
    if (!participant) return Effect.die(new Error(`Unknown closure participant: ${input.participant}`))
    const exchange: { result?: Ports.ParticipantResult; accepted: boolean } = { accepted: false }
    return issueDescriptor({
      operation: input.operation,
      effect: "participant",
      make: (coordinates) => {
        const projected = Model.view(self.state.value)
        const current = projected.operations.find((item) => item.id === coordinates.operation)
        const participantRevision = current?.participants.find((item) => item.id === input.participant)?.revision ?? 0n
        const fenceInput = (subject: Model.SessionID) => {
          const fence = projected.fences.find(
            (item) => item.session === subject && item.operation === coordinates.operation,
          )
          const resource = self.participantFences.get(subject)
          if (!fence || !resource || resource.epoch !== fence.epoch) return undefined
          return { subject, ref: resource.ref } satisfies Ports.ParticipantFenceInput
        }
        const payload =
          input.kind === "claim" || input.kind === "observe"
            ? {
                fences: input.subjects.flatMap((subject) => {
                  const fence = fenceInput(subject)
                  return fence ? [fence] : []
                }),
              }
            : input.kind === "cancel"
              ? {
                  cancels: input.cancels.flatMap((item) => {
                    const fence = fenceInput(item.subject)
                    return fence ? [{ ...item, ref: fence.ref } satisfies Ports.ParticipantCancelFenceInput] : []
                  }),
                }
              : "payload" in input
                ? input.payload
                : undefined
        const call: Ports.ParticipantCall = {
          kind: input.kind,
          participant: input.participant,
          operation: coordinates.operation,
          repair: coordinates.repair,
          operationRevision: coordinates.revision,
          participantRevision,
          payload,
        }
        const run = Effect.suspend(() =>
          input.kind === "discover"
            ? participant.discover(call)
            : input.kind === "claim"
              ? participant.claim(call)
              : input.kind === "cancel"
                ? participant.cancel(call)
                : participant.observe(call),
        )
        return {
          ...coordinates,
          complete: (result, accepted) => {
            exchange.result = result?.participantResult
            exchange.accepted = accepted
          },
          run: run.pipe(
            Effect.map((result) => ({
              result: result.result,
              participant: { id: participant.id, revision: result.revision },
              participantResult: result,
            })),
          ),
        }
      },
    }).pipe(Effect.map((step) => ({ step, result: exchange.result, accepted: exchange.accepted })))
  }

  const view = validate(self).pipe(Effect.andThen(locked(self, () => Model.view(self.state.value))))
  const scan = (operationID: Model.OperationID) =>
    validate(self).pipe(Effect.andThen(locked(self, () => Model.scan(self.state.value, operationID))))

  return Object.freeze({ identity: self.identity, authority, transition, claim, issue, issueParticipant, view, scan })
}

const makeRuntime = (
  ctx: InstanceContext,
  services: Ports.Interface,
  toolPartIssuer: SessionToolPartPermit.IssuerInterface,
): Effect.Effect<Runtime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const workspace = String(yield* InstanceState.workspaceID)
    const identity: Ports.RuntimeIdentity = Object.freeze({
      instance: Model.id(
        "instance",
        key({
          directory: ctx.directory,
          worktree: ctx.worktree,
          project: ctx.project.id,
          workspace,
        }),
      ),
      directory: ctx.directory,
      worktree: ctx.worktree,
      project: ctx.project.id,
      workspace,
    })
    const lock = yield* Semaphore.make(1)
    const queue = yield* Queue.unbounded<Extract<Model.Command, { readonly type: "ticket.offer" }>>()
    const ports = yield* services.make(identity)
    const participantIDs = ports.participants.map((participant) => participant.id)
    if (new Set(participantIDs).size !== participantIDs.length)
      return yield* Effect.die(new Error(`Duplicate SessionClosure participant in ${identity.instance}`))
    const participants = new Map(
      ports.participants.map(
        (participant) =>
          [
            participant.id,
            Object.freeze({
              id: participant.id,
              discover: participant.discover,
              claim: participant.claim,
              cancel: participant.cancel,
              observe: participant.observe,
            } satisfies Ports.Participant),
          ] as const,
      ),
    )
    const scope = yield* Scope.make()
    const draft: RuntimeDraft = {
      identity,
      lock,
      scope,
      queue,
      ports,
      toolPartIssuer,
      participants,
      participantFences: new Map(),
      state: { value: Model.make({ instance: identity.instance }) },
      tickets: new Map(),
      waiters: new Map(),
      workers: new Map(),
      effects: new Map(),
      scopes: new Map(),
      pending: new Set(),
      releases: new Map(),
      released: new Set(),
      permits: new Map(),
      jobs: new Map(),
      revoking: new Set(),
      disposing: false,
    }
    const runtime = draft as Runtime
    runtime.control = control(draft)
    yield* Effect.addFinalizer(() => dispose(runtime))
    const ready = yield* Deferred.make<void>()
    runtime.supervisor = yield* supervisor(runtime, ready).pipe(Effect.forkIn(scope, { startImmediately: true }))
    yield* Deferred.await(ready)
    return runtime
  })

const reserve = (
  runtime: Runtime,
  input: RequestInput,
  resources: {
    readonly waiter: Deferred.Deferred<Outcome, Failure>
    readonly acceptance: Deferred.Deferred<Acceptance>
    readonly start: Deferred.Deferred<StartDecision>
  },
) =>
  locked(runtime, () => {
    const event = scoped(runtime, {
      type: "request",
      root: Model.id("session", String(input.root)),
      operation: makeID("operation"),
      view: makeID("view"),
      waiter: makeID("waiter"),
      ticket: makeID("ticket"),
      repair: makeID("repair"),
    })
    const step = Model.step(runtime.state.value, event)
    store(runtime, step.state)
    const projected = Model.view(step.state)
    const current = projected.operations.find((item) => item.waiters.some((waiter) => waiter.id === event.waiter))
    const waiterView = current?.waiters.find((waiter) => waiter.id === event.waiter)
    if (current && waiterView)
      runtime.waiters.set(event.waiter, {
        id: event.waiter,
        view: waiterView.view,
        done: resources.waiter,
      })
    const offer = step.commands.find(
      (command): command is Extract<Model.Command, { readonly type: "ticket.offer" }> =>
        command.type === "ticket.offer" && command.ticket === event.ticket,
    )
    if (offer)
      runtime.tickets.set(event.ticket, {
        offer,
        acceptance: resources.acceptance,
        start: resources.start,
        // Avoid spreading `root` onto the capability object handed to `driver.run`.
        capabilities: {
          runState: input.runState,
          discovery: input.discovery,
          lineage: input.lineage,
          toolPart: input.toolPart,
          validateSession: input.validateSession,
          planIdentity: input.planIdentity,
          highWater: input.highWater,
          record: input.record,
        },
      })
    return { step, event, offer, waiter: current && waiterView ? event.waiter : undefined }
  })

const clearReservation = (runtime: Runtime, waiter: Model.WaiterID, ticket: Model.TicketID, resource: TicketResource) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      yield* interruptWaiter(runtime, waiter)
      const retained = yield* locked(runtime, () => {
        const current = Model.view(runtime.state.value).tickets.find((item) => item.id === ticket)
        return current?.state === "reserved" && current.acceptance === "pending"
      })
      if (retained) {
        const offered = yield* Effect.exit(physicalOffer(runtime, resource.offer))
        if (Exit.isSuccess(offered) && offered.value) yield* acceptTicket(runtime, resource.offer, resource)
        if (Exit.isFailure(offered) || !offered.value) yield* offerFailed(runtime, resource.offer, resource)
        return
      }
      yield* Deferred.succeed(resource.acceptance, "failed").pipe(Effect.asVoid)
      yield* Deferred.succeed(resource.start, { type: "failed" }).pipe(Effect.asVoid)
      yield* locked(runtime, () => {
        if (runtime.tickets.get(ticket) === resource) runtime.tickets.delete(ticket)
      })
    }),
  )

const physicalOffer = (runtime: Runtime, offer: Extract<Model.Command, { readonly type: "ticket.offer" }>) => {
  const effect = Queue.offer(runtime.queue, offer)
  const offered = runtime.ports.hooks.offerTicket ? runtime.ports.hooks.offerTicket(offer, effect) : effect
  if (!runtime.ports.hooks.afterTicketOffer) return offered
  return offered.pipe(Effect.tap(() => runtime.ports.hooks.afterTicketOffer?.(offer) ?? Effect.void))
}

const acceptTicket = (
  runtime: Runtime,
  offer: Extract<Model.Command, { readonly type: "ticket.offer" }>,
  resource: TicketResource,
) =>
  Effect.gen(function* () {
    const settled = yield* locked(runtime, () => {
      const received = Model.step(runtime.state.value, scoped(runtime, { type: "ticket.received", offer }))
      store(runtime, received.state)
      if (received.decision.type !== "applied" && received.decision.type !== "noop")
        return { success: false, commands: received.commands }
      const accepted = Model.step(runtime.state.value, scoped(runtime, { type: "ticket.accept", offer }))
      store(runtime, accepted.state)
      return {
        success:
          accepted.decision.type === "applied" ||
          (accepted.decision.type === "noop" && accepted.decision.reason === "duplicate"),
        commands: [...received.commands, ...accepted.commands],
      }
    })
    yield* interpretAll(runtime, settled.commands)
    if (!settled.success) {
      yield* Deferred.succeed(resource.acceptance, "failed").pipe(Effect.asVoid)
      yield* Deferred.succeed(resource.start, { type: "failed" }).pipe(Effect.asVoid)
      yield* locked(runtime, () => {
        if (runtime.tickets.get(offer.ticket) === resource) runtime.tickets.delete(offer.ticket)
      })
      return false
    }
    yield* Deferred.succeed(resource.acceptance, "accepted").pipe(Effect.asVoid)
    if (runtime.ports.hooks.afterTicketAccept) yield* runtime.ports.hooks.afterTicketAccept(offer)
    return true
  })

const offerFailed = (
  runtime: Runtime,
  offer: Extract<Model.Command, { readonly type: "ticket.offer" }>,
  resource: TicketResource,
) =>
  Effect.gen(function* () {
    yield* Deferred.succeed(resource.acceptance, "failed").pipe(Effect.asVoid)
    yield* Deferred.succeed(resource.start, { type: "failed" }).pipe(Effect.asVoid)
    yield* apply(runtime, scoped(runtime, { type: "ticket.offer_failed", offer }))
    yield* locked(runtime, () => {
      if (runtime.tickets.get(offer.ticket) === resource) runtime.tickets.delete(offer.ticket)
    })
  })

const requestRuntime = (runtime: Runtime, input: RequestInput): Effect.Effect<Outcome, Failure | Ports.LocationError> =>
  validate(runtime).pipe(
    Effect.andThen(
      Effect.gen(function* () {
        const root = Model.id("session", String(input.root))
        // Validate the caller-named root before reservation when possible. If the capability is
        // absent, the claim seam still rejects every unknown session, so this precheck cannot widen scope.
        if (input.validateSession && !(yield* input.validateSession(root)))
          return yield* Effect.fail(
            new Ports.LocationError({ expected: key(runtime.identity), actual: `session:${root}` }),
          )
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const waiter = yield* Deferred.make<Outcome, Failure>()
            const acceptance = yield* Deferred.make<Acceptance>()
            const start = yield* Deferred.make<StartDecision>()
            const reserved = yield* reserve(runtime, input, { waiter, acceptance, start })
            if (runtime.ports.hooks.afterRequest)
              yield* runtime.ports.hooks.afterRequest({
                root: reserved.event.root,
                operation: reserved.event.operation,
                waiter: reserved.event.waiter,
                decision: reserved.step.decision,
              })
            if (!reserved.waiter)
              return yield* Effect.fail(
                new Failure({ kind: "closure_unavailable", operation: String(reserved.event.operation) }),
              )
            if (reserved.offer) {
              const resource = yield* locked(runtime, () =>
                runtime.tickets.get(reserved.offer?.ticket as Model.TicketID),
              )
              if (!resource)
                return yield* Effect.fail(
                  new Failure({ kind: "closure_unavailable", operation: String(reserved.event.operation) }),
                )
              const offered = yield* restore(physicalOffer(runtime, reserved.offer)).pipe(
                Effect.onInterrupt(() =>
                  clearReservation(
                    runtime,
                    reserved.waiter as Model.WaiterID,
                    reserved.offer?.ticket as Model.TicketID,
                    resource,
                  ),
                ),
              )
              if (!offered) yield* offerFailed(runtime, reserved.offer, resource)
              if (offered) yield* acceptTicket(runtime, reserved.offer, resource)
            }
            if (!reserved.offer) yield* interpretAll(runtime, reserved.step.commands)
            return yield* restore(Deferred.await(waiter)).pipe(
              Effect.onInterrupt(() => interruptWaiter(runtime, reserved.waiter as Model.WaiterID)),
            )
          }),
        )
      }),
    ),
  )

// Decide and reserve under one lock so no fence starts between them. The pre-read is required because
// `reserveLease` folds suppressed internal reservations into `applied`, losing the refusal reason.
const acquireLocked = (
  runtime: Runtime,
  input: ReserveInput,
  lease: Model.LeaseID,
  release: Deferred.Deferred<void>,
  stored: () => void,
) =>
  locked(runtime, (): { readonly admission: Admission; readonly commands: readonly Model.Command[] } => {
    const session = Model.id("session", input.session)
    // Reserve even when the pre-read sees a fence: the model must account for internal suppression
    // or external adoption. The pre-read preserves the refusal reason that the decision folds away,
    // while the post-step decision identifies which accounting branch occurred.
    const current = Model.fence(runtime.state.value, session)
    const epoch = Model.sessionEpoch(runtime.state.value, session)
    const step = Model.step(
      runtime.state.value,
      scoped(runtime, {
        type: "lease.reserve",
        // Continuation provenance prevents a delayed callback from reminting at a newer epoch.
        lease:
          input.kind === "continuation"
            ? {
                id: lease,
                session,
                epoch,
                source: input.source,
                origin: input.origin,
                retry: input.retry,
                kind: "continuation" as const,
                owner: { type: "scope" as const, id: input.owner.id },
                caller: Model.id("session", input.caller),
                target: Model.id("session", input.target),
                // Current is the origin unless the caller deliberately carries an older epoch.
                originEpoch: input.originEpoch ?? epoch,
                ...(input.invocation ? { invocation: input.invocation } : {}),
              }
            : {
                id: lease,
                session,
                epoch,
                source: input.source,
                origin: input.origin,
                retry: input.retry,
                kind: "pre_bind" as const,
                owner: { type: "scope" as const, id: input.owner.id },
              },
      }),
    )
    store(runtime, step.state)
    // The caller uses this synchronous witness to clean up a lease if any later Effect boundary
    // defects or is interrupted before the Admission handle is published.
    stored()
    // The pre-read decides whether a fence exists; `applied` may mean an internal lease was suppressed.
    if (current) {
      // Only the model decision distinguishes a suppressed internal lease from an adopted external
      // lease that must wait for release and retry.
      if (step.decision.type === "joined") {
        // Register under the authority lock so release cannot occur between the pre-read and waiter.
        runtime.releases.set(lease, { session, deferred: release })
        return {
          admission: {
            type: "joined",
            lease,
            state: current.state,
            operation: step.decision.operation ?? current.operation,
            epoch,
            instance: runtime.identity.instance,
            ...(step.decision.repair ? { repair: step.decision.repair } : {}),
            release: Deferred.await(release),
          },
          commands: step.commands,
        }
      }
      return {
        admission: { type: "fenced", state: current.state, operation: current.operation, epoch },
        commands: step.commands,
      }
    }
    if (step.decision.type !== "applied")
      return {
        admission: { type: "fenced", state: "closure_unavailable", operation: Model.id("operation", ""), epoch },
        commands: step.commands,
      }
    return {
      admission: { type: "admitted", lease, epoch, instance: runtime.identity.instance },
      commands: step.commands,
    }
  })

// Revalidate the same continuation lease under the claim lock. If the fence wins first, return a
// refusal so the observer suppresses that lease rather than minting or waiting on another. If this
// check wins first, the original pre-fence admission may complete.
const reuseLocked = (runtime: Runtime, input: ReuseInput) =>
  locked(runtime, (): { readonly admission: Admission; readonly commands: readonly Model.Command[] } => {
    const session = Model.id("session", input.session)
    const current = Model.fence(runtime.state.value, session)
    const step = Model.step(
      runtime.state.value,
      scoped(runtime, {
        type: "lease.reuse",
        lease: input.lease,
        session,
        epoch: input.epoch,
      }),
    )
    store(runtime, step.state)
    if (current)
      return {
        admission: { type: "fenced", state: current.state, operation: current.operation, epoch: input.epoch },
        commands: step.commands,
      }
    if (step.decision.type !== "applied")
      return {
        admission: {
          type: "fenced",
          state: "closure_unavailable",
          operation: Model.id("operation", ""),
          epoch: input.epoch,
        },
        commands: step.commands,
      }
    return {
      admission: {
        type: "admitted",
        lease: input.lease,
        epoch: input.epoch,
        instance: runtime.identity.instance,
      },
      commands: step.commands,
    }
  })

// Observe epochs and reserve under one lock so observed epochs cannot drift before reservation.
// Unlike lease reservation, mutation reservation returns explicit fenced and stale-epoch decisions,
// so no separate fence pre-read is needed.
const reserveMutationLocked = (runtime: Runtime, input: ReserveMutationInput, mutation: Model.MutationID) =>
  locked(runtime, (): { readonly admission: MutationAdmission; readonly commands: readonly Model.Command[] } => {
    const sessions = input.sessions.map((session) => Model.id("session", session))
    const epochs = sessions.map((session) => ({ session, epoch: Model.sessionEpoch(runtime.state.value, session) }))
    const step = Model.step(
      runtime.state.value,
      scoped(runtime, { type: "mutation.reserve", mutation: { id: mutation, sessions, epochs, kind: input.kind } }),
    )
    store(runtime, step.state)
    if (step.decision.type === "applied") return { admission: { type: "reserved", mutation }, commands: step.commands }
    // Fail closed on anything that is not an explicit reservation.
    const reason =
      step.decision.type === "rejected" && step.decision.reason === "stale_epoch" ? "stale_epoch" : ("fenced" as const)
    return { admission: { type: "refused", reason }, commands: step.commands }
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ports = yield* Ports.Service
    // Only the coordinator receives the issuing interface; consumers receive a type with no allocator.
    // Both interfaces resolve to the same per-instance registry.
    const toolPartIssuer = yield* SessionToolPartPermit.Issuer
    const state = yield* InstanceState.make((ctx) => makeRuntime(ctx, ports, toolPartIssuer))
    const request: Interface["request"] = (input) =>
      InstanceState.get(state).pipe(Effect.flatMap((runtime) => requestRuntime(runtime, input)))
    const view = InstanceState.get(state).pipe(
      Effect.flatMap((runtime) =>
        validate(runtime).pipe(Effect.andThen(locked(runtime, () => Model.view(runtime.state.value)))),
      ),
    )
    const identity = InstanceState.get(state).pipe(
      Effect.flatMap((runtime) => validate(runtime).pipe(Effect.as(runtime.identity))),
    )
    const acquire: Interface["acquire"] = (input) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) => {
          if (isReuseInput(input))
            return validate(runtime).pipe(
              Effect.andThen(reuseLocked(runtime, input)),
              Effect.tap((result) => interpretAll(runtime, result.commands)),
              Effect.map((result) => result.admission),
            )
          const lease = input.lease ?? makeID("lease")
          const progress = { stored: false }
          return validate(runtime).pipe(
            // Register the signalable handle before the lease so a landing fence cannot miss it.
            Effect.andThen(
              Effect.sync(() =>
                runtime.scopes.set(input.owner.id, {
                  session: Model.id("session", input.session),
                  signal: input.owner.signal,
                }),
              ),
            ),
            // Create the release handle before the lock so `acquireLocked` remains synchronous. An
            // external retry carries its adopted lease for the model's replace-once path.
            Effect.andThen(Deferred.make<void>()),
            Effect.flatMap((release) =>
              acquireLocked(runtime, input, lease, release, () => {
                progress.stored = true
              }).pipe(
                Effect.tap((result) => interpretAll(runtime, result.commands)),
                Effect.map((result) => result.admission),
              ),
            ),
            // If acquisition fails after storage but before publication, settle the still-local lease.
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? Effect.uninterruptible(
                    (progress.stored ? settleLease(runtime, lease, "failed") : Effect.void).pipe(
                      Effect.catchCause((cause) =>
                        Effect.logError("closure admission cleanup failed", {
                          lease,
                          session: input.session,
                          cause: Cause.pretty(cause),
                        }),
                      ),
                      Effect.ensuring(
                        Effect.sync(() => {
                          runtime.scopes.delete(input.owner.id)
                          runtime.releases.delete(lease)
                        }),
                      ),
                    ),
                  )
                : Effect.void,
            ),
          )
        }),
      )
    const bind: Interface["bind"] = (lease, owner) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          validate(runtime).pipe(Effect.andThen(apply(runtime, scoped(runtime, { type: "lease.bind", lease, owner })))),
        ),
        Effect.asVoid,
      )
    // The model rejects a second settlement, so a later fork cannot turn suppression into retirement.
    const retire: Interface["retire"] = (lease, disposition) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          validate(runtime).pipe(Effect.andThen(settleLease(runtime, lease, disposition ?? "retired"))),
        ),
        Effect.asVoid,
      )
    const reserveMutation: Interface["reserveMutation"] = (input) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          validate(runtime).pipe(
            Effect.andThen(
              reserveMutationLocked(runtime, input, makeID("mutation")).pipe(
                Effect.tap((result) => interpretAll(runtime, result.commands)),
                Effect.map((result) => result.admission),
              ),
            ),
          ),
        ),
      )
    const activateMutation: Interface["activateMutation"] = (mutation) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          validate(runtime).pipe(
            Effect.andThen(apply(runtime, scoped(runtime, { type: "mutation.activate", mutation }))),
          ),
        ),
        Effect.asVoid,
      )
    const retireMutation: Interface["retireMutation"] = (mutation) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          validate(runtime).pipe(
            Effect.andThen(apply(runtime, scoped(runtime, { type: "mutation.retire", mutation }))),
          ),
        ),
        Effect.asVoid,
      )
    /** Read coordinator-owned revisions instead of accepting caller guesses. */
    const jobCoordinates = (runtime: Runtime, lease: Model.LeaseID) =>
      locked(runtime, () => {
        const current = Model.view(runtime.state.value)
        const owner = current.leases.find((item) => item.id === lease)
        const holder = owner?.operation ? current.operations.find((item) => item.id === owner.operation) : undefined
        return { admissionRevision: current.authorityRevision, operationRevision: holder?.revision }
      })

    /**
     * Locate the permit by `(job, lifetime, lease)` because the model, not the caller, chooses the
     * sequence. Prefer a committed permit over a `joined` decision: an extension of an armed lifetime
     * can have both, while an extension arriving before arm has no permit and must rendezvous. Each
     * admission owns a distinct lease, making the lookup triple exact.
     */
    const jobOutcome = (
      runtime: Runtime,
      input: { readonly job: Model.JobID; readonly lifetime: Model.LifetimeID; readonly lease: Model.LeaseID },
      step: Model.Step,
    ) =>
      locked(runtime, (): JobBindOutcome => {
        const current = Model.view(runtime.state.value)
        const granted = current.armPermits.find(
          (item) =>
            item.job === input.job &&
            item.lifetime === input.lifetime &&
            item.lease === input.lease &&
            item.state === "issued",
        )
        const cell = granted ? runtime.permits.get(granted.id) : undefined
        if (granted && cell)
          return {
            type: "arm_allowed",
            permit: granted.id,
            sequence: granted.sequence,
            // Give the registry the consume effect that updates both the CAS cell and the model.
            claim: consumePermit(runtime, granted.id, cell),
          }
        if (step.decision.type === "joined") return { type: "joined" }
        const owner = current.jobs.find((item) => item.id === input.job && item.lifetime === input.lifetime)
        if (owner?.state === "terminal") return { type: "cancellation_owned" }
        if (runtime.jobs.get(input.job)?.get(input.lifetime)?.cleanup) return { type: "cancellation_owned" }
        return { type: "rejected" }
      })

    const jobStart: Interface["jobStart"] = (input) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          Effect.gen(function* () {
            yield* validate(runtime)
            return yield* trackJobOutcome(
              runtime,
              input.job,
              input.lifetime,
              jobCoordinates(runtime, input.lease).pipe(
                Effect.flatMap((revisions) =>
                  apply(
                    runtime,
                    scoped(runtime, {
                      type: "job.start",
                      request: input.request,
                      job: input.job,
                      lifetime: input.lifetime,
                      scope: input.scope,
                      lease: input.lease,
                      epoch: input.epoch,
                      admissionRevision: revisions.admissionRevision,
                      operationRevision: revisions.operationRevision,
                    }),
                  ),
                ),
                Effect.flatMap((step) => jobOutcome(runtime, input, step)),
              ),
            )
          }),
        ),
      )

    const jobExtend: Interface["jobExtend"] = (input) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          Effect.gen(function* () {
            yield* validate(runtime)
            return yield* trackJobOutcome(
              runtime,
              input.job,
              input.lifetime,
              jobCoordinates(runtime, input.lease).pipe(
                Effect.flatMap((revisions) =>
                  apply(
                    runtime,
                    scoped(runtime, {
                      type: "job.extend",
                      request: input.request,
                      job: input.job,
                      lifetime: input.lifetime,
                      lease: input.lease,
                      epoch: input.epoch,
                      admissionRevision: revisions.admissionRevision,
                      operationRevision: revisions.operationRevision,
                    }),
                  ),
                ),
                Effect.flatMap((step) => jobOutcome(runtime, input, step)),
              ),
            )
          }),
        ),
      )

    const jobPermit: Interface["jobPermit"] = (permit, action) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          validate(runtime).pipe(
            Effect.andThen(locked(runtime, () => runtime.permits.get(permit))),
            Effect.flatMap((cell) =>
              cell === undefined
                ? Effect.succeed(false)
                : action === "consume"
                  ? consumePermit(runtime, permit, cell)
                  : cell.revoke.pipe(
                      Effect.flatMap((won) =>
                        won === false
                          ? Effect.succeed(false)
                          : apply(runtime, scoped(runtime, { type: "job.permit", permit, action })).pipe(
                              Effect.as(true),
                            ),
                      ),
                    ),
            ),
          ),
        ),
      )

    const jobRegistered: Interface["jobRegistered"] = (input) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          validate(runtime).pipe(
            Effect.andThen(
              apply(
                runtime,
                scoped(runtime, {
                  type: "job.registered",
                  registration: {
                    type: "job.register",
                    job: input.job,
                    lifetime: input.lifetime,
                    sequence: input.sequence,
                    permit: input.permit,
                    instance: runtime.identity.instance,
                  },
                }),
              ),
            ),
          ),
        ),
        Effect.asVoid,
      )

    const jobBinderFailed: Interface["jobBinderFailed"] = (job, lifetime) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          validate(runtime).pipe(
            Effect.andThen(apply(runtime, scoped(runtime, { type: "job.binder_failed", job, lifetime }))),
          ),
        ),
        Effect.asVoid,
      )

    const jobCancel: Interface["jobCancel"] = (job, lifetime, sequence) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          validate(runtime).pipe(
            Effect.andThen(apply(runtime, scoped(runtime, { type: "job.cancel", job, lifetime, sequence }))),
          ),
        ),
        Effect.asVoid,
      )

    const jobTerminal: Interface["jobTerminal"] = (input) =>
      InstanceState.get(state).pipe(
        Effect.flatMap((runtime) =>
          validate(runtime).pipe(
            Effect.andThen(
              apply(
                runtime,
                scoped(runtime, {
                  type: "job.terminal",
                  job: input.job,
                  lifetime: input.lifetime,
                  winner: input.winner,
                }),
              ),
            ),
          ),
        ),
        Effect.asVoid,
      )

    return Service.of({
      request,
      view,
      identity,
      acquire,
      bind,
      retire,
      reserveMutation,
      activateMutation,
      retireMutation,
      jobStart,
      jobExtend,
      jobPermit,
      jobRegistered,
      jobBinderFailed,
      jobCancel,
      jobTerminal,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Ports.node, SessionToolPartPermit.node] })

export * as SessionClosure from "./coordinator"
