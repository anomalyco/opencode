import { EventV2 } from "@opencode-ai/core/event"
import { Clock, Effect, Exit } from "effect"
import { MessageID, PartID, SessionID } from "../schema"
import { SessionClosureModel as Model } from "./model"
import type { SessionClosurePorts as Ports } from "./ports"
import { SessionClosureProof as Proof } from "./proof"

/**
 * Discovers, fences, signals, and rescans until closure reaches a stable proof, then records it.
 * Runtime services arrive through `DriverRun`. Direct dependencies would close a layer cycle through
 * `SessionClosure`, and `LayerNodeTree.compile` recurses before it can diagnose that cycle.
 */

/** Empty evidence means no work; absent evidence must fail closed. */
export type Snapshot = {
  readonly runners: readonly Ports.RunnerEvidence[]
  readonly jobs: readonly Ports.JobEvidence[]
}

/** Non-terminal jobs may still create work even before they are running. */
const continuable = (state: Ports.JobEvidence["state"]) => state !== "terminal"

const busy = (evidence: Ports.RunnerEvidence) => evidence.running || evidence.shell

const session = (value: string) => Model.id("session", value)

const distinct = <T>(values: readonly T[]) => values.filter((item, index) => values.indexOf(item) === index)

/**
 * Active runners and non-terminal job targets become leaves. All jobs contribute edges so an idle
 * intermediate can connect an active descendant. Backward classification prevents connector edges
 * from creating signal authority. Partial edges remain available for bounded lineage completion.
 */
export const observe = (snapshot: Snapshot) => {
  const runners = snapshot.runners.filter(busy).map((item) => session(item.session))
  const active = snapshot.jobs.filter((item) => continuable(item.state))
  const leaves = distinct([...runners, ...active.flatMap((item) => (item.target ? [session(item.target)] : []))])
  const edges = snapshot.jobs
    .filter((item) => item.target !== undefined || item.owner !== undefined)
    .map((item) => ({
      id: Model.id("edge", `edge_job_${item.job}`),
      owner: item.owner ? session(item.owner) : undefined,
      child: item.target ? session(item.target) : undefined,
      taskMessage: item.taskMessage,
      taskCall: item.taskCall,
      job: Model.id("job", item.job),
      jobState: item.state,
    }))
  return { leaves, edges: edges as readonly Proof.EdgeObservation[] }
}

/**
 * Orders outcomes from weakest to strongest and reports the weakest handle. The receipt never proves
 * quiescence; a fresh rescan does, so an empty handle set is `absent` rather than vacuous success.
 */
const WEAKEST_FIRST = [
  "in_progress",
  "absent",
  "adopted",
  "interrupted",
] as const satisfies readonly Ports.SignalOutcome[]

const foldOutcome = (results: readonly Ports.SignalOutcome[]): Ports.SignalOutcome =>
  WEAKEST_FIRST.find((candidate) => results.includes(candidate)) ?? "absent"

/** Composes every handle that made a Session active; the following rescan proves quiescence. */
const signalFor = (
  target: Model.SessionID,
  snapshot: Snapshot,
  signalled: Map<Model.SessionID, Ports.SignalOutcome>,
) => {
  const runners = snapshot.runners.filter((item) => busy(item) && session(item.session) === target)
  const jobs = snapshot.jobs.filter((item) => continuable(item.state) && item.target && session(item.target) === target)
  const handles = [...runners.map((item) => item.interrupt), ...jobs.map((item) => item.interrupt)]
  return Effect.all(handles, { concurrency: "unbounded" }).pipe(
    Effect.map((results) => {
      if (!signalled.has(target)) signalled.set(target, foldOutcome(results))
      return "success" as const
    }),
  )
}

type Pass = {
  readonly proofs: readonly Model.ProofInput[]
  readonly active: readonly Model.SessionID[]
  readonly incomplete: readonly Model.SessionID[]
}

/** Mirrors the model's active set so each newly active Session receives exactly one signal. */
const pass = (
  proofs: readonly Model.ProofInput[],
  claimed: readonly Model.SessionID[],
  failed: readonly Model.SessionID[],
): Pass => ({
  proofs,
  active: distinct(
    proofs
      .filter((item) => item.value === "proven_connected")
      .map((item) => (item as Extract<Model.ProofInput, { readonly value: "proven_connected" }>).active),
  ).filter((item) => !claimed.includes(item)),
  incomplete: distinct(
    proofs.filter((item) => item.value === "root_anchored_incomplete").map((item) => item.root),
  ).filter((item) => !failed.includes(item)),
})

const currentOperation = (view: Model.View, operation: Model.OperationID) =>
  view.operations.find((item) => item.id === operation || item.aliases.includes(operation))

/** Exhaustion can fail a non-converging attempt but never substitute for a stable proof. */
const SWEEP_LIMIT = 256

/** Serializes the committed prefix; only an absent candidate completes normally. */
const recordPairs = (input: Pick<Ports.DriverCommand, "control">, operation: Model.OperationID) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < SWEEP_LIMIT; attempt++) {
      const step = yield* input.control.transition({ type: "writer.next", operation })
      if (!step.commands.some((command) => command.type === "pair.candidate")) return
    }

    const view = yield* input.control.view
    const current = currentOperation(view, operation)
    if (!current || current.phase.type !== "recording" || !current.repair) return
    yield* input.control.transition({
      type: "operation.fail",
      operation: current.id,
      repair: current.repair,
      revision: current.revision,
      failure: "record_failed",
    })
  })

const prepareRelease = (input: Pick<Ports.DriverCommand, "control">, operation: Model.OperationID) =>
  input.control.transition({ type: "release.prepare", operation }).pipe(Effect.asVoid)

/** Declares an unproved result before fiber exit can misclassify it as a worker defect. */
const unproved = (input: Ports.DriverRun, operation: Model.OperationID) =>
  Effect.gen(function* () {
    const view = yield* input.control.view
    const current = currentOperation(view, operation)
    if (!current || current.phase.type !== "quiescing" || !current.repair) return
    yield* input.control.transition({
      type: "operation.fail",
      operation: current.id,
      repair: current.repair,
      revision: current.revision,
      failure: "quiescence_failed",
    })
  })

type TaskCoordinate = { readonly message?: string; readonly call?: string }

/**
 * Participant results remain opaque except for exact tagged facts. Exchanges are keyed by proven
 * edge or subject; opaque ABA-safe lifetime handles never cross this seam. Only confirmed claims are
 * cancelled.
 */
const exchangeKey = (participant: Model.ParticipantID, ...parts: readonly string[]) =>
  // Tuple encoding avoids delimiter collisions between arbitrary IDs.
  JSON.stringify([participant, ...parts])

type EdgeCoverageFact = {
  readonly type: "participant_edge"
  readonly subject: string
  readonly owner: string
}

const edgeCoverageFacts = (value: unknown): readonly EdgeCoverageFact[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const fact = item as Record<string, unknown>
    if (Object.keys(fact).toSorted().join(",") !== "owner,subject,type") return []
    if (fact.type !== "participant_edge" || typeof fact.subject !== "string" || typeof fact.owner !== "string")
      return []
    return [fact as EdgeCoverageFact]
  })
}

type ParticipantClaimFact = {
  readonly type: "participant_claim"
  readonly subject: string
  readonly claim: "held"
}

const participantClaimFacts = (value: unknown): readonly ParticipantClaimFact[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const fact = item as Record<string, unknown>
    if (Object.keys(fact).toSorted().join(",") !== "claim,subject,type") return []
    if (fact.type !== "participant_claim" || typeof fact.subject !== "string" || fact.claim !== "held") return []
    return [fact as ParticipantClaimFact]
  })
}

/** Unmatched participant facts are ignored so they cannot widen proven scope. */
const discoverCoverage = (
  input: Ports.DriverRun,
  operation: Model.OperationID,
  edges: readonly { readonly owner?: Model.SessionID; readonly child?: Model.SessionID }[],
  asked: Set<string>,
  covered: Set<Model.SessionID>,
) =>
  Effect.gen(function* () {
    if (input.participants.length === 0) return
    const proven = edges.flatMap((edge) =>
      edge.owner !== undefined && edge.child !== undefined ? [{ owner: edge.owner, child: edge.child }] : [],
    )
    if (proven.length === 0) return
    yield* Effect.forEach(
      input.participants,
      (participant) =>
        Effect.gen(function* () {
          const pending = proven.filter((edge) => !asked.has(exchangeKey(participant, edge.owner, edge.child)))
          if (pending.length === 0) return
          const exchange = yield* input.control.issueParticipant({
            operation,
            participant,
            kind: "discover",
            payload: { edges: pending.map((edge) => ({ owner: edge.owner, child: edge.child })) },
          })
          if (!exchange.accepted || exchange.result?.result !== "success") return
          for (const edge of pending) asked.add(exchangeKey(participant, edge.owner, edge.child))
          for (const fact of edgeCoverageFacts(exchange.result.value)) {
            const subject = session(fact.subject)
            const owner = session(fact.owner)
            if (pending.some((edge) => edge.child === subject && edge.owner === owner)) covered.add(subject)
          }
        }),
      { discard: true },
    )
  })

/**
 * Runs after the fence but before interruption; either side would admit late work or lose
 * pre-cancellation state.
 */
const claimCovered = (
  input: Ports.DriverRun,
  operation: Model.OperationID,
  covered: ReadonlySet<Model.SessionID>,
  asked: Set<string>,
  held: Set<string>,
) =>
  Effect.gen(function* () {
    if (input.participants.length === 0 || covered.size === 0) return
    const targets = [...covered].toSorted()
    yield* Effect.forEach(
      input.participants,
      (participant) =>
        Effect.gen(function* () {
          const pending = targets.filter((subject) => !asked.has(exchangeKey(participant, subject)))
          if (pending.length === 0) return
          const exchange = yield* input.control.issueParticipant({
            operation,
            participant,
            kind: "claim",
            subjects: pending,
          })
          if (!exchange.accepted || exchange.result?.result !== "success") return
          for (const subject of pending) asked.add(exchangeKey(participant, subject))
          for (const fact of participantClaimFacts(exchange.result.value)) {
            const subject = session(fact.subject)
            if (pending.includes(subject)) held.add(exchangeKey(participant, subject))
          }
        }),
      { discard: true },
    )
  })

/** Core supplies the interrupt outcome; the participant reply adds no core evidence. */
const cancelHeld = (
  input: Ports.DriverRun,
  operation: Model.OperationID,
  held: ReadonlySet<string>,
  signalled: ReadonlyMap<Model.SessionID, Ports.SignalOutcome>,
  asked: Set<string>,
) =>
  Effect.gen(function* () {
    if (input.participants.length === 0 || signalled.size === 0) return
    yield* Effect.forEach(
      input.participants,
      (participant) =>
        Effect.gen(function* () {
          const pending = [...signalled.entries()].flatMap(([subject, outcome]) =>
            held.has(exchangeKey(participant, subject)) && !asked.has(exchangeKey(participant, subject))
              ? [{ subject, outcome }]
              : [],
          )
          if (pending.length === 0) return
          const exchange = yield* input.control.issueParticipant({
            operation,
            participant,
            kind: "cancel",
            cancels: pending,
          })
          if (!exchange.accepted || exchange.result?.result !== "success") return
          for (const item of pending) asked.add(exchangeKey(participant, item.subject))
        }),
      { discard: true },
    )
  })

type StateAtFenceFact = {
  readonly type: "state_at_fence"
  readonly subject: string
  readonly state: "yielded_with_outstanding_work"
}

const stateAtFenceFacts = (value: unknown): readonly StateAtFenceFact[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const fact = item as Record<string, unknown>
    if (Object.keys(fact).toSorted().join(",") !== "state,subject,type") return []
    if (
      fact.type !== "state_at_fence" ||
      typeof fact.subject !== "string" ||
      fact.state !== "yielded_with_outstanding_work"
    )
      return []
    return [fact as StateAtFenceFact]
  })
}

/** Any participant exchange changes accounting and requires a fresh proof, even if it adds no fact. */
const observeStateAtFence = (
  input: Ports.DriverRun,
  operation: Model.OperationID,
  observed: Set<string>,
  yielded: Set<Model.SessionID>,
) =>
  Effect.gen(function* () {
    const view = yield* input.control.view
    const current = currentOperation(view, operation)
    if (!current) return false
    const subjects = distinct(current.edges.map((edge) => edge.child)).toSorted()
    if (subjects.length === 0 || input.participants.length === 0) return false
    const pending = input.participants.filter(
      (participant) => !observed.has(JSON.stringify([participant, ...subjects])),
    )
    if (pending.length === 0) return false

    yield* Effect.forEach(
      pending,
      (participant) =>
        Effect.gen(function* () {
          const key = JSON.stringify([participant, ...subjects])
          const exchange = yield* input.control.issueParticipant({
            operation,
            participant,
            kind: "observe",
            subjects,
          })
          if (!exchange.accepted || exchange.result?.result !== "success") return
          observed.add(key)
          for (const fact of stateAtFenceFacts(exchange.result.value)) {
            const subject = session(fact.subject)
            if (subjects.includes(subject)) yielded.add(subject)
          }
        }),
      { discard: true },
    )
    return true
  })

/**
 * Reads and terminalizes ToolParts only after quiescence, when no live fiber can win the race between
 * the row read and conditional write. Missing data records `unknown`; outcomes accumulate so their
 * first proven winner survives re-proof. Fence-time participant state remains a separate fact.
 */
const capture = (
  input: Ports.DriverRun,
  operation: Model.OperationID,
  coordinates: ReadonlyMap<Model.EdgeID, TaskCoordinate>,
  outcomes: Map<Model.EdgeID, Ports.ToolPartOutcome>,
) =>
  Effect.gen(function* () {
    const view = yield* input.control.view
    const current = currentOperation(view, operation)
    if (!current) return

    for (const edge of current.edges) {
      if (outcomes.has(edge.id)) continue
      const coordinate = coordinates.get(edge.id)
      // Missing capability or coordinates mean the winner was not read, so it remains `unknown`.
      if (!input.toolPart || coordinate?.message === undefined || coordinate.call === undefined) {
        outcomes.set(edge.id, { outcome: "unknown" })
        continue
      }
      // Task ToolParts live in the owner's transcript, not the child Session.
      const found = yield* input.toolPart.terminalize({
        session: SessionID.make(String(edge.owner)),
        message: MessageID.make(coordinate.message),
        call: coordinate.call,
        grant: input.toolPartGrant,
      })
      outcomes.set(edge.id, found)
    }
  })

type Edge = Model.OperationView["edges"][number]

/** Tracks edge IDs so malformed cyclic evidence still terminates. */
const reach = (root: Model.SessionID, edges: readonly Edge[]): ReadonlySet<Model.EdgeID> => {
  const walk = (owner: Model.SessionID, seen: Set<Model.EdgeID>): Set<Model.EdgeID> =>
    edges
      .filter((edge) => edge.owner === owner && !seen.has(edge.id))
      .reduce((carried, edge) => {
        carried.add(edge.id)
        return walk(edge.child, carried)
      }, seen)
  return walk(root, new Set<Model.EdgeID>())
}

type Description = {
  readonly view: Model.ViewID
  readonly nodes: readonly Model.SessionID[]
  readonly facts: readonly Model.FactInput[]
}

/**
 * Emits unordered edge and child-self facts with one frozen outcome. Empty views emit nothing, and
 * direct roots receive no invented ToolPart outcome. State-at-fence facts require accepted participant
 * evidence.
 */
export const describe = (
  views: readonly Model.RootView[],
  edges: readonly Edge[],
  outcomes: ReadonlyMap<Model.EdgeID, Ports.ToolPartOutcome>,
  stateAtFence: ReadonlySet<Model.SessionID>,
): readonly Description[] =>
  views.map((view) => {
    const included = reach(view.root, edges)
    const scoped = edges.filter((edge) => included.has(edge.id))
    if (scoped.length === 0) return { view: view.id, nodes: [], facts: [] }
    const facts = scoped.flatMap((edge): readonly Model.FactInput[] => {
      const found = outcomes.get(edge.id)
      const outcome = found?.outcome ?? "unknown"
      const task = found?.part === undefined ? {} : { taskPart: Model.id("part", String(found.part)) }
      const yielded = stateAtFence.has(edge.child)
      return [
        {
          type: "edge",
          subject: edge.child,
          owner: edge.owner,
          child: edge.child,
          edge: edge.id,
          ...task,
          outcome,
          yielded,
        },
        { type: "self", subject: edge.child, outcome, yielded },
      ]
    })
    return {
      view: view.id,
      nodes: distinct([view.root, ...scoped.flatMap((edge) => [edge.owner, edge.child])]),
      facts: [...facts, { type: "root", root: view.root }],
    }
  })

export const make = (): Ports.Driver => ({
  command: (input) =>
    Effect.gen(function* () {
      if (input.command.type === "release.verify") {
        const command = input.command
        const view = yield* input.control.view
        const current = currentOperation(view, command.operation)
        const verified =
          input.record && current
            ? yield* input.record.verify({ command, operation: current }).pipe(Effect.exit)
            : undefined
        if (verified && Exit.isSuccess(verified) && verified.value === "verified") {
          yield* input.control.transition({ type: "release.commit", check: command })
          return
        }
        yield* input.control.transition({
          type: "operation.fail",
          operation: command.operation,
          repair: command.repair,
          revision: command.revision,
          failure: "record_failed",
        })
        return
      }
      if (input.command.type === "pair.write") {
        const command = input.command
        if (input.record) {
          const view = yield* input.control.view
          const current = currentOperation(view, command.candidate.operation)
          const generation = current?.generations.find(
            (item) =>
              item.freezeOwner === command.candidate.freezeOwner && item.generation === command.candidate.generation,
          )
          const record = generation?.records[command.candidate.expectedPrefix]
          const result =
            record?.fact.id === command.candidate.fact
              ? yield* input.record.write({ command, record })
              : ({ message: "failed", part: "absent" } as const)
          yield* input.control.transition({ type: "pair.return", write: command, ...result })
          return
        }
        // A silent no-op would strand the in-flight pair. Report a failed Message and absent Part so
        // the frozen generation remains repairable.
        yield* input.control.transition({
          type: "pair.return",
          write: input.command,
          message: "failed",
          part: "absent",
        })
        return
      }
      if (input.command.type !== "plan.read") return

      // Missing capability means the read cannot be answered; an empty result would instead assert
      // that resolution ran and found no identity.
      if (!input.planIdentity) return

      const identities = yield* input.planIdentity.resolve(input.command.targets)

      const highWater = input.highWater ? yield* input.highWater.read(input.command.targets) : []
      const highWaterMillis = Math.max(0, ...highWater.map((item) => item.millis))

      // All frozen timestamps derive from this single injectable clock read and the persisted high-water.
      const clockMillis = yield* Clock.currentTimeMillis

      const facts =
        input.command.capture.successors.length > 0 ? input.command.capture.successors : input.command.capture.facts
      const coordinates: readonly Model.FrozenCoordinates[] = facts.map((fact) => ({
        fact,
        message: Model.id("message", MessageID.ascending()),
        part: Model.id("part", PartID.ascending()),
        messageEvent: Model.id("event", EventV2.ID.create()),
        partEvent: Model.id("event", EventV2.ID.create()),
      }))
      const seed: Model.FreezeSeed = { clockMillis, highWaterMillis, coordinates }

      // Echo the exact read so the model can reject stale evidence before freezing it.
      const planned = yield* input.control.transition({
        type: "planning.return",
        read: input.command,
        identities,
        seed,
      })
      if (planned.decision.type !== "applied") return
      yield* recordPairs(input, input.command.operation)
      yield* prepareRelease(input, input.command.operation)
    }).pipe(
      Effect.catch(() => Effect.void),
    ),
  run: (input) =>
    Effect.gen(function* () {
      const operation = input.command.operation
      const advance = (to: Model.Phase) => input.control.transition({ type: "operation.advance", operation, to })

      /** Repair resumes the frozen generation; replanning would select different evidence and IDs. */
      const starting = currentOperation(yield* input.control.view, operation)
      if (starting?.phase.type === "record_failed") {
        const failed = starting.generations
          .filter((item) => item.failure === "record_failed")
          .toSorted((left, right) => {
            if (left.freezeSequence !== right.freezeSequence) return left.freezeSequence < right.freezeSequence ? -1 : 1
            const leftOwner = String(left.freezeOwner)
            const rightOwner = String(right.freezeOwner)
            const owner = leftOwner < rightOwner ? -1 : leftOwner > rightOwner ? 1 : 0
            return owner === 0 ? left.generation - right.generation : owner
          })[0]
        if (!failed) return
        const resumed = yield* advance({ type: "recording", generation: failed.generation })
        if (resumed.decision.type !== "applied") return
        yield* recordPairs(input, operation)
        yield* prepareRelease(input, operation)
        return
      }

      /** Retain Task coordinates while jobs are live; post-proof they may already be reaped. */
      const coordinates = new Map<Model.EdgeID, TaskCoordinate>()
      const outcomes = new Map<Model.EdgeID, Ports.ToolPartOutcome>()
      const participantScopes = new Set<string>()
      const yielded = new Set<Model.SessionID>()
      const discoverAsked = new Set<string>()
      const claimAsked = new Set<string>()
      const cancelAsked = new Set<string>()
      const covered = new Set<Model.SessionID>()
      const held = new Set<string>()
      const signalled = new Map<Model.SessionID, Ports.SignalOutcome>()
      yield* advance({ type: "fencing" })
      yield* advance({ type: "quiescing" })

      // Missing discovery evidence cannot establish quiescence. Declare the failure before worker
      // exit can misclassify this deliberate fail-closed return as a worker defect.
      if (!input.discovery) return yield* unproved(input, operation)

      for (let sweep = 0; sweep < SWEEP_LIMIT; sweep++) {
        const snapshot: Snapshot = {
          runners: yield* input.discovery.runners,
          jobs: yield* input.discovery.jobs,
        }
        const evidence = observe(snapshot)
        for (const edge of evidence.edges) {
          if (edge.taskMessage === undefined && edge.taskCall === undefined) continue
          // Retaining the first coordinate lets a later changed observation produce a mismatch.
          if (coordinates.has(edge.id)) continue
          coordinates.set(edge.id, { message: edge.taskMessage, call: edge.taskCall })
        }
        const view = yield* input.control.view
        const current = currentOperation(view, operation)
        if (!current) return
        // Another transition moved the operation, so this driver no longer has claim authority.
        if (current.phase.type !== "quiescing") return

        /**
         * Retain proven edges across sweeps because cancelling a child removes the live evidence that
         * first connected it; a later grandchild still needs that proven path. These are operation-
         * local proofs, not durable lineage, and new nodes still require fresh activity evidence.
         *
         * Replaying first-seen Task coordinates beside fresh evidence also makes changed metadata a
         * real conflict instead of overwriting the value that should be compared.
         */
        const retained = current.edges.map((item) => {
          const coordinate = coordinates.get(item.id)
          return {
            id: item.id,
            owner: item.owner,
            child: item.child,
            ...(coordinate?.message === undefined ? {} : { taskMessage: coordinate.message }),
            ...(coordinate?.call === undefined ? {} : { taskCall: coordinate.call }),
          }
        })
        const edges = [...retained, ...evidence.edges]
        yield* discoverCoverage(input, operation, edges, discoverAsked, covered)
        const lineage = yield* resolveLineage(input.lineage, edges)
        const failed = current.views.filter((item) => item.result === "failure").map((item) => item.root)
        const next = pass(
          current.views.flatMap((item) => Proof.classify({ root: item.root, leaves: evidence.leaves, edges, lineage })),
          current.claims,
          failed,
        )

        if (next.active.length > 0 || next.incomplete.length > 0) {
          yield* input.control.claim({
            operation,
            proofs: next.proofs,
            signals: next.active.map((target) => signalFor(target, snapshot, signalled)),
            beforeSignals: (claimed) => claimCovered(input, claimed, covered, claimAsked, held),
            afterSignals: (claimed) => cancelHeld(input, claimed, held, signalled, cancelAsked),
          })
          continue
        }

        /** Accounting may be stable while an interrupt is still in flight, so check runtime evidence. */
        const lingering = evidence.leaves.filter((item) => current.claims.includes(item))
        if (lingering.length > 0) {
          yield* Effect.yieldNow
          continue
        }

        // Two scans plus apply-time recomputation prevent a racing transition from being proved past.
        const prior = yield* input.control.scan(operation)
        const settled = yield* input.control.scan(operation)
        const step = yield* input.control.transition({
          type: "quiescence.prove",
          operation,
          prior,
          current: settled,
        })
        if (step.decision.type === "applied") {
          yield* capture(input, operation, coordinates, outcomes)

          // A participant exchange invalidates the proof even if it contributes no fact.
          if (yield* observeStateAtFence(input, operation, participantScopes, yielded)) continue

          // Adding facts invalidates this proof; only duplicate facts permit planning to begin.
          const observed = yield* input.control.view
          const proven = currentOperation(observed, operation)
          if (!proven) return
          const additions = yield* Effect.forEach(describe(proven.views, proven.edges, outcomes, yielded), (item) =>
            input.control.transition({
              type: "view.require",
              operation,
              view: item.view,
              nodes: item.nodes,
              facts: item.facts,
            }),
          )
          if (additions.some((item) => item.decision.type === "applied")) continue

          yield* input.control.transition({ type: "planning.begin", operation })
          return
        }
        yield* Effect.yieldNow
      }

      yield* unproved(input, operation)
    }).pipe(
      Effect.catch(() => Effect.void),
    ),
})

/**
 * Queries lineage only for children named by incomplete current evidence; classification also
 * requires an existing edge and a parent already in validated reach.
 */
const resolveLineage = (lineage: Ports.LineageCapability | undefined, edges: readonly Proof.EdgeObservation[]) =>
  Effect.gen(function* () {
    if (!lineage) return undefined
    const gaps = distinct(
      edges.filter((item) => item.child !== undefined && item.owner === undefined).map((item) => item.child!),
    )
    if (gaps.length === 0) return undefined
    const rows = yield* lineage.parents(gaps)
    return rows.map((row) => ({ session: session(row.session), parent: session(row.parent) }))
  })

export * as SessionClosureDriver from "./driver"
