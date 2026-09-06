import { describe, expect, test } from "bun:test"
import { SessionClosureModel } from "@/session/closure/model"

type EventType = SessionClosureModel.Event["type"]
type EventOf<K extends EventType> = Extract<SessionClosureModel.Event, { readonly type: K }>

type Disposition =
  | { readonly kind: "invalid_transition"; readonly cell: string }
  | { readonly kind: "defined_without_invalid"; readonly cell: string }
  | { readonly kind: "contract_gap"; readonly cell: string }

const dispositions = {
  request: { kind: "invalid_transition", cell: "disposed supervisor" },
  "waiter.interrupt": { kind: "defined_without_invalid", cell: "provisional, attached, detached, or settled" },
  "ticket.received": { kind: "defined_without_invalid", cell: "pending, stale, or duplicate offer" },
  "ticket.dequeued": { kind: "invalid_transition", cell: "reserved ticket before offer receipt" },
  "ticket.accept": { kind: "invalid_transition", cell: "reserved ticket before offer receipt" },
  "ticket.offer_failed": { kind: "defined_without_invalid", cell: "pending, received, stale, or settled offer" },
  "worker.registered": { kind: "defined_without_invalid", cell: "exact command or stale/duplicate callback" },
  "worker.registration_failed": {
    kind: "defined_without_invalid",
    cell: "exact command or stale/duplicate callback",
  },
  "worker.started": { kind: "defined_without_invalid", cell: "pending, opened, failed, or stale start gate" },
  "supervisor.failed": { kind: "defined_without_invalid", cell: "running or already-terminal supervisor" },
  "worker.exited": { kind: "defined_without_invalid", cell: "exact current or stale/completed worker tuple" },
  "operation.claim": { kind: "invalid_transition", cell: "exact driver-starting operation" },
  "operation.merge": { kind: "defined_without_invalid", cell: "intersecting, disjoint, or stale operations" },
  "participant.observe": { kind: "invalid_transition", cell: "exact driver-starting operation" },
  "view.require": { kind: "invalid_transition", cell: "exact driver-starting operation and view" },
  "operation.advance": { kind: "defined_without_invalid", cell: "legal edge, invalid_phase edge, or stale operation" },
  "lease.reserve": {
    kind: "contract_gap",
    cell: "internal post-fence reject versus cancellation-owned branch and rejection reason",
  },
  "lease.reuse": {
    kind: "defined_without_invalid",
    cell: "live continuation at its originating epoch, standing fence, stale epoch, or settled lease",
  },
  "lease.bind": { kind: "defined_without_invalid", cell: "reserved, terminal, stale-epoch, or duplicate lease" },
  "lease.finish": { kind: "defined_without_invalid", cell: "live or already-terminal lease" },
  "mutation.reserve": { kind: "defined_without_invalid", cell: "current, fenced, stale-epoch, or disjoint mutation" },
  "mutation.activate": { kind: "defined_without_invalid", cell: "reserved, active, retired, or stale mutation" },
  "mutation.retire": { kind: "defined_without_invalid", cell: "live or already-terminal mutation" },
  "effect.issue": { kind: "invalid_transition", cell: "exact driver-starting operation" },
  "effect.dispatch": { kind: "defined_without_invalid", cell: "issued, in-flight, returned, revoked, or stale permit" },
  "effect.return": { kind: "invalid_transition", cell: "exact issued command before dispatch" },
  "quiescence.prove": { kind: "invalid_transition", cell: "exact driver-starting operation and scan" },
  "planning.begin": {
    kind: "contract_gap",
    cell: "before proven quiescence: invalid_transition versus unverified",
  },
  "planning.return": { kind: "defined_without_invalid", cell: "exact, stale, missing-identity, or replayed read" },
  "writer.next": {
    kind: "contract_gap",
    cell: "outside a usable recording prefix or with no remaining fact",
  },
  "pair.issue": {
    kind: "contract_gap",
    cell: "pre-freeze candidate authenticity, phase precedence, and rejection reason",
  },
  "pair.return": { kind: "defined_without_invalid", cell: "in-flight, stale, imported, returned, or failed pair" },
  "operation.fail": { kind: "invalid_transition", cell: "record_failed against exact claiming operation" },
  "release.prepare": {
    kind: "contract_gap",
    cell: "before verified recording readiness: invalid_transition versus unverified",
  },
  "release.commit": { kind: "defined_without_invalid", cell: "exact, stale, changed, or replayed release check" },
  "waiter.delivered": { kind: "defined_without_invalid", cell: "reserved, stale, or settled delivery" },
  cleanup: { kind: "invalid_transition", cell: "exact claiming operation and revision" },
  dispose: { kind: "defined_without_invalid", cell: "live or already-terminal supervisor" },
  "job.start": { kind: "defined_without_invalid", cell: "fresh, joined, stale-coordinate, or terminal lifetime" },
  "job.extend": {
    kind: "contract_gap",
    cell: "terminal or bad authority reason and stale-token/epoch precedence",
  },
  "job.bind": { kind: "defined_without_invalid", cell: "exact binding result or stale lifetime" },
  "job.permit": { kind: "defined_without_invalid", cell: "issued, consumed, revoked, or stale arm permit" },
  "job.registered": { kind: "defined_without_invalid", cell: "exact registration or stale/duplicate lifetime" },
  "job.binder_failed": { kind: "defined_without_invalid", cell: "unarmed, binding, armed, or terminal lifetime" },
  "job.get": { kind: "invalid_transition", cell: "no JobLifetime for the requested tuple" },
  "job.promote": { kind: "invalid_transition", cell: "exact registered-unarmed lifetime" },
  "job.wait_promotion": { kind: "invalid_transition", cell: "exact registered-unarmed lifetime" },
  "job.wait": { kind: "defined_without_invalid", cell: "live, terminal, or stale lifetime" },
  "job.observe": { kind: "defined_without_invalid", cell: "accepted, stale-sequence, or stale-token observation" },
  "job.deliver": {
    kind: "defined_without_invalid",
    cell: "accepted, duplicate, stale-sequence, or stale-token delivery",
  },
  "job.cancel": { kind: "defined_without_invalid", cell: "live, terminal, stale-sequence, or stale-token lifetime" },
  "job.terminal": { kind: "defined_without_invalid", cell: "live, terminal, or stale lifetime" },
} as const satisfies { readonly [K in EventType]: Disposition }

type InvalidType = {
  readonly [K in EventType]: (typeof dispositions)[K]["kind"] extends "invalid_transition" ? K : never
}[EventType]

type InvalidCell<K extends InvalidType> = {
  readonly state: SessionClosureModel.State
  readonly event: EventOf<K>
  readonly current: () => void
}

function key<K extends SessionClosureModel.IDKind>(kind: K, value: string): SessionClosureModel.ID<K> {
  return SessionClosureModel.id(kind, value)
}

function command<T extends SessionClosureModel.Command["type"]>(
  result: SessionClosureModel.Step,
  type: T,
): Extract<SessionClosureModel.Command, { readonly type: T }> {
  const found = result.commands.find((item) => item.type === type)
  if (!found) throw new Error(`missing ${type} command`)
  return found as Extract<SessionClosureModel.Command, { readonly type: T }>
}

function operation(state: SessionClosureModel.State, id: SessionClosureModel.OperationID) {
  const found = SessionClosureModel.view(state).operations.find((item) => item.id === id)
  if (!found) throw new Error(`missing operation ${id}`)
  return found
}

function rootview(
  state: SessionClosureModel.State,
  operationID: SessionClosureModel.OperationID,
  viewID: SessionClosureModel.ViewID,
) {
  const found = operation(state, operationID).views.find((item) => item.id === viewID)
  if (!found) throw new Error(`missing view ${viewID}`)
  return found
}

function ticket(state: SessionClosureModel.State, id: SessionClosureModel.TicketID) {
  const found = SessionClosureModel.view(state).tickets.find((item) => item.id === id)
  if (!found) throw new Error(`missing ticket ${id}`)
  return found
}

function lease(state: SessionClosureModel.State, id: SessionClosureModel.LeaseID) {
  const found = SessionClosureModel.view(state).leases.find((item) => item.id === id)
  if (!found) throw new Error(`missing lease ${id}`)
  return found
}

function mutation(state: SessionClosureModel.State, id: SessionClosureModel.MutationID) {
  const found = SessionClosureModel.view(state).mutations.find((item) => item.id === id)
  if (!found) throw new Error(`missing mutation ${id}`)
  return found
}

function effect(state: SessionClosureModel.State, id: SessionClosureModel.EffectID) {
  const found = SessionClosureModel.view(state).effects.find((item) => item.id === id)
  if (!found) throw new Error(`missing effect ${id}`)
  return found
}

function pair(state: SessionClosureModel.State, id: SessionClosureModel.PairID) {
  const found = SessionClosureModel.view(state).pairs.find((item) => item.id === id)
  if (!found) throw new Error(`missing pair ${id}`)
  return found
}

function generation(
  state: SessionClosureModel.State,
  operationID: SessionClosureModel.OperationID,
  owner: SessionClosureModel.OperationID,
  number: number,
) {
  const found = operation(state, operationID).generations.find(
    (item) => item.freezeOwner === owner && item.generation === number,
  )
  if (!found) throw new Error(`missing generation ${owner}:${number}`)
  return found
}

function job(state: SessionClosureModel.State, id: SessionClosureModel.JobID) {
  const found = SessionClosureModel.view(state).jobs.find((item) => item.id === id)
  if (!found) throw new Error(`missing job ${id}`)
  return found
}

function types(result: SessionClosureModel.Step) {
  return result.commands.map((item) => item.type)
}

function plain(result: SessionClosureModel.Step) {
  expect(structuredClone(result.commands)).toEqual(result.commands)
}

function snapshot(state: SessionClosureModel.State) {
  return structuredClone(SessionClosureModel.view(state))
}

function requesting(prefix: string) {
  const instance = key("instance", `${prefix}:instance`)
  const root = key("session", `${prefix}:root`)
  const operationID = key("operation", `${prefix}:operation`)
  const view = key("view", `${prefix}:view`)
  const waiter = key("waiter", `${prefix}:waiter`)
  const ticketID = key("ticket", `${prefix}:ticket`)
  const repair = key("repair", `${prefix}:repair`)
  const initial = SessionClosureModel.make({ instance, sessions: [root] })
  const requested = SessionClosureModel.step(initial, {
    type: "request",
    instance,
    root,
    operation: operationID,
    view,
    waiter,
    ticket: ticketID,
    repair,
  })
  const offer = command(requested, "ticket.offer")
  return { instance, root, operation: operationID, view, waiter, ticket: ticketID, repair, initial, requested, offer }
}

function unarmed(prefix: string) {
  const instance = key("instance", `${prefix}:instance`)
  const session = key("session", `${prefix}:session`)
  const jobID = key("job", `${prefix}:job`)
  const lifetime = key("lifetime", `${prefix}:lifetime`)
  const scope = key("scope", `${prefix}:scope`)
  const leaseID = key("lease", `${prefix}:lease`)
  const request = key("request", `${prefix}:request`)
  const initial = SessionClosureModel.make({ instance, sessions: [session] })
  const reserved = SessionClosureModel.step(initial, {
    type: "lease.reserve",
    instance,
    lease: {
      id: leaseID,
      session,
      epoch: 0n,
      source: `${prefix}:start`,
      origin: "internal",
      retry: "initial",
      kind: "pre_bind",
      owner: { type: "scope", id: scope },
    },
  })
  const started = SessionClosureModel.step(reserved.state, {
    type: "job.start",
    instance,
    request,
    job: jobID,
    lifetime,
    scope,
    lease: leaseID,
    epoch: 0n,
    admissionRevision: SessionClosureModel.view(reserved.state).authorityRevision,
  })
  const binding = command(started, "job.bind")
  return {
    instance,
    session,
    job: jobID,
    lifetime,
    scope,
    lease: leaseID,
    request,
    initial,
    reserved,
    started,
    binding,
  }
}

function start(input: {
  readonly state: SessionClosureModel.State
  readonly instance: SessionClosureModel.InstanceID
  readonly root: SessionClosureModel.SessionID
  readonly operation: SessionClosureModel.OperationID
  readonly view: SessionClosureModel.ViewID
  readonly waiter: SessionClosureModel.WaiterID
  readonly ticket: SessionClosureModel.TicketID
  readonly worker: SessionClosureModel.WorkerID
  readonly repair: SessionClosureModel.RepairID
}) {
  const requested = SessionClosureModel.step(input.state, {
    type: "request",
    instance: input.instance,
    root: input.root,
    operation: input.operation,
    view: input.view,
    waiter: input.waiter,
    ticket: input.ticket,
    repair: input.repair,
  })
  const offer = command(requested, "ticket.offer")
  const received = SessionClosureModel.step(requested.state, {
    type: "ticket.received",
    instance: input.instance,
    offer,
  })
  const dequeued = SessionClosureModel.step(received.state, {
    type: "ticket.dequeued",
    instance: input.instance,
    offer,
  })
  const accepted = SessionClosureModel.step(dequeued.state, {
    type: "ticket.accept",
    instance: input.instance,
    offer,
  })
  const registration = command(accepted, "worker.register")
  const registered = SessionClosureModel.step(accepted.state, {
    type: "worker.registered",
    instance: input.instance,
    registration,
    worker: input.worker,
  })
  const opening = command(registered, "worker.open")
  const started = SessionClosureModel.step(registered.state, {
    type: "worker.started",
    instance: input.instance,
    opening,
  })
  return {
    requested,
    offer,
    received,
    dequeued,
    accepted,
    registration,
    registered,
    opening,
    started,
    state: started.state,
  }
}

function begin(input: {
  readonly state: SessionClosureModel.State
  readonly instance: SessionClosureModel.InstanceID
  readonly root: SessionClosureModel.SessionID
  readonly prefix: string
}) {
  const operationID = key("operation", `${input.prefix}:operation`)
  const viewID = key("view", `${input.prefix}:view`)
  const waiter = key("waiter", `${input.prefix}:waiter`)
  const ticket = key("ticket", `${input.prefix}:ticket`)
  const worker = key("worker", `${input.prefix}:worker`)
  const repair = key("repair", `${input.prefix}:repair`)
  const signal = key("effect", `${input.prefix}:signal`)
  const started = start({
    state: input.state,
    instance: input.instance,
    root: input.root,
    operation: operationID,
    view: viewID,
    waiter,
    ticket,
    worker,
    repair,
  })
  const claimed = SessionClosureModel.step(started.state, {
    type: "operation.claim",
    instance: input.instance,
    operation: operationID,
    repair,
    revision: operation(started.state, operationID).revision,
    proofs: [{ value: "proven_connected", root: input.root, active: input.root, path: [input.root], edges: [] }],
    signals: [signal],
  })
  const signalling = command(claimed, "effect.run")
  const dispatched = SessionClosureModel.step(claimed.state, {
    type: "effect.dispatch",
    instance: input.instance,
    command: signalling,
  })
  const signalled = SessionClosureModel.step(dispatched.state, {
    type: "effect.return",
    instance: input.instance,
    command: signalling,
    result: "success",
  })
  const required = SessionClosureModel.step(signalled.state, {
    type: "view.require",
    instance: input.instance,
    operation: operationID,
    view: viewID,
    nodes: [input.root],
    facts: [{ type: "root", root: input.root, direct: { outcome: "cancelled", yielded: false } }],
  })
  const fencing = SessionClosureModel.step(required.state, {
    type: "operation.advance",
    instance: input.instance,
    operation: operationID,
    to: { type: "fencing" },
  })
  const quiescing = SessionClosureModel.step(fencing.state, {
    type: "operation.advance",
    instance: input.instance,
    operation: operationID,
    to: { type: "quiescing" },
  })
  return {
    operation: operationID,
    view: viewID,
    waiter,
    ticket,
    worker,
    repair,
    signal,
    started,
    claimed,
    dispatched,
    signalled,
    required,
    fencing,
    quiescing,
    state: quiescing.state,
  }
}

function identity(): SessionClosureModel.Identity {
  return {
    source: "session_identity",
    agent: "test",
    model: {
      providerID: "test-provider",
      modelID: "test-model",
      variant: { present: true, value: "test-variant" },
    },
  }
}

function freeze(input: {
  readonly state: SessionClosureModel.State
  readonly instance: SessionClosureModel.InstanceID
  readonly root: SessionClosureModel.SessionID
  readonly operation: SessionClosureModel.OperationID
  readonly prefix: string
}) {
  const capture = SessionClosureModel.scan(input.state, input.operation)
  const stable = SessionClosureModel.step(input.state, {
    type: "quiescence.prove",
    instance: input.instance,
    operation: input.operation,
    prior: capture,
    current: capture,
  })
  const planning = SessionClosureModel.step(stable.state, {
    type: "planning.begin",
    instance: input.instance,
    operation: input.operation,
  })
  const read = command(planning, "plan.read")
  const facts = operation(planning.state, input.operation).facts
  const coordinates = facts.map((fact, index) => ({
    fact: fact.id,
    message: key("message", `${input.prefix}:message:${index}`),
    part: key("part", `${input.prefix}:part:${index}`),
    messageEvent: key("event", `${input.prefix}:message-event:${index}`),
    partEvent: key("event", `${input.prefix}:part-event:${index}`),
  }))
  const frozen = SessionClosureModel.step(planning.state, {
    type: "planning.return",
    instance: input.instance,
    read,
    identities: [{ session: input.root, identity: identity() }],
    seed: { clockMillis: 2000, highWaterMillis: 1900, coordinates },
  })
  return { capture, stable, planning, read, frozen, state: frozen.state }
}

function record(input: {
  readonly state: SessionClosureModel.State
  readonly instance: SessionClosureModel.InstanceID
  readonly root: SessionClosureModel.SessionID
  readonly operation: SessionClosureModel.OperationID
  readonly repair: SessionClosureModel.RepairID
  readonly prefix: string
}) {
  const capture = SessionClosureModel.scan(input.state, input.operation)
  const stable = SessionClosureModel.step(input.state, {
    type: "quiescence.prove",
    instance: input.instance,
    operation: input.operation,
    prior: capture,
    current: capture,
  })
  const planning = SessionClosureModel.step(stable.state, {
    type: "planning.begin",
    instance: input.instance,
    operation: input.operation,
  })
  const read = command(planning, "plan.read")
  const facts = operation(planning.state, input.operation).facts
  const coordinates = facts.map((fact, index) => ({
    fact: fact.id,
    message: key("message", `${input.prefix}:message:${index}`),
    part: key("part", `${input.prefix}:part:${index}`),
    messageEvent: key("event", `${input.prefix}:message-event:${index}`),
    partEvent: key("event", `${input.prefix}:part-event:${index}`),
  }))
  const frozen = SessionClosureModel.step(planning.state, {
    type: "planning.return",
    instance: input.instance,
    read,
    identities: [{ session: input.root, identity: identity() }],
    seed: { clockMillis: 1000, highWaterMillis: 900, coordinates },
  })
  const candidate = SessionClosureModel.step(frozen.state, {
    type: "writer.next",
    instance: input.instance,
    operation: input.operation,
  })
  const next = command(candidate, "pair.candidate")
  const issued = SessionClosureModel.step(candidate.state, {
    type: "pair.issue",
    instance: input.instance,
    candidate: next,
    permit: key("pair", `${input.prefix}:pair`),
  })
  const write = command(issued, "pair.write")
  const returned = SessionClosureModel.step(issued.state, {
    type: "pair.return",
    instance: input.instance,
    write,
    message: "verified",
    part: "verified",
  })
  const prepared = SessionClosureModel.step(returned.state, {
    type: "release.prepare",
    instance: input.instance,
    operation: input.operation,
  })
  const check = command(prepared, "release.verify")
  return {
    capture,
    stable,
    planning,
    read,
    frozen,
    candidate,
    next,
    issued,
    write,
    returned,
    prepared,
    check,
    state: prepared.state,
  }
}

function prepared(prefix: string) {
  const instance = key("instance", `${prefix}:instance`)
  const root = key("session", `${prefix}:root`)
  const initial = SessionClosureModel.make({ instance, sessions: [root] })
  const begun = begin({ state: initial, instance, root, prefix })
  const recorded = record({
    state: begun.state,
    instance,
    root,
    operation: begun.operation,
    repair: begun.repair,
    prefix,
  })
  return { instance, root, initial, begun, recorded }
}

function merged(prefix: string) {
  const instance = key("instance", `${prefix}:instance`)
  const a = key("session", `${prefix}:a`)
  const b = key("session", `${prefix}:b`)
  const leaf = key("session", `${prefix}:leaf`)
  const other = key("session", `${prefix}:other`)
  const initial = SessionClosureModel.make({ instance, sessions: [a, b, leaf, other] })
  const first = start({
    state: initial,
    instance,
    root: a,
    operation: key("operation", `${prefix}:operation:a`),
    view: key("view", `${prefix}:view:a`),
    waiter: key("waiter", `${prefix}:waiter:a`),
    ticket: key("ticket", `${prefix}:ticket:a`),
    worker: key("worker", `${prefix}:worker:a`),
    repair: key("repair", `${prefix}:repair:a`),
  })
  const second = start({
    state: first.state,
    instance,
    root: b,
    operation: key("operation", `${prefix}:operation:b`),
    view: key("view", `${prefix}:view:b`),
    waiter: key("waiter", `${prefix}:waiter:b`),
    ticket: key("ticket", `${prefix}:ticket:b`),
    worker: key("worker", `${prefix}:worker:b`),
    repair: key("repair", `${prefix}:repair:b`),
  })
  const operationA = first.offer.operation
  const operationB = second.offer.operation
  const repairA = first.offer.repair
  const repairB = second.offer.repair
  const claimedA = SessionClosureModel.step(second.state, {
    type: "operation.claim",
    instance,
    operation: operationA,
    repair: repairA,
    revision: operation(second.state, operationA).revision,
    proofs: [
      {
        value: "proven_connected",
        root: a,
        active: leaf,
        path: [a, leaf],
        edges: [{ id: key("edge", `${prefix}:edge:a`), owner: a, child: leaf }],
      },
    ],
    signals: [key("effect", `${prefix}:signal:a`)],
  })
  const signalA = command(claimedA, "effect.run")
  const dispatchedA = SessionClosureModel.step(claimedA.state, {
    type: "effect.dispatch",
    instance,
    command: signalA,
  })
  const returnedA = SessionClosureModel.step(dispatchedA.state, {
    type: "effect.return",
    instance,
    command: signalA,
    result: "success",
  })
  const claimedB = SessionClosureModel.step(returnedA.state, {
    type: "operation.claim",
    instance,
    operation: operationB,
    repair: repairB,
    revision: operation(returnedA.state, operationB).revision,
    proofs: [
      {
        value: "proven_connected",
        root: b,
        active: leaf,
        path: [b, leaf],
        edges: [{ id: key("edge", `${prefix}:edge:b`), owner: b, child: leaf }],
      },
    ],
    signals: [key("effect", `${prefix}:signal:b`)],
  })
  return {
    instance,
    a,
    b,
    leaf,
    other,
    operation: operationA,
    repair: repairA,
    first,
    second,
    claimedA,
    dispatchedA,
    returnedA,
    claimedB,
    state: claimedB.state,
  }
}

const invalids = {
  request: (): InvalidCell<"request"> => {
    const instance = key("instance", "totality-request:instance")
    const root = key("session", "totality-request:root")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const disposed = SessionClosureModel.step(initial, { type: "dispose", instance })
    return {
      state: disposed.state,
      event: {
        type: "request",
        instance,
        root,
        operation: key("operation", "totality-request:operation"),
        view: key("view", "totality-request:view"),
        waiter: key("waiter", "totality-request:waiter"),
        ticket: key("ticket", "totality-request:ticket"),
        repair: key("repair", "totality-request:repair"),
      },
      current: () => {
        expect(disposed.decision).toEqual({ type: "applied" })
        expect(SessionClosureModel.view(disposed.state).supervisor.state).toBe("disposed")
      },
    }
  },
  "ticket.dequeued": (): InvalidCell<"ticket.dequeued"> => {
    const setup = requesting("totality-ticket-dequeued")
    return {
      state: setup.requested.state,
      event: { type: "ticket.dequeued", instance: setup.instance, offer: setup.offer },
      current: () => {
        expect(setup.requested.decision).toEqual({ type: "applied" })
        expect(ticket(setup.requested.state, setup.ticket)).toMatchObject({
          state: "reserved",
          offer: "pending",
          dequeued: false,
          acceptance: "pending",
        })
      },
    }
  },
  "ticket.accept": (): InvalidCell<"ticket.accept"> => {
    const setup = requesting("totality-ticket-accept")
    return {
      state: setup.requested.state,
      event: { type: "ticket.accept", instance: setup.instance, offer: setup.offer },
      current: () => {
        expect(setup.requested.decision).toEqual({ type: "applied" })
        expect(ticket(setup.requested.state, setup.ticket)).toMatchObject({
          state: "reserved",
          offer: "pending",
          acceptance: "pending",
        })
      },
    }
  },
  "operation.claim": (): InvalidCell<"operation.claim"> => {
    const setup = requesting("totality-operation-claim")
    return {
      state: setup.requested.state,
      event: {
        type: "operation.claim",
        instance: setup.instance,
        operation: setup.operation,
        repair: setup.repair,
        revision: operation(setup.requested.state, setup.operation).revision,
        proofs: [
          {
            value: "proven_connected",
            root: setup.root,
            active: setup.root,
            path: [setup.root],
            edges: [],
          },
        ],
        signals: [key("effect", "totality-operation-claim:signal")],
      },
      current: () => {
        expect(setup.requested.decision).toEqual({ type: "applied" })
        expect(operation(setup.requested.state, setup.operation).phase.type).toBe("driver_starting")
      },
    }
  },
  "participant.observe": (): InvalidCell<"participant.observe"> => {
    const setup = requesting("totality-participant-observe")
    return {
      state: setup.requested.state,
      event: {
        type: "participant.observe",
        instance: setup.instance,
        operation: setup.operation,
        participant: key("participant", "totality-participant-observe:participant"),
        revision: 1n,
      },
      current: () => {
        expect(setup.requested.decision).toEqual({ type: "applied" })
        expect(operation(setup.requested.state, setup.operation).phase.type).toBe("driver_starting")
      },
    }
  },
  "view.require": (): InvalidCell<"view.require"> => {
    const setup = requesting("totality-view-require")
    return {
      state: setup.requested.state,
      event: {
        type: "view.require",
        instance: setup.instance,
        operation: setup.operation,
        view: setup.view,
        nodes: [setup.root],
        facts: [{ type: "self", subject: setup.root, outcome: "cancelled", yielded: false }],
      },
      current: () => {
        expect(setup.requested.decision).toEqual({ type: "applied" })
        expect(operation(setup.requested.state, setup.operation).phase.type).toBe("driver_starting")
        expect(rootview(setup.requested.state, setup.operation, setup.view).id).toBe(setup.view)
      },
    }
  },
  "effect.issue": (): InvalidCell<"effect.issue"> => {
    const setup = requesting("totality-effect-issue")
    return {
      state: setup.requested.state,
      event: {
        type: "effect.issue",
        instance: setup.instance,
        permit: key("effect", "totality-effect-issue:permit"),
        operation: setup.operation,
        repair: setup.repair,
        revision: operation(setup.requested.state, setup.operation).revision,
        effect: "participant",
      },
      current: () => {
        expect(setup.requested.decision).toEqual({ type: "applied" })
        expect(operation(setup.requested.state, setup.operation).phase.type).toBe("driver_starting")
      },
    }
  },
  "effect.return": (): InvalidCell<"effect.return"> => {
    const instance = key("instance", "totality-effect-return:instance")
    const root = key("session", "totality-effect-return:root")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const begun = begin({ state: initial, instance, root, prefix: "totality-effect-return" })
    const permit = key("effect", "totality-effect-return:permit")
    const issued = SessionClosureModel.step(begun.state, {
      type: "effect.issue",
      instance,
      permit,
      operation: begun.operation,
      repair: begun.repair,
      revision: operation(begun.state, begun.operation).revision,
      effect: "participant",
    })
    return {
      state: issued.state,
      event: { type: "effect.return", instance, command: command(issued, "effect.run"), result: "success" },
      current: () => {
        expect(issued.decision).toEqual({ type: "applied" })
        expect(effect(issued.state, permit).state).toBe("issued")
      },
    }
  },
  "quiescence.prove": (): InvalidCell<"quiescence.prove"> => {
    const setup = requesting("totality-quiescence-prove")
    const capture = SessionClosureModel.scan(setup.requested.state, setup.operation)
    return {
      state: setup.requested.state,
      event: {
        type: "quiescence.prove",
        instance: setup.instance,
        operation: setup.operation,
        prior: capture,
        current: capture,
      },
      current: () => {
        expect(setup.requested.decision).toEqual({ type: "applied" })
        expect(operation(setup.requested.state, setup.operation).phase.type).toBe("driver_starting")
      },
    }
  },
  "operation.fail": (): InvalidCell<"operation.fail"> => {
    const instance = key("instance", "totality-operation-fail:instance")
    const root = key("session", "totality-operation-fail:root")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const started = start({
      state: initial,
      instance,
      root,
      operation: key("operation", "totality-operation-fail:operation"),
      view: key("view", "totality-operation-fail:view"),
      waiter: key("waiter", "totality-operation-fail:waiter"),
      ticket: key("ticket", "totality-operation-fail:ticket"),
      worker: key("worker", "totality-operation-fail:worker"),
      repair: key("repair", "totality-operation-fail:repair"),
    })
    const active = operation(started.state, started.offer.operation)
    return {
      state: started.state,
      event: {
        type: "operation.fail",
        instance,
        operation: active.id,
        repair: started.offer.repair,
        revision: active.revision,
        failure: "record_failed",
      },
      current: () => {
        expect(active.phase.type).toBe("claiming")
        expect(active.driver.state).toBe("running")
      },
    }
  },
  cleanup: (): InvalidCell<"cleanup"> => {
    const instance = key("instance", "totality-cleanup:instance")
    const root = key("session", "totality-cleanup:root")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const started = start({
      state: initial,
      instance,
      root,
      operation: key("operation", "totality-cleanup:operation"),
      view: key("view", "totality-cleanup:view"),
      waiter: key("waiter", "totality-cleanup:waiter"),
      ticket: key("ticket", "totality-cleanup:ticket"),
      worker: key("worker", "totality-cleanup:worker"),
      repair: key("repair", "totality-cleanup:repair"),
    })
    const active = operation(started.state, started.offer.operation)
    return {
      state: started.state,
      event: { type: "cleanup", instance, operation: active.id, revision: active.revision },
      current: () => {
        expect(active.phase.type).toBe("claiming")
        expect(active.driver.state).toBe("running")
      },
    }
  },
  "job.get": (): InvalidCell<"job.get"> => {
    const instance = key("instance", "totality-job-get:instance")
    const session = key("session", "totality-job-get:session")
    const initial = SessionClosureModel.make({ instance, sessions: [session] })
    return {
      state: initial,
      event: {
        type: "job.get",
        instance,
        job: key("job", "totality-job-get:job"),
        lifetime: key("lifetime", "totality-job-get:lifetime"),
      },
      current: () => {
        expect(SessionClosureModel.view(initial).supervisor.state).toBe("running")
        expect(SessionClosureModel.view(initial).jobs).toEqual([])
      },
    }
  },
  "job.promote": (): InvalidCell<"job.promote"> => {
    const setup = unarmed("totality-job-promote")
    return {
      state: setup.started.state,
      event: { type: "job.promote", instance: setup.instance, job: setup.job, lifetime: setup.lifetime },
      current: () => {
        expect(setup.started.decision).toEqual({ type: "applied" })
        expect(job(setup.started.state, setup.job)).toMatchObject({
          lifetime: setup.lifetime,
          state: "registered_unarmed",
          promoted: false,
        })
      },
    }
  },
  "job.wait_promotion": (): InvalidCell<"job.wait_promotion"> => {
    const setup = unarmed("totality-job-wait-promotion")
    return {
      state: setup.started.state,
      event: { type: "job.wait_promotion", instance: setup.instance, job: setup.job, lifetime: setup.lifetime },
      current: () => {
        expect(setup.started.decision).toEqual({ type: "applied" })
        expect(job(setup.started.state, setup.job)).toMatchObject({
          lifetime: setup.lifetime,
          state: "registered_unarmed",
          promoted: false,
        })
      },
    }
  },
} satisfies { readonly [K in InvalidType]: () => InvalidCell<K> }

// Gate-1 traceability only: I-29 requires real Scope/Runner/BackgroundJob barriers at Gate 4 K63.
// Gate-1 traceability only: I-36 requires two real authority locks and callbacks at Gate 2 K79.
// Section 5.3 is compile-exhaustive over Event discriminants; contract gaps remain explicit rather than guessed.

describe("session closure authority model", () => {
  test("I-01 rejects foreign Instance events across every modeled authority entity", () => {
    // Mutant: delete the event.instance equality guard; the wrong_instance and unchanged-view assertions turn red.
    const foreign = key("instance", "i01:instance:b")
    const reject = (state: SessionClosureModel.State, event: SessionClosureModel.Event) => {
      const before = snapshot(state)
      const result = SessionClosureModel.step(state, event)
      expect(result.decision).toEqual({ type: "rejected", reason: "wrong_instance" })
      expect(result.commands).toEqual([])
      expect(SessionClosureModel.view(result.state)).toEqual(before)
    }

    const instance = key("instance", "i01-claim:instance")
    const root = key("session", "i01-claim:root")
    const leaf = key("session", "i01-claim:leaf")
    const initial = SessionClosureModel.make({ instance, sessions: [root, leaf] })
    const started = start({
      state: initial,
      instance,
      root,
      operation: key("operation", "i01-claim:operation"),
      view: key("view", "i01-claim:view"),
      waiter: key("waiter", "i01-claim:waiter"),
      ticket: key("ticket", "i01-claim:ticket"),
      worker: key("worker", "i01-claim:worker"),
      repair: key("repair", "i01-claim:repair"),
    })
    const claim: EventOf<"operation.claim"> = {
      type: "operation.claim",
      instance,
      operation: started.offer.operation,
      repair: started.offer.repair,
      revision: operation(started.state, started.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root,
          active: leaf,
          path: [root, leaf],
          edges: [{ id: key("edge", "i01-claim:edge"), owner: root, child: leaf }],
        },
      ],
      signals: [key("effect", "i01-claim:signal")],
    }
    const claimed = SessionClosureModel.step(started.state, claim)
    expect(claimed.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(claimed.state).claims).toContainEqual({
      session: leaf,
      operation: started.offer.operation,
    })
    expect(
      SessionClosureModel.view(claimed.state).fences.some(
        (item) => item.session === leaf && item.operation === started.offer.operation,
      ),
    ).toBe(true)
    expect(operation(claimed.state, started.offer.operation).edges).toContainEqual({
      id: key("edge", "i01-claim:edge"),
      owner: root,
      child: leaf,
    })
    reject(started.state, { ...claim, instance: foreign })

    const participant = key("participant", "i01-participant:id")
    const observed = SessionClosureModel.step(claimed.state, {
      type: "participant.observe",
      instance,
      operation: started.offer.operation,
      participant,
      revision: 1n,
    })
    expect(observed.decision).toEqual({ type: "applied" })
    expect(operation(observed.state, started.offer.operation).participants).toContainEqual({
      id: participant,
      revision: 1n,
    })
    reject(observed.state, {
      type: "participant.observe",
      instance: foreign,
      operation: started.offer.operation,
      participant,
      revision: 2n,
    })

    const leaseInstance = key("instance", "i01-lease:instance")
    const leaseRoot = key("session", "i01-lease:root")
    const leaseID = key("lease", "i01-lease:id")
    const owner = { type: "scope", id: key("scope", "i01-lease:scope") } as const
    const leaseInitial = SessionClosureModel.make({ instance: leaseInstance, sessions: [leaseRoot] })
    const reserved = SessionClosureModel.step(leaseInitial, {
      type: "lease.reserve",
      instance: leaseInstance,
      lease: {
        id: leaseID,
        session: leaseRoot,
        epoch: 0n,
        source: "instance-check",
        origin: "internal",
        retry: "initial",
        kind: "ordinary",
      },
    })
    const bound = SessionClosureModel.step(reserved.state, {
      type: "lease.bind",
      instance: leaseInstance,
      lease: leaseID,
      owner,
    })
    expect(bound.decision).toEqual({ type: "applied" })
    expect(lease(bound.state, leaseID).owner).toEqual(owner)
    reject(reserved.state, { type: "lease.bind", instance: foreign, lease: leaseID, owner })

    const lifetime = unarmed("i01-job")
    expect(job(lifetime.started.state, lifetime.job)).toMatchObject({
      lifetime: lifetime.lifetime,
      state: "registered_unarmed",
    })
    reject(lifetime.started.state, {
      type: "job.terminal",
      instance: foreign,
      job: lifetime.job,
      lifetime: lifetime.lifetime,
      winner: "completed",
    })

    const data = prepared("i01-record")
    expect(pair(data.recorded.issued.state, data.recorded.write.permit).state).toBe("in_flight")
    reject(data.recorded.issued.state, {
      type: "pair.return",
      instance: foreign,
      write: data.recorded.write,
      message: "verified",
      part: "verified",
    })
  })

  test("I-01 rejects a foreign Instance embedded in an otherwise exact Effect command", () => {
    // Mutant: delete run.instance === value.instance from exactEffect; the outer-local callback dispatches foreign authority.
    const instance = key("instance", "i01-embedded:instance")
    const foreign = key("instance", "i01-embedded:foreign")
    const root = key("session", "i01-embedded:root")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const begun = begin({ state: initial, instance, root, prefix: "i01-embedded" })
    const permit = key("effect", "i01-embedded:permit")
    const authority = operation(begun.state, begun.operation)
    const issued = SessionClosureModel.step(begun.state, {
      type: "effect.issue",
      instance,
      permit,
      operation: begun.operation,
      repair: begun.repair,
      revision: authority.revision,
      effect: "participant",
    })
    const run = command(issued, "effect.run")

    expect(issued.decision).toEqual({ type: "applied" })
    expect(run.instance).toBe(instance)
    expect(effect(issued.state, permit).state).toBe("issued")
    const embedded: Extract<SessionClosureModel.Command, { readonly type: "effect.run" }> = {
      ...run,
      instance: foreign,
    }
    const before = snapshot(issued.state)
    const blocked = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance,
      command: embedded,
    })
    expect(blocked.decision).toEqual({ type: "noop", reason: "stale" })
    expect(blocked.commands).toEqual([])
    expect(effect(blocked.state, permit).state).toBe("issued")
    expect(SessionClosureModel.view(blocked.state)).toEqual(before)

    const exact = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance,
      command: run,
    })
    expect(exact.decision).toEqual({ type: "applied" })
    expect(effect(exact.state, permit).state).toBe("in_flight")
  })

  test("I-02 canonicalizes an intersecting claim into one fence and one node owner", () => {
    // Mutant: delete intersection canonicalization during the second claim; the one-fence/alias assertions turn red.
    const data = merged("i02")
    const before = snapshot(data.returnedA.state)
    const after = SessionClosureModel.view(data.claimedB.state)
    const claims = after.claims.filter((item) => item.session === data.leaf)
    const fences = after.fences.filter((item) => item.session === data.leaf)

    expect(after.authorityRevision).toBe(before.authorityRevision + 1n)
    expect(claims).toEqual([{ session: data.leaf, operation: data.operation }])
    expect(fences).toHaveLength(1)
    expect(fences[0]?.operation).toBe(data.operation)
    expect(after.aliases).toContainEqual({ alias: data.second.offer.operation, canonical: data.operation })
  })

  test("I-02 keeps an explicit disjoint operation merge as a byte-equal no-op", () => {
    // Mutant: delete the intersection check from operation.merge; the disjoint decision and unchanged-view assertions turn red.
    const instance = key("instance", "i02-disjoint:instance")
    const a = key("session", "i02-disjoint:a")
    const b = key("session", "i02-disjoint:b")
    const initial = SessionClosureModel.make({ instance, sessions: [a, b] })
    const first = start({
      state: initial,
      instance,
      root: a,
      operation: key("operation", "i02-disjoint:operation:a"),
      view: key("view", "i02-disjoint:view:a"),
      waiter: key("waiter", "i02-disjoint:waiter:a"),
      ticket: key("ticket", "i02-disjoint:ticket:a"),
      worker: key("worker", "i02-disjoint:worker:a"),
      repair: key("repair", "i02-disjoint:repair:a"),
    })
    const second = start({
      state: first.state,
      instance,
      root: b,
      operation: key("operation", "i02-disjoint:operation:b"),
      view: key("view", "i02-disjoint:view:b"),
      waiter: key("waiter", "i02-disjoint:waiter:b"),
      ticket: key("ticket", "i02-disjoint:ticket:b"),
      worker: key("worker", "i02-disjoint:worker:b"),
      repair: key("repair", "i02-disjoint:repair:b"),
    })
    expect(SessionClosureModel.view(second.state).operations).toHaveLength(2)
    const before = snapshot(second.state)
    const result = SessionClosureModel.step(second.state, {
      type: "operation.merge",
      instance,
      left: first.offer.operation,
      right: second.offer.operation,
    })

    expect(result.decision).toEqual({ type: "noop", reason: "disjoint" })
    expect(result.commands).toEqual([])
    expect(SessionClosureModel.view(result.state)).toEqual(before)
  })

  test("I-03 rejects a pre-release lease epoch and admits the advanced epoch", () => {
    // Mutant: delete epoch equality from lease.reserve; the stale_epoch assertion turns red.
    const data = prepared("i03-lease")
    const released = SessionClosureModel.step(data.recorded.state, {
      type: "release.commit",
      instance: data.instance,
      check: data.recorded.check,
    })
    const before = snapshot(released.state)
    expect(released.decision).toEqual({ type: "applied" })
    expect(before.epochs).toContainEqual({ session: data.root, epoch: 1n })
    expect(before.fences.some((item) => item.session === data.root)).toBe(false)
    const token = key("lease", "i03-lease:token")
    const stale = SessionClosureModel.step(released.state, {
      type: "lease.reserve",
      instance: data.instance,
      lease: {
        id: token,
        session: data.root,
        epoch: 0n,
        source: "stale",
        origin: "internal",
        retry: "initial",
        kind: "ordinary",
        owner: { type: "scope", id: key("scope", "i03-lease:scope") },
      },
    })

    expect(stale.decision).toEqual({ type: "rejected", reason: "stale_epoch" })
    expect(SessionClosureModel.view(stale.state)).toEqual(before)

    const admission = snapshot(stale.state)
    const fresh = SessionClosureModel.step(stale.state, {
      type: "lease.reserve",
      instance: data.instance,
      lease: {
        id: token,
        session: data.root,
        epoch: 1n,
        source: "fresh",
        origin: "internal",
        retry: "initial",
        kind: "ordinary",
        owner: { type: "scope", id: key("scope", "i03-lease:scope") },
      },
    })
    expect(fresh.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(fresh.state).authorityRevision).toBe(admission.authorityRevision + 1n)
    expect(lease(fresh.state, token).epoch).toBe(1n)
  })

  test("I-03 binds and finishes one lease through mutually exclusive authority states", () => {
    // Mutant: remove the reserved-state guard from lease.bind; the second-owner no-op and unchanged-view assertions turn red.
    const instance = key("instance", "i03-bind:instance")
    const root = key("session", "i03-bind:root")
    const token = key("lease", "i03-bind:lease")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const reserved = SessionClosureModel.step(initial, {
      type: "lease.reserve",
      instance,
      lease: {
        id: token,
        session: root,
        epoch: 0n,
        source: "bind",
        origin: "internal",
        retry: "initial",
        kind: "ordinary",
      },
    })
    expect(lease(reserved.state, token).state).toBe("reserved")
    const beforeBind = snapshot(reserved.state)
    const owner = key("scope", "i03-bind:owner")
    const bound = SessionClosureModel.step(reserved.state, {
      type: "lease.bind",
      instance,
      lease: token,
      owner: { type: "scope", id: owner },
    })
    expect(bound.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(bound.state).authorityRevision).toBe(beforeBind.authorityRevision + 1n)
    expect(lease(bound.state, token).state).toBe("bound")
    expect(lease(bound.state, token).owner).toEqual({ type: "scope", id: owner })

    const beforeDuplicate = snapshot(bound.state)
    const duplicate = SessionClosureModel.step(bound.state, {
      type: "lease.bind",
      instance,
      lease: token,
      owner: { type: "scope", id: key("scope", "i03-bind:other") },
    })
    expect(duplicate.decision.type).toBe("noop")
    expect(SessionClosureModel.view(duplicate.state)).toEqual(beforeDuplicate)

    const finished = SessionClosureModel.step(bound.state, {
      type: "lease.finish",
      instance,
      lease: token,
      state: "retired",
    })
    expect(finished.decision).toEqual({ type: "applied" })
    expect(lease(finished.state, token).state).toBe("retired")
  })

  test("I-03 rejects a pre-release mutation epoch and admits the advanced epoch", () => {
    // Mutant: delete epoch equality from mutation.reserve; the stale_epoch assertion turns red.
    const data = prepared("i03-mutation")
    const released = SessionClosureModel.step(data.recorded.state, {
      type: "release.commit",
      instance: data.instance,
      check: data.recorded.check,
    })
    const before = snapshot(released.state)
    expect(released.decision).toEqual({ type: "applied" })
    expect(before.epochs).toContainEqual({ session: data.root, epoch: 1n })
    expect(before.fences.some((item) => item.session === data.root)).toBe(false)
    const token = key("mutation", "i03-mutation:token")
    const stale = SessionClosureModel.step(released.state, {
      type: "mutation.reserve",
      instance: data.instance,
      mutation: {
        id: token,
        sessions: [data.root],
        epochs: [{ session: data.root, epoch: 0n }],
        kind: "remove_message",
      },
    })

    expect(stale.decision).toEqual({ type: "rejected", reason: "stale_epoch" })
    expect(SessionClosureModel.view(stale.state)).toEqual(before)

    const admission = snapshot(stale.state)
    const fresh = SessionClosureModel.step(stale.state, {
      type: "mutation.reserve",
      instance: data.instance,
      mutation: {
        id: token,
        sessions: [data.root],
        epochs: [{ session: data.root, epoch: 1n }],
        kind: "remove_message",
      },
    })
    expect(fresh.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(fresh.state).authorityRevision).toBe(admission.authorityRevision + 1n)
    expect(mutation(fresh.state, token).epochs).toEqual([{ session: data.root, epoch: 1n }])
  })

  test("I-04 emits driver handoff commands without running the next stage under authority", () => {
    // Mutant: emit driver.run from worker.registered instead of waiting for worker.started; the boundary command assertions turn red.
    const instance = key("instance", "i04-driver:instance")
    const root = key("session", "i04-driver:root")
    const operationID = key("operation", "i04-driver:operation")
    const viewID = key("view", "i04-driver:view")
    const waiter = key("waiter", "i04-driver:waiter")
    const ticket = key("ticket", "i04-driver:ticket")
    const repair = key("repair", "i04-driver:repair")
    const worker = key("worker", "i04-driver:worker")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const requested = SessionClosureModel.step(initial, {
      type: "request",
      instance,
      root,
      operation: operationID,
      view: viewID,
      waiter,
      ticket,
      repair,
    })
    const offer = command(requested, "ticket.offer")

    plain(requested)
    expect(types(requested)).toEqual(["ticket.offer"])
    expect(operation(requested.state, operationID).phase.type).toBe("driver_starting")
    expect(operation(requested.state, operationID).driver.state).toBe("starting")

    const received = SessionClosureModel.step(requested.state, { type: "ticket.received", instance, offer })
    expect(types(received)).toEqual([])
    const dequeued = SessionClosureModel.step(received.state, { type: "ticket.dequeued", instance, offer })
    expect(types(dequeued)).toEqual([])
    const accepted = SessionClosureModel.step(dequeued.state, { type: "ticket.accept", instance, offer })
    const registration = command(accepted, "worker.register")

    plain(accepted)
    expect(types(accepted)).toEqual(["worker.register"])
    expect(operation(accepted.state, operationID).driver.state).toBe("starting")

    const registered = SessionClosureModel.step(accepted.state, {
      type: "worker.registered",
      instance,
      registration,
      worker,
    })
    const opening = command(registered, "worker.open")
    const promoted = operation(registered.state, operationID)

    plain(registered)
    expect(types(registered)).toEqual(["worker.open"])
    expect(promoted.driver.state).toBe("running")
    if (promoted.driver.state === "running") expect(promoted.driver.gate).toBe("pending")

    const started = SessionClosureModel.step(registered.state, { type: "worker.started", instance, opening })
    const running = operation(started.state, operationID)

    plain(started)
    expect(types(started)).toEqual(["driver.run"])
    expect(running.driver.state).toBe("running")
    if (running.driver.state === "running") expect(running.driver.gate).toBe("opened")
  })

  test("I-04 transitions an effect through issued, in-flight, and returned boundaries", () => {
    // Mutant: mark the permit in_flight during effect.issue instead of effect.dispatch; the issued-boundary assertion turns red.
    const instance = key("instance", "i04-effect:instance")
    const root = key("session", "i04-effect:root")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const begun = begin({ state: initial, instance, root, prefix: "i04-effect" })
    const permit = key("effect", "i04-effect:permit")
    const before = operation(begun.state, begun.operation)
    const issued = SessionClosureModel.step(begun.state, {
      type: "effect.issue",
      instance,
      permit,
      operation: begun.operation,
      repair: begun.repair,
      revision: before.revision,
      effect: "participant",
    })
    const run = command(issued, "effect.run")

    plain(issued)
    expect(types(issued)).toEqual(["effect.run"])
    expect(operation(issued.state, begun.operation).phase).toEqual(before.phase)
    expect(effect(issued.state, permit).state).toBe("issued")

    const dispatched = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance,
      command: run,
    })
    expect(dispatched.decision).toEqual({ type: "applied" })
    expect(dispatched.commands).toEqual([])
    expect(effect(dispatched.state, permit).state).toBe("in_flight")
    expect(operation(dispatched.state, begun.operation).phase).toEqual(before.phase)

    const returned = SessionClosureModel.step(dispatched.state, {
      type: "effect.return",
      instance,
      command: run,
      result: "success",
    })
    expect(returned.decision).toEqual({ type: "applied" })
    expect(effect(returned.state, permit).state).toBe("returned")
  })

  test("I-05 commits release epoch, fence, view, and delivery under one revision", () => {
    // Mutant: split release.commit so fence removal precedes epoch/view/delivery updates; the joint postcondition assertions turn red.
    const data = prepared("i05-release")
    const before = snapshot(data.recorded.state)
    const beforeOperation = operation(data.recorded.state, data.begun.operation)
    const beforeView = rootview(data.recorded.state, data.begun.operation, data.begun.view)
    const beforeWaiter = beforeOperation.waiters.find((item) => item.id === data.begun.waiter)

    expect(before.epochs).toContainEqual({ session: data.root, epoch: 0n })
    expect(before.fences.some((item) => item.session === data.root)).toBe(true)
    expect(beforeView.result).toBe("pending")
    expect(beforeWaiter?.state).toBe("attached")

    const released = SessionClosureModel.step(data.recorded.state, {
      type: "release.commit",
      instance: data.instance,
      check: data.recorded.check,
    })
    const after = SessionClosureModel.view(released.state)
    const afterOperation = operation(released.state, data.begun.operation)
    const afterView = rootview(released.state, data.begun.operation, data.begun.view)
    const afterWaiter = afterOperation.waiters.find((item) => item.id === data.begun.waiter)
    const delivery = command(released, "waiter.deliver")

    expect(after.authorityRevision).toBe(before.authorityRevision + 1n)
    expect(after.epochs).toContainEqual({ session: data.root, epoch: 1n })
    expect(after.fences.some((item) => item.session === data.root)).toBe(false)
    expect(afterOperation.phase.type).toBe("released_pending_delivery")
    expect(afterView.result).toBe("success")
    expect(afterWaiter?.state).toBe("delivery_reserved")
    expect(afterWaiter?.deliveryRevision).toBe(afterOperation.delivery?.revision)
    expect(delivery.waiters).toEqual([data.begun.waiter])
  })

  test("I-05 rejects a direct phase jump to complete without changing authority", () => {
    // Mutant: remove the phase-graph guard that forbids operation.advance directly to complete; the invalid_phase assertion turns red.
    const instance = key("instance", "i05-phase:instance")
    const root = key("session", "i05-phase:root")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const begun = begin({ state: initial, instance, root, prefix: "i05-phase" })
    const before = snapshot(begun.state)
    expect(operation(begun.state, begun.operation).phase.type).toBe("quiescing")
    const result = SessionClosureModel.step(begun.state, {
      type: "operation.advance",
      instance,
      operation: begun.operation,
      to: { type: "complete" },
    })

    expect(result.decision).toEqual({ type: "rejected", reason: "invalid_phase" })
    expect(result.commands).toEqual([])
    expect(SessionClosureModel.view(result.state)).toEqual(before)
  })

  test("Section 5.3 exhausts Event discriminants and rejects every contract-defined invalid cell", () => {
    // Mutant: replace the undefined-cell rejection with permissive applied fallthrough; an invalid-cell assertion turns red.
    const keys = Object.keys(dispositions).toSorted()
    const expected = Object.entries(dispositions)
      .filter((item) => item[1].kind === "invalid_transition")
      .map((item) => item[0])
      .toSorted()
    expect(keys).toHaveLength(52)
    expect(Object.keys(invalids).toSorted()).toEqual(expected)

    Object.values(invalids).forEach((build) => {
      const cell = build()
      cell.current()
      const before = snapshot(cell.state)
      const result = SessionClosureModel.step(cell.state, cell.event)
      expect(result.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
      expect(result.commands).toEqual([])
      expect(SessionClosureModel.view(result.state)).toEqual(before)
    })
  })

  test("I-06 installs authority only from a proven-connected active leaf", () => {
    // Mutant: treat proven_disjoint as an authoritative active claim; the unchanged negative branch assertion turns red.
    const instance = key("instance", "i06:instance")
    const root = key("session", "i06:root")
    const leaf = key("session", "i06:leaf")
    const initial = SessionClosureModel.make({ instance, sessions: [root, leaf] })
    const started = start({
      state: initial,
      instance,
      root,
      operation: key("operation", "i06:operation"),
      view: key("view", "i06:view"),
      waiter: key("waiter", "i06:waiter"),
      ticket: key("ticket", "i06:ticket"),
      worker: key("worker", "i06:worker"),
      repair: key("repair", "i06:repair"),
    })
    const before = snapshot(started.state)
    const disjoint = SessionClosureModel.step(started.state, {
      type: "operation.claim",
      instance,
      operation: started.offer.operation,
      repair: started.offer.repair,
      revision: operation(started.state, started.offer.operation).revision,
      proofs: [{ value: "proven_disjoint", root, active: leaf }],
      signals: [],
    })

    expect(disjoint.decision).toEqual({ type: "noop", reason: "disjoint" })
    expect(SessionClosureModel.view(disjoint.state)).toEqual(before)

    const connected = SessionClosureModel.step(started.state, {
      type: "operation.claim",
      instance,
      operation: started.offer.operation,
      repair: started.offer.repair,
      revision: operation(started.state, started.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root,
          active: leaf,
          path: [root, leaf],
          edges: [{ id: key("edge", "i06:edge"), owner: root, child: leaf }],
        },
      ],
      signals: [key("effect", "i06:signal")],
    })
    expect(SessionClosureModel.view(connected.state).authorityRevision).toBe(before.authorityRevision + 1n)
    expect(operation(connected.state, started.offer.operation).claims).toEqual([root, leaf].toSorted())
    expect(types(connected)).toEqual(["effect.run"])
  })

  test("I-07 excludes off-path connectors and edges from a connected proof", () => {
    // Mutant: union every proof edge endpoint without checking validated path membership; the exact claim/edge assertions turn red.
    const instance = key("instance", "i07:instance")
    const root = key("session", "i07:root")
    const connector = key("session", "i07:connector")
    const leaf = key("session", "i07:leaf")
    const offpath = key("session", "i07:offpath")
    const initial = SessionClosureModel.make({ instance, sessions: [root, connector, leaf, offpath] })
    const started = start({
      state: initial,
      instance,
      root,
      operation: key("operation", "i07:operation"),
      view: key("view", "i07:view"),
      waiter: key("waiter", "i07:waiter"),
      ticket: key("ticket", "i07:ticket"),
      worker: key("worker", "i07:worker"),
      repair: key("repair", "i07:repair"),
    })
    const first = key("edge", "i07:edge:1")
    const second = key("edge", "i07:edge:2")
    const stray = key("edge", "i07:edge:offpath")
    const claimed = SessionClosureModel.step(started.state, {
      type: "operation.claim",
      instance,
      operation: started.offer.operation,
      repair: started.offer.repair,
      revision: operation(started.state, started.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root,
          active: leaf,
          path: [root, connector, leaf],
          edges: [
            { id: first, owner: root, child: connector },
            { id: second, owner: connector, child: leaf },
            { id: stray, owner: root, child: offpath },
          ],
        },
      ],
      signals: [key("effect", "i07:signal")],
    })
    const current = operation(claimed.state, started.offer.operation)

    expect(current.claims).toEqual([root, connector, leaf].toSorted())
    expect(current.claims).not.toContain(offpath)
    expect(current.edges.map((item) => item.id)).toEqual([first, second].toSorted())
    expect(current.edges.map((item) => item.id)).not.toContain(stray)
    expect(
      current.facts.some((fact) => {
        if (fact.type === "self") return fact.subject === offpath
        if (fact.type === "edge") return fact.subject === offpath || fact.owner === offpath || fact.child === offpath
        return fact.root === offpath
      }),
    ).toBe(false)
  })

  test("I-08 emits the complete signal set in the claim transition", () => {
    // Mutant: emit only the first signal and wait for its result before issuing the second; the immediate complete-set assertion turns red.
    const instance = key("instance", "i08:instance")
    const root = key("session", "i08:root")
    const a = key("session", "i08:a")
    const b = key("session", "i08:b")
    const initial = SessionClosureModel.make({ instance, sessions: [root, a, b] })
    const started = start({
      state: initial,
      instance,
      root,
      operation: key("operation", "i08:operation"),
      view: key("view", "i08:view"),
      waiter: key("waiter", "i08:waiter"),
      ticket: key("ticket", "i08:ticket"),
      worker: key("worker", "i08:worker"),
      repair: key("repair", "i08:repair"),
    })
    const signalA = key("effect", "i08:signal:a")
    const signalB = key("effect", "i08:signal:b")
    const claimed = SessionClosureModel.step(started.state, {
      type: "operation.claim",
      instance,
      operation: started.offer.operation,
      repair: started.offer.repair,
      revision: operation(started.state, started.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root,
          active: a,
          path: [root, a],
          edges: [{ id: key("edge", "i08:edge:a"), owner: root, child: a }],
        },
        {
          value: "proven_connected",
          root,
          active: b,
          path: [root, b],
          edges: [{ id: key("edge", "i08:edge:b"), owner: root, child: b }],
        },
      ],
      signals: [signalB, signalA],
    })
    const runs = claimed.commands.filter(
      (item): item is Extract<SessionClosureModel.Command, { readonly type: "effect.run" }> =>
        item.type === "effect.run" && item.effect === "signal",
    )
    const signals = runs.map((item) => item.permit).toSorted()
    const runA = runs.find((item) => item.permit === signalA)
    const runB = runs.find((item) => item.permit === signalB)
    if (!runA || !runB) throw new Error("missing complete signal commands")

    expect(signals).toEqual([signalA, signalB].toSorted())
    expect(claimed.commands).toHaveLength(2)
    expect(effect(claimed.state, signalA).state).toBe("issued")
    expect(effect(claimed.state, signalB).state).toBe("issued")

    const dispatchedA = SessionClosureModel.step(claimed.state, {
      type: "effect.dispatch",
      instance,
      command: runA,
    })
    expect(dispatchedA.decision).toEqual({ type: "applied" })
    expect(dispatchedA.commands).toEqual([])
    expect(effect(dispatchedA.state, signalA).state).toBe("in_flight")
    expect(effect(dispatchedA.state, signalB).state).toBe("issued")

    const dispatchedB = SessionClosureModel.step(dispatchedA.state, {
      type: "effect.dispatch",
      instance,
      command: runB,
    })
    expect(dispatchedB.decision).toEqual({ type: "applied" })
    expect(dispatchedB.commands).toEqual([])
    expect(effect(dispatchedB.state, signalA).state).toBe("in_flight")
    expect(effect(dispatchedB.state, signalB).state).toBe("in_flight")
  })

  test("I-09 rejects a stale full-coordinate scan before planning", () => {
    // Mutant: compare participant count but not its revision/fresh scan coordinate; the stale unverified assertion turns red.
    const instance = key("instance", "i09:instance")
    const root = key("session", "i09:root")
    const participant = key("participant", "i09:participant")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const begun = begin({ state: initial, instance, root, prefix: "i09" })
    const first = SessionClosureModel.step(begun.state, {
      type: "participant.observe",
      instance,
      operation: begun.operation,
      participant,
      revision: 1n,
    })
    const prior = SessionClosureModel.scan(first.state, begun.operation)
    const changed = SessionClosureModel.step(first.state, {
      type: "participant.observe",
      instance,
      operation: begun.operation,
      participant,
      revision: 2n,
    })
    expect(operation(changed.state, begun.operation).participants).toContainEqual({ id: participant, revision: 2n })

    const stale = SessionClosureModel.step(changed.state, {
      type: "quiescence.prove",
      instance,
      operation: begun.operation,
      prior,
      current: prior,
    })

    expect(stale.decision).toEqual({ type: "rejected", reason: "unverified" })
    expect(types(stale)).not.toContain("plan.read")
    expect(operation(stale.state, begun.operation).phase.type).toBe("quiescing")
    expect(operation(stale.state, begun.operation).generations).toEqual([])

    const fresh = SessionClosureModel.scan(changed.state, begun.operation)
    const stable = SessionClosureModel.step(changed.state, {
      type: "quiescence.prove",
      instance,
      operation: begun.operation,
      prior: fresh,
      current: fresh,
    })
    const planning = SessionClosureModel.step(stable.state, {
      type: "planning.begin",
      instance,
      operation: begun.operation,
    })
    expect(types(planning)).toEqual(["plan.read"])
  })

  test("I-13 preserves both root views and unions their required facts across canonical merge", () => {
    // Mutant: replace the winner's view map with one root during merge; the preserved identity/result/requirements assertions turn red.
    const instance = key("instance", "i13:instance")
    const a = key("session", "i13:a")
    const b = key("session", "i13:b")
    const leaf = key("session", "i13:leaf")
    const initial = SessionClosureModel.make({ instance, sessions: [a, b, leaf] })
    const first = start({
      state: initial,
      instance,
      root: a,
      operation: key("operation", "i13:operation:a"),
      view: key("view", "i13:view:a"),
      waiter: key("waiter", "i13:waiter:a"),
      ticket: key("ticket", "i13:ticket:a"),
      worker: key("worker", "i13:worker:a"),
      repair: key("repair", "i13:repair:a"),
    })
    const second = start({
      state: first.state,
      instance,
      root: b,
      operation: key("operation", "i13:operation:b"),
      view: key("view", "i13:view:b"),
      waiter: key("waiter", "i13:waiter:b"),
      ticket: key("ticket", "i13:ticket:b"),
      worker: key("worker", "i13:worker:b"),
      repair: key("repair", "i13:repair:b"),
    })
    const requiredA = SessionClosureModel.step(second.state, {
      type: "view.require",
      instance,
      operation: first.offer.operation,
      view: key("view", "i13:view:a"),
      nodes: [a, leaf],
      facts: [{ type: "self", subject: a, outcome: "cancelled", yielded: false }],
    })
    const requiredB = SessionClosureModel.step(requiredA.state, {
      type: "view.require",
      instance,
      operation: second.offer.operation,
      view: key("view", "i13:view:b"),
      nodes: [b, leaf],
      facts: [{ type: "self", subject: b, outcome: "completed", yielded: true }],
    })
    const beforeA = structuredClone(rootview(requiredB.state, first.offer.operation, key("view", "i13:view:a")))
    const beforeB = structuredClone(rootview(requiredB.state, second.offer.operation, key("view", "i13:view:b")))
    const claimedA = SessionClosureModel.step(requiredB.state, {
      type: "operation.claim",
      instance,
      operation: first.offer.operation,
      repair: first.offer.repair,
      revision: operation(requiredB.state, first.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root: a,
          active: leaf,
          path: [a, leaf],
          edges: [{ id: key("edge", "i13:edge:a"), owner: a, child: leaf }],
        },
      ],
      signals: [key("effect", "i13:signal:a")],
    })
    const signalA = command(claimedA, "effect.run")
    const dispatchedA = SessionClosureModel.step(claimedA.state, {
      type: "effect.dispatch",
      instance,
      command: signalA,
    })
    const returnedA = SessionClosureModel.step(dispatchedA.state, {
      type: "effect.return",
      instance,
      command: signalA,
      result: "success",
    })
    const claimedB = SessionClosureModel.step(returnedA.state, {
      type: "operation.claim",
      instance,
      operation: second.offer.operation,
      repair: second.offer.repair,
      revision: operation(returnedA.state, second.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root: b,
          active: leaf,
          path: [b, leaf],
          edges: [{ id: key("edge", "i13:edge:b"), owner: b, child: leaf }],
        },
      ],
      signals: [key("effect", "i13:signal:b")],
    })
    const current = operation(claimedB.state, first.offer.operation)
    const afterA = rootview(claimedB.state, first.offer.operation, key("view", "i13:view:a"))
    const afterB = rootview(claimedB.state, first.offer.operation, key("view", "i13:view:b"))

    expect(afterA.id).toBe(beforeA.id)
    expect(afterA.root).toBe(beforeA.root)
    expect(afterA.result).toBe(beforeA.result)
    expect(afterA.nodes).toEqual([a, leaf].toSorted())
    expect(beforeA.facts.length).toBeGreaterThan(0)
    expect(afterA.facts).toEqual(beforeA.facts)
    expect(afterB.id).toBe(beforeB.id)
    expect(afterB.root).toBe(beforeB.root)
    expect(afterB.result).toBe(beforeB.result)
    expect(afterB.nodes).toEqual([b, leaf].toSorted())
    expect(beforeB.facts.length).toBeGreaterThan(0)
    expect(afterB.facts).toEqual(beforeB.facts)
    expect(current.views.map((item) => item.root)).toEqual([a, b].toSorted())
    const facts = [...beforeA.facts, ...beforeB.facts]
    expect(current.facts.map((item) => item.id).toSorted()).toEqual(facts.toSorted())
    expect(afterA.result).toBe("pending")
    expect(afterB.result).toBe("pending")
  })

  test("I-34 length-delimits adversarial fact tuples before root-view deduplication", () => {
    // Mutant: replace segments' length-prefixed encoding with values.join("|"); the two distinct edge facts collapse at view.require.
    const instance = key("instance", "i34-delimiter:instance")
    const root = key("session", "i34-delimiter:root")
    const subjectA = key("session", "x|y")
    const ownerA = key("session", "z")
    const childA = key("session", "w")
    const edgeA = key("edge", "q")
    const subjectB = key("session", "x")
    const ownerB = key("session", "y")
    const childB = key("session", "z")
    const edgeB = key("edge", "w|q")
    const initial = SessionClosureModel.make({
      instance,
      sessions: [root, subjectA, ownerA, childA, subjectB, ownerB, childB],
    })
    const started = start({
      state: initial,
      instance,
      root,
      operation: key("operation", "i34-delimiter:operation"),
      view: key("view", "i34-delimiter:view"),
      waiter: key("waiter", "i34-delimiter:waiter"),
      ticket: key("ticket", "i34-delimiter:ticket"),
      worker: key("worker", "i34-delimiter:worker"),
      repair: key("repair", "i34-delimiter:repair"),
    })
    const first: SessionClosureModel.FactInput = {
      type: "edge",
      subject: subjectA,
      owner: ownerA,
      child: childA,
      edge: edgeA,
      outcome: "completed",
      yielded: false,
    }
    const second: SessionClosureModel.FactInput = {
      type: "edge",
      subject: subjectB,
      owner: ownerB,
      child: childB,
      edge: edgeB,
      outcome: "completed",
      yielded: false,
    }
    const naive = (fact: Extract<SessionClosureModel.FactInput, { readonly type: "edge" }>) =>
      ["edge", fact.subject, fact.owner, fact.child, fact.taskPart ?? fact.edge ?? ""].join("|")
    expect(first).not.toEqual(second)
    expect(naive(first)).toBe(naive(second))
    expect(operation(started.state, started.offer.operation).facts).toEqual([])

    const required = SessionClosureModel.step(started.state, {
      type: "view.require",
      instance,
      operation: started.offer.operation,
      view: key("view", "i34-delimiter:view"),
      nodes: [root, subjectA, ownerA, childA, subjectB, ownerB, childB],
      facts: [first, second],
    })
    const current = operation(required.state, started.offer.operation)
    const view = rootview(required.state, started.offer.operation, key("view", "i34-delimiter:view"))
    expect(required.decision).toEqual({ type: "applied" })
    expect(current.facts).toHaveLength(2)
    expect(new Set(current.facts.map((item) => item.id)).size).toBe(2)
    expect(new Set(current.facts.map((item) => item.key)).size).toBe(2)
    expect(view.facts).toHaveLength(2)
  })

  test("I-13 and I-34 preserve cross-kind edge identities through canonical merge", () => {
    // Baseline defect: factshape erases whether the terminal edge identity came from PartID or EdgeID, so the loser view is remapped to a different fact.
    const instance = key("instance", "i34-cross-kind:instance")
    const a = key("session", "i34-cross-kind:a")
    const b = key("session", "i34-cross-kind:b")
    const shared = key("session", "i34-cross-kind:shared")
    const owner = key("session", "i34-cross-kind:owner")
    const child = key("session", "i34-cross-kind:child")
    const initial = SessionClosureModel.make({ instance, sessions: [a, b, shared, owner, child] })
    const first = start({
      state: initial,
      instance,
      root: a,
      operation: key("operation", "i34-cross-kind:operation:a"),
      view: key("view", "i34-cross-kind:view:a"),
      waiter: key("waiter", "i34-cross-kind:waiter:a"),
      ticket: key("ticket", "i34-cross-kind:ticket:a"),
      worker: key("worker", "i34-cross-kind:worker:a"),
      repair: key("repair", "i34-cross-kind:repair:a"),
    })
    const second = start({
      state: first.state,
      instance,
      root: b,
      operation: key("operation", "i34-cross-kind:operation:b"),
      view: key("view", "i34-cross-kind:view:b"),
      waiter: key("waiter", "i34-cross-kind:waiter:b"),
      ticket: key("ticket", "i34-cross-kind:ticket:b"),
      worker: key("worker", "i34-cross-kind:worker:b"),
      repair: key("repair", "i34-cross-kind:repair:b"),
    })
    const raw = "i34-cross-kind:shared-raw-token"
    const taskPart = key("part", raw)
    const edge = key("edge", raw)
    const sharedFact: SessionClosureModel.FactInput = {
      type: "self",
      subject: shared,
      outcome: "completed",
      yielded: false,
    }
    const edgeWithPart: SessionClosureModel.FactInput = {
      type: "edge",
      subject: child,
      owner,
      child,
      taskPart,
      outcome: "completed",
      yielded: false,
    }
    const edgeWithID: SessionClosureModel.FactInput = {
      type: "edge",
      subject: child,
      owner,
      child,
      edge,
      outcome: "completed",
      yielded: false,
    }
    expect(String(taskPart)).toBe(String(edge))
    expect(edgeWithPart).not.toEqual(edgeWithID)

    const requiredA = SessionClosureModel.step(second.state, {
      type: "view.require",
      instance,
      operation: first.offer.operation,
      view: key("view", "i34-cross-kind:view:a"),
      nodes: [a, shared, owner, child],
      facts: [sharedFact, edgeWithPart, { type: "root", root: a }],
    })
    const requiredB = SessionClosureModel.step(requiredA.state, {
      type: "view.require",
      instance,
      operation: second.offer.operation,
      view: key("view", "i34-cross-kind:view:b"),
      nodes: [b, shared, owner, child],
      facts: [sharedFact, edgeWithID, { type: "root", root: b }],
    })
    const factsA = operation(requiredB.state, first.offer.operation).facts
    const factsB = operation(requiredB.state, second.offer.operation).facts
    const partFact = factsA.find((item) => item.type === "edge" && item.taskPart === taskPart)
    const edgeFact = factsB.find((item) => item.type === "edge" && item.edge === edge)
    const sharedA = factsA.find((item) => item.type === "self" && item.subject === shared)
    const sharedB = factsB.find((item) => item.type === "self" && item.subject === shared)
    const rootA = factsA.find((item) => item.type === "root" && item.root === a)
    const rootB = factsB.find((item) => item.type === "root" && item.root === b)
    if (!partFact || !edgeFact || !sharedA || !sharedB || !rootA || !rootB) throw new Error("missing pre-merge facts")
    expect(factsA).toHaveLength(3)
    expect(factsB).toHaveLength(3)
    expect(partFact.id).not.toBe(edgeFact.id)
    expect(sharedA.id).not.toBe(sharedB.id)
    expect(rootA.id).not.toBe(rootB.id)

    const claimedA = SessionClosureModel.step(requiredB.state, {
      type: "operation.claim",
      instance,
      operation: first.offer.operation,
      repair: first.offer.repair,
      revision: operation(requiredB.state, first.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root: a,
          active: shared,
          path: [a, shared],
          edges: [{ id: key("edge", "i34-cross-kind:proof:a"), owner: a, child: shared }],
        },
      ],
      signals: [key("effect", "i34-cross-kind:signal:a")],
    })
    const signalA = command(claimedA, "effect.run")
    const dispatchedA = SessionClosureModel.step(claimedA.state, {
      type: "effect.dispatch",
      instance,
      command: signalA,
    })
    const returnedA = SessionClosureModel.step(dispatchedA.state, {
      type: "effect.return",
      instance,
      command: signalA,
      result: "success",
    })
    const claimedB = SessionClosureModel.step(returnedA.state, {
      type: "operation.claim",
      instance,
      operation: second.offer.operation,
      repair: second.offer.repair,
      revision: operation(returnedA.state, second.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root: b,
          active: shared,
          path: [b, shared],
          edges: [{ id: key("edge", "i34-cross-kind:proof:b"), owner: b, child: shared }],
        },
      ],
      signals: [key("effect", "i34-cross-kind:signal:b")],
    })
    expect(claimedB.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(claimedB.state).aliases).toContainEqual({
      alias: second.offer.operation,
      canonical: first.offer.operation,
    })

    const current = operation(claimedB.state, first.offer.operation)
    const afterA = rootview(claimedB.state, first.offer.operation, key("view", "i34-cross-kind:view:a"))
    const afterB = rootview(claimedB.state, first.offer.operation, key("view", "i34-cross-kind:view:b"))
    const sharedFacts = current.facts.filter((item) => item.type === "self" && item.subject === shared)
    const edgeFacts = current.facts.filter(
      (item) => item.type === "edge" && item.owner === owner && item.child === child,
    )
    const rootFacts = current.facts.filter((item) => item.type === "root")
    expect(sharedFacts).toHaveLength(1)
    expect(afterA.facts).toContain(sharedA.id)
    expect(afterB.facts).toContain(sharedA.id)
    expect(edgeFacts).toHaveLength(2)
    expect(afterA.facts).toContain(partFact.id)
    expect(afterB.facts).toContain(edgeFact.id)
    expect(rootFacts).toHaveLength(2)
    expect(afterA.facts).toContain(rootA.id)
    expect(afterB.facts).toContain(rootB.id)
    expect(current.facts).toHaveLength(5)
  })

  test("I-19 confines record stages to record and delivery commands", () => {
    // Mutant: emit provider.run from planning.return; the empty freeze-stage command assertion turns red.
    const data = prepared("i19")
    const released = SessionClosureModel.step(data.recorded.state, {
      type: "release.commit",
      instance: data.instance,
      check: data.recorded.check,
    })

    plain(data.recorded.planning)
    expect(types(data.recorded.planning)).toEqual(["plan.read"])
    plain(data.recorded.frozen)
    expect(types(data.recorded.frozen)).toEqual([])
    expect(SessionClosureModel.view(data.recorded.frozen.state).authorityRevision).toBe(
      SessionClosureModel.view(data.recorded.planning.state).authorityRevision + 1n,
    )
    plain(data.recorded.candidate)
    expect(types(data.recorded.candidate)).toEqual(["pair.candidate"])
    plain(data.recorded.issued)
    expect(types(data.recorded.issued)).toEqual(["pair.write"])
    plain(data.recorded.returned)
    expect(types(data.recorded.returned)).toEqual([])
    plain(data.recorded.prepared)
    expect(types(data.recorded.prepared)).toEqual(["release.verify"])
    plain(released)
    expect(types(released)).toEqual(["waiter.deliver"])
  })

  test("I-21 lets only explicit external work join a fence and retry once after release", () => {
    // Mutant: retain internal post-fence admission as executable instead of suppressed; cancellation-owned/no-bind assertions turn red.
    const data = prepared("i21")
    const internalID = key("lease", "i21:internal")
    const internal = SessionClosureModel.step(data.recorded.state, {
      type: "lease.reserve",
      instance: data.instance,
      lease: {
        id: internalID,
        session: data.root,
        epoch: 0n,
        source: "wake",
        origin: "internal",
        retry: "initial",
        kind: "ordinary",
        owner: { type: "scope", id: key("scope", "i21:internal-owner") },
      },
    })

    expect(internal.decision).toEqual({ type: "applied" })
    expect(internal.commands).toEqual([])
    expect(lease(internal.state, internalID).operation).toBe(data.begun.operation)
    expect(lease(internal.state, internalID).state).toBe("suppressed")

    const beforeBind = snapshot(internal.state)
    const blocked = SessionClosureModel.step(internal.state, {
      type: "lease.bind",
      instance: data.instance,
      lease: internalID,
      owner: { type: "scope", id: key("scope", "i21:late-owner") },
    })
    expect(blocked.decision.type).toBe("noop")
    expect(blocked.commands).toEqual([])
    expect(SessionClosureModel.view(blocked.state)).toEqual(beforeBind)

    const token = key("lease", "i21:external")
    const external = SessionClosureModel.step(data.recorded.state, {
      type: "lease.reserve",
      instance: data.instance,
      lease: {
        id: token,
        session: data.root,
        epoch: 0n,
        source: "caller",
        origin: "external",
        retry: "initial",
        kind: "ordinary",
      },
    })
    expect(external.decision.type).toBe("joined")
    if (external.decision.type === "joined") expect(external.decision.operation).toBe(data.begun.operation)

    const released = SessionClosureModel.step(external.state, {
      type: "release.commit",
      instance: data.instance,
      check: data.recorded.check,
    })
    const releasedView = SessionClosureModel.view(released.state)
    expect(released.decision).toEqual({ type: "applied" })
    expect(releasedView.epochs).toContainEqual({ session: data.root, epoch: 1n })
    expect(releasedView.fences.some((item) => item.session === data.root)).toBe(false)
    const cleanup = SessionClosureModel.step(released.state, {
      type: "cleanup",
      instance: data.instance,
      lease: token,
    })
    expect(cleanup.decision).toEqual({ type: "noop", reason: "settled" })
    expect(SessionClosureModel.view(cleanup.state)).toEqual(releasedView)

    const retry = SessionClosureModel.step(cleanup.state, {
      type: "lease.reserve",
      instance: data.instance,
      lease: {
        id: token,
        session: data.root,
        epoch: 1n,
        source: "caller",
        origin: "external",
        retry: "post_closure_external_retry",
        kind: "ordinary",
      },
    })
    expect(retry.decision).toEqual({ type: "applied" })
    expect(lease(retry.state, token).epoch).toBe(1n)

    const duplicate = SessionClosureModel.step(retry.state, {
      type: "lease.reserve",
      instance: data.instance,
      lease: {
        id: token,
        session: data.root,
        epoch: 1n,
        source: "caller",
        origin: "external",
        retry: "post_closure_external_retry",
        kind: "ordinary",
      },
    })
    expect(duplicate.decision).toEqual({ type: "noop", reason: "duplicate" })
    expect(SessionClosureModel.view(duplicate.state).leases.filter((item) => item.id === token)).toHaveLength(1)
  })

  test("I-22 fences an intersecting mutation until atomic release", () => {
    // Mutant: delete the intersecting-fence check from mutation.reserve; the immediate fenced assertion turns red.
    const data = prepared("i22")
    const before = snapshot(data.recorded.state)
    expect(types(data.recorded.prepared)).toEqual(["release.verify"])
    expect(before.fences.some((item) => item.session === data.root)).toBe(true)
    expect(operation(data.recorded.state, data.begun.operation).phase.type).toBe("recording")
    const blocked = SessionClosureModel.step(data.recorded.state, {
      type: "mutation.reserve",
      instance: data.instance,
      mutation: {
        id: key("mutation", "i22:blocked"),
        sessions: [data.root],
        epochs: [{ session: data.root, epoch: 0n }],
        kind: "revert",
      },
    })

    expect(blocked.decision).toEqual({ type: "rejected", reason: "fenced" })
    expect(SessionClosureModel.view(blocked.state)).toEqual(before)

    const released = SessionClosureModel.step(blocked.state, {
      type: "release.commit",
      instance: data.instance,
      check: data.recorded.check,
    })
    const fresh = SessionClosureModel.step(released.state, {
      type: "mutation.reserve",
      instance: data.instance,
      mutation: {
        id: key("mutation", "i22:fresh"),
        sessions: [data.root],
        epochs: [{ session: data.root, epoch: 1n }],
        kind: "revert",
      },
    })
    expect(fresh.decision).toEqual({ type: "applied" })
  })

  // CP-023 §7.6 / K108 — the three fence states the K row names, and the epoch falsifier.
  //
  // The I-22 test above covers `recording` and shows that a post-release reserve at the NEXT epoch
  // is applied. Three things it cannot state are stated here.
  //
  // FIRST, `recording` is one of eight fence states §7.6 lists, and `mutation.reserve` does not read
  // the state at all — `model.ts:2096` refuses on fence PRESENCE. That is the correct design, but it
  // means a state-conditional regression would be invisible from `recording` alone. K108 names
  // planning and retained failure explicitly, so both are driven.
  //
  // SECOND, the post-release reserve at epoch 1n would also pass if the model ignored `observedEpochs`
  // entirely — the earlier refusal was `fenced`, not stale. "Uses a new epoch" is only a claim if
  // carrying the OLD one is refused, so that is asserted here.
  test("K108 refuses an intersecting mutation while the fence is in planning", () => {
    // Mutant: delete the intersecting-fence check from mutation.reserve; the fenced assertion turns red.
    const instance = key("instance", "k108-planning:instance")
    const root = key("session", "k108-planning:root")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const begun = begin({ state: initial, instance, root, prefix: "k108-planning" })
    const frozen = freeze({ state: begun.state, instance, root, operation: begun.operation, prefix: "k108-planning" })

    // Positive precondition: this is genuinely the planning phase, and the fence carries that state
    // rather than a leftover `closing`. Without it the refusal below would only re-prove `recording`.
    expect(operation(frozen.planning.state, begun.operation).phase.type).toBe("planning")
    const before = snapshot(frozen.planning.state)
    expect(before.fences.find((item) => item.session === root)?.state).toBe("planning")

    const blocked = SessionClosureModel.step(frozen.planning.state, {
      type: "mutation.reserve",
      instance,
      mutation: {
        id: key("mutation", "k108-planning:blocked"),
        sessions: [root],
        epochs: [{ session: root, epoch: 0n }],
        kind: "replace_part",
      },
    })

    expect(blocked.decision).toEqual({ type: "rejected", reason: "fenced" })
    // Byte-equal state is the model-level form of "rejects before mutation": nothing was reserved,
    // so nothing can later be activated.
    expect(SessionClosureModel.view(blocked.state)).toEqual(before)
  })

  test("K108 refuses an intersecting mutation while a retained failure holds the fence", () => {
    // Mutant: delete the intersecting-fence check from mutation.reserve; the fenced assertion turns red.
    const instance = key("instance", "k108-failed:instance")
    const root = key("session", "k108-failed:root")
    const token = key("lease", "k108-failed:pre-bind")
    const owner = key("scope", "k108-failed:scope")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const reserved = SessionClosureModel.step(initial, {
      type: "lease.reserve",
      instance,
      lease: {
        id: token,
        session: root,
        epoch: 0n,
        source: "prompt-setup",
        origin: "internal",
        retry: "initial",
        kind: "pre_bind",
        owner: { type: "scope", id: owner },
      },
    })
    const begun = begin({ state: reserved.state, instance, root, prefix: "k108-failed" })
    const failed = SessionClosureModel.step(begun.state, {
      type: "lease.finish",
      instance,
      lease: token,
      state: "failed",
    })

    // Positive precondition: a RETAINED failure — §7.6 lists `quiescence_failed` among the states
    // that must reject, and the distinguishing property is that the fence survives the failure
    // rather than being cleaned up with it.
    expect(operation(failed.state, begun.operation).phase.type).toBe("quiescence_failed")
    const before = snapshot(failed.state)
    expect(before.fences.some((item) => item.session === root)).toBe(true)

    // THE FENCE'S PROJECTED STATE DELIBERATELY DOES NOT FOLLOW THE FAILURE, and asserting the
    // surprising value is the point. `fail` is the one phase-setting site that does not call
    // `updatefences`, so the fence keeps the state it held when the failure landed. That is not an
    // omission: I-20 requires a failure to retain the exact fence, and
    // `closure-driver-model.test.ts` asserts `view(...).fences` is byte-identical across all three
    // failure kinds. Adding the projection here turns those five tests red.
    //
    // The consequence is worth recording rather than fixing under this K row. Mutation refusal is
    // unaffected — `model.ts:2096` refuses on fence PRESENCE and reports `reason: "fenced"`, never
    // the state — but `acquireLocked` reports `state: current.state` from the fence record, so an
    // ADMISSION refused during a retained failure answers `closing`. Whether `AdmissionRefused`
    // must distinguish "closing normally" from "retained failure, needs repair" is a §12 typed-
    // failure question against I-20, not something this row may decide unilaterally.
    expect(before.fences.find((item) => item.session === root)?.state).toBe("closing")

    const blocked = SessionClosureModel.step(failed.state, {
      type: "mutation.reserve",
      instance,
      mutation: {
        id: key("mutation", "k108-failed:blocked"),
        sessions: [root],
        epochs: [{ session: root, epoch: 0n }],
        kind: "replace_part",
      },
    })

    expect(blocked.decision).toEqual({ type: "rejected", reason: "fenced" })
    expect(SessionClosureModel.view(blocked.state)).toEqual(before)
  })

  test("K108 an explicit post-release retry carrying the pre-release epoch is refused as stale", () => {
    // Mutant: delete the stale-epoch check from mutation.reserve; the stale assertion turns red.
    const data = prepared("k108-epoch")
    const observed = SessionClosureModel.view(data.recorded.state).epochs.find(
      (item) => item.session === data.root,
    )?.epoch
    // Positive precondition: the epoch a pre-release caller would have observed is 0n, so the
    // retry below carries a genuinely stale value rather than an arbitrary one.
    expect(observed).toBe(0n)

    const released = SessionClosureModel.step(data.recorded.state, {
      type: "release.commit",
      instance: data.instance,
      check: data.recorded.check,
    })
    expect(released.decision).toEqual({ type: "applied" })
    const after = SessionClosureModel.view(released.state)
    expect(after.fences.some((item) => item.session === data.root)).toBe(false)
    expect(after.epochs.find((item) => item.session === data.root)?.epoch).toBe(1n)

    // §7.6: "It is not queued to run after release. The caller may explicitly retry after closure."
    // A retry is EXPLICIT and therefore re-observes; one that replayed its pre-release observation
    // would be reasoning about a view the release invalidated, so it is refused — and refused for
    // `stale_epoch`, not `fenced`, because the fence is gone.
    const stale = SessionClosureModel.step(released.state, {
      type: "mutation.reserve",
      instance: data.instance,
      mutation: {
        id: key("mutation", "k108-epoch:stale"),
        sessions: [data.root],
        epochs: [{ session: data.root, epoch: 0n }],
        kind: "replace_part",
      },
    })
    expect(stale.decision).toEqual({ type: "rejected", reason: "stale_epoch" })
    expect(SessionClosureModel.view(stale.state)).toEqual(after)

    // And the same retry at the new epoch is admitted, so the refusal above is attributable to the
    // epoch rather than to anything else the release changed.
    const fresh = SessionClosureModel.step(stale.state, {
      type: "mutation.reserve",
      instance: data.instance,
      mutation: {
        id: key("mutation", "k108-epoch:fresh"),
        sessions: [data.root],
        epochs: [{ session: data.root, epoch: 1n }],
        kind: "replace_part",
      },
    })
    expect(fresh.decision).toEqual({ type: "applied" })
    expect(mutation(fresh.state, key("mutation", "k108-epoch:fresh")).epochs).toEqual([
      { session: data.root, epoch: 1n },
    ])
  })

  test("I-22 activates and retires a mutation exactly once", () => {
    // Mutant: remove the retired-state guard from mutation.activate; the stale reactivation/no-change assertions turn red.
    const instance = key("instance", "i22-state:instance")
    const root = key("session", "i22-state:root")
    const token = key("mutation", "i22-state:mutation")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const reserved = SessionClosureModel.step(initial, {
      type: "mutation.reserve",
      instance,
      mutation: {
        id: token,
        sessions: [root],
        epochs: [{ session: root, epoch: 0n }],
        kind: "remove_part",
      },
    })
    expect(mutation(reserved.state, token).state).toBe("reserved")
    const activated = SessionClosureModel.step(reserved.state, {
      type: "mutation.activate",
      instance,
      mutation: token,
    })
    expect(activated.decision).toEqual({ type: "applied" })
    expect(mutation(activated.state, token).state).toBe("active")
    const retired = SessionClosureModel.step(activated.state, {
      type: "mutation.retire",
      instance,
      mutation: token,
    })
    expect(retired.decision).toEqual({ type: "applied" })
    expect(mutation(retired.state, token).state).toBe("retired")

    const before = snapshot(retired.state)
    const stale = SessionClosureModel.step(retired.state, {
      type: "mutation.activate",
      instance,
      mutation: token,
    })
    expect(stale.decision.type).toBe("noop")
    expect(SessionClosureModel.view(stale.state)).toEqual(before)
  })

  test("I-09 and I-22 prevent release while a late claim owns a live mutation", () => {
    // Baseline defect: readyToRelease checks live Effects and complete generations but not an active mutation adopted after the proven fixed point.
    const instance = key("instance", "i22-late-mutation:instance")
    const root = key("session", "i22-late-mutation:root")
    const extra = key("session", "i22-late-mutation:extra")
    const token = key("mutation", "i22-late-mutation:mutation")
    const initial = SessionClosureModel.make({ instance, sessions: [root, extra] })
    const reserved = SessionClosureModel.step(initial, {
      type: "mutation.reserve",
      instance,
      mutation: {
        id: token,
        sessions: [extra],
        epochs: [{ session: extra, epoch: 0n }],
        kind: "remove_part",
      },
    })
    const activated = SessionClosureModel.step(reserved.state, {
      type: "mutation.activate",
      instance,
      mutation: token,
    })
    expect(activated.decision).toEqual({ type: "applied" })
    expect(mutation(activated.state, token).state).toBe("active")
    expect(mutation(activated.state, token).operation).toBeUndefined()

    const begun = begin({ state: activated.state, instance, root, prefix: "i22-late-mutation" })
    expect(operation(begun.state, begun.operation).claims).not.toContain(extra)
    expect(operation(begun.state, begun.operation).mutationLeases).toEqual([])
    const recorded = record({
      state: begun.state,
      instance,
      root,
      operation: begun.operation,
      repair: begun.repair,
      prefix: "i22-late-mutation",
    })
    const ready = recorded.returned.state
    expect(recorded.prepared.decision).toEqual({ type: "applied" })
    expect(types(recorded.prepared)).toEqual(["release.verify"])
    expect(operation(ready, begun.operation).phase.type).toBe("recording")
    expect(
      operation(ready, begun.operation).generations.every((item) => item.committedPrefix === item.facts.length),
    ).toBe(true)

    const signal = key("effect", "i22-late-mutation:late-signal")
    const current = operation(ready, begun.operation)
    const claimed = SessionClosureModel.step(ready, {
      type: "operation.claim",
      instance,
      operation: begun.operation,
      repair: begun.repair,
      revision: current.revision,
      proofs: [
        {
          value: "proven_connected",
          root,
          active: extra,
          path: [root, extra],
          edges: [{ id: key("edge", "i22-late-mutation:edge"), owner: root, child: extra }],
        },
      ],
      signals: [signal],
    })
    const run = command(claimed, "effect.run")
    expect(claimed.decision).toEqual({ type: "applied" })
    expect(operation(claimed.state, begun.operation).claims).toContain(extra)
    expect(operation(claimed.state, begun.operation).mutationLeases).toContain(token)
    expect(mutation(claimed.state, token)).toMatchObject({ state: "active", operation: begun.operation })
    expect(effect(claimed.state, signal).state).toBe("issued")

    const blockedIssued = SessionClosureModel.step(claimed.state, {
      type: "release.prepare",
      instance,
      operation: begun.operation,
    })
    expect(blockedIssued.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(blockedIssued.commands).toEqual([])

    const dispatched = SessionClosureModel.step(claimed.state, {
      type: "effect.dispatch",
      instance,
      command: run,
    })
    expect(effect(dispatched.state, signal).state).toBe("in_flight")
    const blockedInFlight = SessionClosureModel.step(dispatched.state, {
      type: "release.prepare",
      instance,
      operation: begun.operation,
    })
    expect(blockedInFlight.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(blockedInFlight.commands).toEqual([])

    const returned = SessionClosureModel.step(dispatched.state, {
      type: "effect.return",
      instance,
      command: run,
      result: "success",
    })
    expect(effect(returned.state, signal).state).toBe("returned")
    expect(mutation(returned.state, token)).toMatchObject({ state: "active", operation: begun.operation })
    expect(operation(returned.state, begun.operation).successors).toEqual([])

    const before = snapshot(returned.state)
    const blockedMutation = SessionClosureModel.step(returned.state, {
      type: "release.prepare",
      instance,
      operation: begun.operation,
    })
    expect(blockedMutation.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(blockedMutation.commands).toEqual([])
    expect(SessionClosureModel.view(blockedMutation.state)).toEqual(before)
  })

  test("I-28 rejects a fabricated effect result with the wrong operation revision", () => {
    // Mutant: delete operation-revision validation from effect.return; the forged-result/no-change assertions turn red.
    const instance = key("instance", "i28:instance")
    const root = key("session", "i28:root")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const begun = begin({ state: initial, instance, root, prefix: "i28" })
    const permit = key("effect", "i28:permit")
    const issued = SessionClosureModel.step(begun.state, {
      type: "effect.issue",
      instance,
      permit,
      operation: begun.operation,
      repair: begun.repair,
      revision: operation(begun.state, begun.operation).revision,
      effect: "participant",
    })
    const run = command(issued, "effect.run")
    expect(effect(issued.state, permit).state).toBe("issued")
    const dispatched = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance,
      command: run,
    })
    expect(dispatched.decision).toEqual({ type: "applied" })
    expect(dispatched.commands).toEqual([])
    expect(effect(dispatched.state, permit).state).toBe("in_flight")
    const forged: Extract<SessionClosureModel.Command, { readonly type: "effect.run" }> = {
      ...run,
      revision: run.revision + 1n,
    }
    const before = snapshot(dispatched.state)
    const stale = SessionClosureModel.step(dispatched.state, {
      type: "effect.return",
      instance,
      command: forged,
      result: "success",
    })
    expect(stale.decision).toEqual({ type: "noop", reason: "stale" })
    expect(SessionClosureModel.view(stale.state)).toEqual(before)

    const exact = SessionClosureModel.step(dispatched.state, {
      type: "effect.return",
      instance,
      command: run,
      result: "success",
    })
    expect(exact.decision).toEqual({ type: "applied" })
    expect(effect(exact.state, permit).state).toBe("returned")
  })

  test("I-28 rejects independent operation attempt and revision coordinate collisions", () => {
    // Mutants: delete each of exactEffect's operation, repair, and revision conjuncts independently; its one-field forgery dispatches.
    const instance = key("instance", "i28-coordinate:instance")
    const a = key("session", "i28-coordinate:a")
    const b = key("session", "i28-coordinate:b")
    const sharedRepair = key("repair", "i28-coordinate:shared-repair")
    const operationA = key("operation", "i28-coordinate:operation:a")
    const operationB = key("operation", "i28-coordinate:operation:b")
    const initial = SessionClosureModel.make({ instance, sessions: [a, b] })
    const first = start({
      state: initial,
      instance,
      root: a,
      operation: operationA,
      view: key("view", "i28-coordinate:view:a"),
      waiter: key("waiter", "i28-coordinate:waiter:a"),
      ticket: key("ticket", "i28-coordinate:ticket:a"),
      worker: key("worker", "i28-coordinate:worker:a"),
      repair: sharedRepair,
    })
    const second = start({
      state: first.state,
      instance,
      root: b,
      operation: operationB,
      view: key("view", "i28-coordinate:view:b"),
      waiter: key("waiter", "i28-coordinate:waiter:b"),
      ticket: key("ticket", "i28-coordinate:ticket:b"),
      worker: key("worker", "i28-coordinate:worker:b"),
      repair: sharedRepair,
    })
    const authorityA = operation(second.state, operationA)
    const authorityB = operation(second.state, operationB)
    expect(authorityA.id).not.toBe(authorityB.id)
    expect(authorityA.repair).toBe(sharedRepair)
    expect(authorityB.repair).toBe(sharedRepair)
    expect(authorityA.revision).toBe(authorityB.revision)

    const permit = key("effect", "i28-coordinate:permit")
    const issued = SessionClosureModel.step(second.state, {
      type: "effect.issue",
      instance,
      permit,
      operation: operationA,
      repair: sharedRepair,
      revision: authorityA.revision,
      effect: "participant",
    })
    const run = command(issued, "effect.run")
    expect(issued.decision).toEqual({ type: "applied" })
    expect(effect(issued.state, permit).state).toBe("issued")

    const reject = (forged: Extract<SessionClosureModel.Command, { readonly type: "effect.run" }>) => {
      const before = snapshot(issued.state)
      const result = SessionClosureModel.step(issued.state, {
        type: "effect.dispatch",
        instance,
        command: forged,
      })
      expect(result.decision).toEqual({ type: "noop", reason: "stale" })
      expect(result.commands).toEqual([])
      expect(effect(result.state, permit).state).toBe("issued")
      expect(SessionClosureModel.view(result.state)).toEqual(before)
    }

    reject({ ...run, operation: operationB })
    reject({ ...run, repair: key("repair", "i28-coordinate:foreign-repair") })
    reject({ ...run, revision: run.revision + 1n })

    const exact = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance,
      command: run,
    })
    expect(exact.decision).toEqual({ type: "applied" })
    expect(effect(exact.state, permit).state).toBe("in_flight")
  })

  test("I-28 revokes a losing issued effect before it can dispatch", () => {
    // Mutant: retain issued loser permits during canonical merge; the stale-dispatch/no-change assertions turn red.
    const instance = key("instance", "i28-issued-merge:instance")
    const a = key("session", "i28-issued-merge:a")
    const b = key("session", "i28-issued-merge:b")
    const leaf = key("session", "i28-issued-merge:leaf")
    const initial = SessionClosureModel.make({ instance, sessions: [a, b, leaf] })
    const first = start({
      state: initial,
      instance,
      root: a,
      operation: key("operation", "i28-issued-merge:operation:a"),
      view: key("view", "i28-issued-merge:view:a"),
      waiter: key("waiter", "i28-issued-merge:waiter:a"),
      ticket: key("ticket", "i28-issued-merge:ticket:a"),
      worker: key("worker", "i28-issued-merge:worker:a"),
      repair: key("repair", "i28-issued-merge:repair:a"),
    })
    const second = start({
      state: first.state,
      instance,
      root: b,
      operation: key("operation", "i28-issued-merge:operation:b"),
      view: key("view", "i28-issued-merge:view:b"),
      waiter: key("waiter", "i28-issued-merge:waiter:b"),
      ticket: key("ticket", "i28-issued-merge:ticket:b"),
      worker: key("worker", "i28-issued-merge:worker:b"),
      repair: key("repair", "i28-issued-merge:repair:b"),
    })
    const claimedA = SessionClosureModel.step(second.state, {
      type: "operation.claim",
      instance,
      operation: first.offer.operation,
      repair: first.offer.repair,
      revision: operation(second.state, first.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root: a,
          active: leaf,
          path: [a, leaf],
          edges: [{ id: key("edge", "i28-issued-merge:edge:a"), owner: a, child: leaf }],
        },
      ],
      signals: [key("effect", "i28-issued-merge:signal:a")],
    })
    const signalA = command(claimedA, "effect.run")
    const dispatchedA = SessionClosureModel.step(claimedA.state, {
      type: "effect.dispatch",
      instance,
      command: signalA,
    })
    const returnedA = SessionClosureModel.step(dispatchedA.state, {
      type: "effect.return",
      instance,
      command: signalA,
      result: "success",
    })
    const permit = key("effect", "i28-issued-merge:permit")
    const issued = SessionClosureModel.step(returnedA.state, {
      type: "effect.issue",
      instance,
      permit,
      operation: second.offer.operation,
      repair: second.offer.repair,
      revision: operation(returnedA.state, second.offer.operation).revision,
      effect: "participant",
    })
    const run = command(issued, "effect.run")
    expect(effect(issued.state, permit).state).toBe("issued")
    expect(SessionClosureModel.view(issued.state).aliases.some((item) => item.alias === second.offer.operation)).toBe(
      false,
    )

    const beforeMerge = snapshot(issued.state)
    const merged = SessionClosureModel.step(issued.state, {
      type: "operation.claim",
      instance,
      operation: second.offer.operation,
      repair: second.offer.repair,
      revision: operation(issued.state, second.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root: b,
          active: leaf,
          path: [b, leaf],
          edges: [{ id: key("edge", "i28-issued-merge:edge:b"), owner: b, child: leaf }],
        },
      ],
      signals: [key("effect", "i28-issued-merge:signal:b")],
    })
    const mergedView = SessionClosureModel.view(merged.state)
    expect(mergedView.authorityRevision).toBe(beforeMerge.authorityRevision + 1n)
    expect(mergedView.aliases).toContainEqual({ alias: second.offer.operation, canonical: first.offer.operation })
    expect(effect(merged.state, permit).state).toBe("revoked")

    const beforeDispatch = snapshot(merged.state)
    const stale = SessionClosureModel.step(merged.state, {
      type: "effect.dispatch",
      instance,
      command: run,
    })
    expect(stale.decision).toEqual({ type: "noop", reason: "stale" })
    expect(stale.commands).toEqual([])
    expect(effect(stale.state, permit).state).toBe("revoked")
    expect(SessionClosureModel.view(stale.state)).toEqual(beforeDispatch)
  })

  test("I-28 imports an in-flight losing effect once without follow-on authority", () => {
    // Mutant: retain the loser's revision as effect.issue authority after import; the follow-on no-command/absence assertions turn red.
    const instance = key("instance", "i28-effect-merge:instance")
    const a = key("session", "i28-effect-merge:a")
    const b = key("session", "i28-effect-merge:b")
    const leaf = key("session", "i28-effect-merge:leaf")
    const initial = SessionClosureModel.make({ instance, sessions: [a, b, leaf] })
    const first = start({
      state: initial,
      instance,
      root: a,
      operation: key("operation", "i28-effect-merge:operation:a"),
      view: key("view", "i28-effect-merge:view:a"),
      waiter: key("waiter", "i28-effect-merge:waiter:a"),
      ticket: key("ticket", "i28-effect-merge:ticket:a"),
      worker: key("worker", "i28-effect-merge:worker:a"),
      repair: key("repair", "i28-effect-merge:repair:a"),
    })
    const second = start({
      state: first.state,
      instance,
      root: b,
      operation: key("operation", "i28-effect-merge:operation:b"),
      view: key("view", "i28-effect-merge:view:b"),
      waiter: key("waiter", "i28-effect-merge:waiter:b"),
      ticket: key("ticket", "i28-effect-merge:ticket:b"),
      worker: key("worker", "i28-effect-merge:worker:b"),
      repair: key("repair", "i28-effect-merge:repair:b"),
    })
    const claimedA = SessionClosureModel.step(second.state, {
      type: "operation.claim",
      instance,
      operation: first.offer.operation,
      repair: first.offer.repair,
      revision: operation(second.state, first.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root: a,
          active: leaf,
          path: [a, leaf],
          edges: [{ id: key("edge", "i28-effect-merge:edge:a"), owner: a, child: leaf }],
        },
      ],
      signals: [key("effect", "i28-effect-merge:signal:a")],
    })
    const signalA = command(claimedA, "effect.run")
    const dispatchedA = SessionClosureModel.step(claimedA.state, {
      type: "effect.dispatch",
      instance,
      command: signalA,
    })
    const returnedA = SessionClosureModel.step(dispatchedA.state, {
      type: "effect.return",
      instance,
      command: signalA,
      result: "success",
    })
    const permit = key("effect", "i28-effect-merge:permit")
    const issued = SessionClosureModel.step(returnedA.state, {
      type: "effect.issue",
      instance,
      permit,
      operation: second.offer.operation,
      repair: second.offer.repair,
      revision: operation(returnedA.state, second.offer.operation).revision,
      effect: "participant",
    })
    const run = command(issued, "effect.run")
    expect(types(issued)).toEqual(["effect.run"])
    expect(effect(issued.state, permit).state).toBe("issued")
    const dispatched = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance,
      command: run,
    })
    expect(dispatched.decision).toEqual({ type: "applied" })
    expect(dispatched.commands).toEqual([])
    expect(effect(dispatched.state, permit).state).toBe("in_flight")
    expect(
      SessionClosureModel.view(dispatched.state).aliases.some((item) => item.alias === second.offer.operation),
    ).toBe(false)

    const beforeMerge = snapshot(dispatched.state)
    const merged = SessionClosureModel.step(dispatched.state, {
      type: "operation.claim",
      instance,
      operation: second.offer.operation,
      repair: second.offer.repair,
      revision: operation(dispatched.state, second.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root: b,
          active: leaf,
          path: [b, leaf],
          edges: [{ id: key("edge", "i28-effect-merge:edge:b"), owner: b, child: leaf }],
        },
      ],
      signals: [key("effect", "i28-effect-merge:signal:b")],
    })
    const mergedView = SessionClosureModel.view(merged.state)
    expect(mergedView.authorityRevision).toBe(beforeMerge.authorityRevision + 1n)
    expect(mergedView.aliases).toContainEqual({ alias: second.offer.operation, canonical: first.offer.operation })
    expect(effect(merged.state, permit).state).toBe("in_flight")

    const effects = mergedView.effects.map((item) => item.id)
    const imported = SessionClosureModel.step(merged.state, {
      type: "effect.return",
      instance,
      command: run,
      result: "success",
    })
    expect(imported.decision).toEqual({ type: "applied" })
    expect(imported.commands).toEqual([])
    expect(effect(imported.state, permit).state).toBe("returned")
    expect(SessionClosureModel.view(imported.state).effects.map((item) => item.id)).toEqual(effects)

    const beforeReplay = snapshot(imported.state)
    const replayed = SessionClosureModel.step(imported.state, {
      type: "effect.return",
      instance,
      command: run,
      result: "success",
    })
    expect(replayed.decision.type).toBe("noop")
    expect(replayed.commands).toEqual([])
    expect(SessionClosureModel.view(replayed.state)).toEqual(beforeReplay)

    const followID = key("effect", "i28-effect-merge:follow")
    const beforeFollow = snapshot(imported.state)
    const follow = SessionClosureModel.step(imported.state, {
      type: "effect.issue",
      instance,
      permit: followID,
      operation: second.offer.operation,
      repair: second.offer.repair,
      revision: run.revision,
      effect: "participant",
    })
    expect(["rejected", "noop"]).toContain(follow.decision.type)
    expect(follow.commands).toEqual([])
    expect(SessionClosureModel.view(follow.state).effects.some((item) => item.id === followID)).toBe(false)
    expect(SessionClosureModel.view(follow.state)).toEqual(beforeFollow)
  })

  test("I-28 imports one in-flight losing pair without authorizing its next fact", () => {
    // Mutant: carry an imported loser's candidate authority to the next prefix; the follow-on pair.issue assertions turn red.
    const instance = key("instance", "i28-pair-merge:instance")
    const a = key("session", "i28-pair-merge:a")
    const b = key("session", "i28-pair-merge:b")
    const initial = SessionClosureModel.make({ instance, sessions: [a, b] })
    const first = start({
      state: initial,
      instance,
      root: a,
      operation: key("operation", "i28-pair-merge:operation:a"),
      view: key("view", "i28-pair-merge:view:a"),
      waiter: key("waiter", "i28-pair-merge:waiter:a"),
      ticket: key("ticket", "i28-pair-merge:ticket:a"),
      worker: key("worker", "i28-pair-merge:worker:a"),
      repair: key("repair", "i28-pair-merge:repair:a"),
    })
    const second = start({
      state: first.state,
      instance,
      root: b,
      operation: key("operation", "i28-pair-merge:operation:b"),
      view: key("view", "i28-pair-merge:view:b"),
      waiter: key("waiter", "i28-pair-merge:waiter:b"),
      ticket: key("ticket", "i28-pair-merge:ticket:b"),
      worker: key("worker", "i28-pair-merge:worker:b"),
      repair: key("repair", "i28-pair-merge:repair:b"),
    })
    const claimedB = SessionClosureModel.step(second.state, {
      type: "operation.claim",
      instance,
      operation: second.offer.operation,
      repair: second.offer.repair,
      revision: operation(second.state, second.offer.operation).revision,
      proofs: [{ value: "proven_connected", root: b, active: b, path: [b], edges: [] }],
      signals: [key("effect", "i28-pair-merge:signal:b")],
    })
    const signalB = command(claimedB, "effect.run")
    const dispatchedB = SessionClosureModel.step(claimedB.state, {
      type: "effect.dispatch",
      instance,
      command: signalB,
    })
    const returnedB = SessionClosureModel.step(dispatchedB.state, {
      type: "effect.return",
      instance,
      command: signalB,
      result: "success",
    })
    const requiredB = SessionClosureModel.step(returnedB.state, {
      type: "view.require",
      instance,
      operation: second.offer.operation,
      view: key("view", "i28-pair-merge:view:b"),
      nodes: [b],
      facts: [
        { type: "self", subject: b, outcome: "cancelled", yielded: false },
        { type: "root", root: b, direct: { outcome: "cancelled", yielded: false } },
      ],
    })
    const fencingB = SessionClosureModel.step(requiredB.state, {
      type: "operation.advance",
      instance,
      operation: second.offer.operation,
      to: { type: "fencing" },
    })
    const quiescingB = SessionClosureModel.step(fencingB.state, {
      type: "operation.advance",
      instance,
      operation: second.offer.operation,
      to: { type: "quiescing" },
    })
    const frozenB = freeze({
      state: quiescingB.state,
      instance,
      root: b,
      operation: second.offer.operation,
      prefix: "i28-pair-merge",
    })
    const candidate = SessionClosureModel.step(frozenB.state, {
      type: "writer.next",
      instance,
      operation: second.offer.operation,
    })
    const next = command(candidate, "pair.candidate")
    const permit = key("pair", "i28-pair-merge:permit")
    const issued = SessionClosureModel.step(candidate.state, {
      type: "pair.issue",
      instance,
      candidate: next,
      permit,
    })
    const write = command(issued, "pair.write")
    const predecessor = generation(issued.state, second.offer.operation, next.freezeOwner, next.generation)
    const remaining = predecessor.facts.find((fact) => fact !== next.fact)
    if (!remaining) throw new Error("missing unpermitted successor fact")

    expect(pair(issued.state, permit).state).toBe("in_flight")
    expect(predecessor.facts.length).toBeGreaterThan(1)
    expect(predecessor.committedPrefix).toBe(0)
    expect(predecessor.inFlight).toEqual([permit])
    expect(predecessor.facts).toContain(remaining)

    const beforeMerge = snapshot(issued.state)
    const merged = SessionClosureModel.step(issued.state, {
      type: "operation.claim",
      instance,
      operation: first.offer.operation,
      repair: first.offer.repair,
      revision: operation(issued.state, first.offer.operation).revision,
      proofs: [
        {
          value: "proven_connected",
          root: a,
          active: b,
          path: [a, b],
          edges: [{ id: key("edge", "i28-pair-merge:edge"), owner: a, child: b }],
        },
      ],
      signals: [key("effect", "i28-pair-merge:signal:a")],
    })
    const mergedView = SessionClosureModel.view(merged.state)
    expect(mergedView.authorityRevision).toBe(beforeMerge.authorityRevision + 1n)
    expect(mergedView.aliases).toContainEqual({ alias: second.offer.operation, canonical: first.offer.operation })
    expect(pair(merged.state, permit).state).toBe("in_flight")

    const imported = SessionClosureModel.step(merged.state, {
      type: "pair.return",
      instance,
      write,
      message: "verified",
      part: "verified",
    })
    const importedGeneration = generation(imported.state, first.offer.operation, next.freezeOwner, next.generation)
    expect(imported.decision).toEqual({ type: "applied" })
    expect(imported.commands).toEqual([])
    expect(pair(imported.state, permit).state).toBe("imported")
    expect(importedGeneration.committedPrefix).toBe(1)
    expect(importedGeneration.verified).toContain(next.fact)
    expect(importedGeneration.facts).toContain(remaining)
    expect(importedGeneration.inFlight).toEqual([])

    const beforeReplay = snapshot(imported.state)
    const replayed = SessionClosureModel.step(imported.state, {
      type: "pair.return",
      instance,
      write,
      message: "verified",
      part: "verified",
    })
    expect(replayed.decision.type).toBe("noop")
    expect(replayed.commands).toEqual([])
    expect(SessionClosureModel.view(replayed.state)).toEqual(beforeReplay)

    const followCandidate: Extract<SessionClosureModel.Command, { readonly type: "pair.candidate" }> = {
      ...next,
      fact: remaining,
      expectedPrefix: 1,
    }
    const followID = key("pair", "i28-pair-merge:follow")
    const beforeFollow = snapshot(imported.state)
    const follow = SessionClosureModel.step(imported.state, {
      type: "pair.issue",
      instance,
      candidate: followCandidate,
      permit: followID,
    })
    expect(["rejected", "noop"]).toContain(follow.decision.type)
    expect(follow.commands).toEqual([])
    expect(SessionClosureModel.view(follow.state).pairs.some((item) => item.id === followID)).toBe(false)
    expect(SessionClosureModel.view(follow.state)).toEqual(beforeFollow)
  })

  test("I-31 cannot remint a suppressed continuation lease after epoch advance", () => {
    // Mutant: admit a fresh continuation LeaseID carrying the old originEpoch; the stale_epoch/absence assertions turn red.
    const instance = key("instance", "i31:instance")
    const caller = key("session", "i31:caller")
    const root = key("session", "i31:root")
    const token = key("lease", "i31:continuation")
    const initial = SessionClosureModel.make({ instance, sessions: [caller, root] })
    const reserved = SessionClosureModel.step(initial, {
      type: "lease.reserve",
      instance,
      lease: {
        id: token,
        session: root,
        epoch: 0n,
        source: "notifier",
        origin: "internal",
        retry: "initial",
        kind: "continuation",
        owner: { type: "scope", id: key("scope", "i31:scope") },
        caller,
        target: root,
        originEpoch: 0n,
      },
    })
    const begun = begin({ state: reserved.state, instance, root, prefix: "i31" })
    expect(lease(begun.state, token).operation).toBe(begun.operation)

    const suppressed = SessionClosureModel.step(begun.state, {
      type: "lease.finish",
      instance,
      lease: token,
      state: "suppressed",
    })
    expect(lease(suppressed.state, token).state).toBe("suppressed")

    const recorded = record({
      state: suppressed.state,
      instance,
      root,
      operation: begun.operation,
      repair: begun.repair,
      prefix: "i31",
    })
    const released = SessionClosureModel.step(recorded.state, {
      type: "release.commit",
      instance,
      check: recorded.check,
    })
    const before = snapshot(released.state)
    expect(released.decision).toEqual({ type: "applied" })
    expect(before.epochs).toContainEqual({ session: root, epoch: 1n })
    expect(before.fences.some((item) => item.session === root)).toBe(false)
    const lateID = key("lease", "i31:reminted")
    const late = SessionClosureModel.step(released.state, {
      type: "lease.reserve",
      instance,
      lease: {
        id: lateID,
        session: root,
        epoch: 1n,
        source: "late-notifier",
        origin: "internal",
        retry: "initial",
        kind: "continuation",
        owner: { type: "scope", id: key("scope", "i31:late-scope") },
        caller,
        target: root,
        originEpoch: 0n,
      },
    })

    expect(late.decision).toEqual({ type: "rejected", reason: "stale_epoch" })
    expect(SessionClosureModel.view(late.state)).toEqual(before)
    expect(SessionClosureModel.view(late.state).leases.filter((item) => item.id === token)).toHaveLength(1)
    expect(SessionClosureModel.view(late.state).leases.some((item) => item.id === lateID)).toBe(false)
  })

  test("I-32 keeps unresolved live pre-bind ownership fenced", () => {
    // Mutant: omit an unresolved pre-bind lease from quiescence blockers; the pending/fence assertions turn red.
    const instance = key("instance", "i32:instance")
    const root = key("session", "i32:root")
    const token = key("lease", "i32:pre-bind")
    const owner = key("scope", "i32:scope")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const reserved = SessionClosureModel.step(initial, {
      type: "lease.reserve",
      instance,
      lease: {
        id: token,
        session: root,
        epoch: 0n,
        source: "prompt-setup",
        origin: "internal",
        retry: "initial",
        kind: "pre_bind",
        owner: { type: "scope", id: owner },
      },
    })
    expect(lease(reserved.state, token).owner).toEqual({ type: "scope", id: owner })

    const begun = begin({ state: reserved.state, instance, root, prefix: "i32" })
    expect(lease(begun.state, token).operation).toBe(begun.operation)
    const capture = SessionClosureModel.scan(begun.state, begun.operation)
    const pending = SessionClosureModel.step(begun.state, {
      type: "quiescence.prove",
      instance,
      operation: begun.operation,
      prior: capture,
      current: capture,
    })

    expect(pending.decision).toEqual({ type: "rejected", reason: "unverified" })
    expect(operation(pending.state, begun.operation).phase.type).toBe("quiescing")
    expect(SessionClosureModel.view(pending.state).fences.some((item) => item.session === root)).toBe(true)
  })

  test("I-32 lets a later closure adopt retained pre-fence failure and blocks quiescence", () => {
    const instance = key("instance", "i32-late-failed:instance")
    const root = key("session", "i32-late-failed:root")
    const token = key("lease", "i32-late-failed:pre-bind")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const reserved = SessionClosureModel.step(initial, {
      type: "lease.reserve",
      instance,
      lease: {
        id: token,
        session: root,
        epoch: 0n,
        source: "prompt-setup",
        origin: "internal",
        retry: "initial",
        kind: "pre_bind",
        owner: { type: "scope", id: key("scope", "i32-late-failed:scope") },
      },
    })
    const failed = SessionClosureModel.step(reserved.state, {
      type: "lease.finish",
      instance,
      lease: token,
      state: "failed",
    })
    expect(lease(failed.state, token).state).toBe("failed")
    expect(lease(failed.state, token).operation).toBeUndefined()

    const cleanup = SessionClosureModel.step(failed.state, { type: "cleanup", instance, lease: token })
    expect(cleanup.decision).toEqual({ type: "noop", reason: "settled" })
    const begun = begin({ state: cleanup.state, instance, root, prefix: "i32-late-failed" })
    expect(lease(begun.state, token)).toMatchObject({ state: "failed", operation: begun.operation })

    const capture = SessionClosureModel.scan(begun.state, begun.operation)
    const pending = SessionClosureModel.step(begun.state, {
      type: "quiescence.prove",
      instance,
      operation: begun.operation,
      prior: capture,
      current: capture,
    })
    expect(pending.decision).toEqual({ type: "rejected", reason: "unverified" })
    expect(operation(pending.state, begun.operation).phase.type).toBe("quiescing")
  })

  test("I-32 retains explicit pre-bind owner failure instead of retiring it", () => {
    // Mutant: map lease.finish(failed) to retired success; the failure phase and terminal-state assertions turn red.
    const instance = key("instance", "i32-failed:instance")
    const root = key("session", "i32-failed:root")
    const token = key("lease", "i32-failed:pre-bind")
    const owner = key("scope", "i32-failed:scope")
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const reserved = SessionClosureModel.step(initial, {
      type: "lease.reserve",
      instance,
      lease: {
        id: token,
        session: root,
        epoch: 0n,
        source: "prompt-setup",
        origin: "internal",
        retry: "initial",
        kind: "pre_bind",
        owner: { type: "scope", id: owner },
      },
    })
    expect(lease(reserved.state, token).owner).toEqual({ type: "scope", id: owner })
    const begun = begin({ state: reserved.state, instance, root, prefix: "i32-failed" })
    expect(lease(begun.state, token).operation).toBe(begun.operation)

    const failed = SessionClosureModel.step(begun.state, {
      type: "lease.finish",
      instance,
      lease: token,
      state: "failed",
    })
    expect(lease(failed.state, token).state).toBe("failed")
    expect(operation(failed.state, begun.operation).phase.type).toBe("quiescence_failed")
    expect(SessionClosureModel.view(failed.state).fences.some((item) => item.session === root)).toBe(true)

    const cleanup = SessionClosureModel.step(failed.state, { type: "cleanup", instance, lease: token })
    expect(cleanup.decision).toEqual({ type: "noop", reason: "settled" })
    expect(lease(cleanup.state, token).state).toBe("failed")
    expect(operation(cleanup.state, begun.operation).phase.type).toBe("quiescence_failed")

    const before = snapshot(cleanup.state)
    const retired = SessionClosureModel.step(cleanup.state, {
      type: "lease.finish",
      instance,
      lease: token,
      state: "retired",
    })
    expect(retired.decision).toEqual({ type: "noop", reason: "settled" })
    expect(SessionClosureModel.view(retired.state)).toEqual(before)
  })

  test("I-37 gives unanchored-unknown and disjoint proofs no authority", () => {
    // Mutant: treat unanchored_unknown as connected evidence; the byte-equal unknown branch assertion turns red.
    const instance = key("instance", "i37-unknown:instance")
    const root = key("session", "i37-unknown:root")
    const other = key("session", "i37-unknown:other")
    const initial = SessionClosureModel.make({ instance, sessions: [root, other] })
    const started = start({
      state: initial,
      instance,
      root,
      operation: key("operation", "i37-unknown:operation"),
      view: key("view", "i37-unknown:view"),
      waiter: key("waiter", "i37-unknown:waiter"),
      ticket: key("ticket", "i37-unknown:ticket"),
      worker: key("worker", "i37-unknown:worker"),
      repair: key("repair", "i37-unknown:repair"),
    })
    const before = snapshot(started.state)
    expect(operation(started.state, started.offer.operation).claims).toEqual([])
    const unknown = SessionClosureModel.step(started.state, {
      type: "operation.claim",
      instance,
      operation: started.offer.operation,
      repair: started.offer.repair,
      revision: operation(started.state, started.offer.operation).revision,
      proofs: [{ value: "unanchored_unknown", root }],
      signals: [key("effect", "i37-unknown:signal")],
    })
    expect(unknown.commands).toEqual([])
    expect(SessionClosureModel.view(unknown.state)).toEqual(before)

    const disjoint = SessionClosureModel.step(started.state, {
      type: "operation.claim",
      instance,
      operation: started.offer.operation,
      repair: started.offer.repair,
      revision: operation(started.state, started.offer.operation).revision,
      proofs: [{ value: "proven_disjoint", root, active: other }],
      signals: [key("effect", "i37-unknown:disjoint-signal")],
    })
    expect(disjoint.commands).toEqual([])
    expect(SessionClosureModel.view(disjoint.state)).toEqual(before)
  })

  test("I-37 localizes root-anchored incomplete evidence to the affected view", () => {
    // Mutant: propagate one root_anchored_incomplete failure to every root view; the unaffected-view assertion turns red.
    const data = merged("i37-incomplete")
    const current = operation(data.state, data.operation)
    const beforeA = rootview(data.state, data.operation, key("view", "i37-incomplete:view:a"))
    const beforeB = rootview(data.state, data.operation, key("view", "i37-incomplete:view:b"))
    expect(beforeA.result).toBe("pending")
    expect(beforeB.result).toBe("pending")
    const result = SessionClosureModel.step(data.state, {
      type: "operation.claim",
      instance: data.instance,
      operation: data.operation,
      repair: data.repair,
      revision: current.revision,
      proofs: [{ value: "root_anchored_incomplete", root: data.a, path: [data.a], edges: [] }],
      signals: [],
    })
    const affected = rootview(result.state, data.operation, key("view", "i37-incomplete:view:a"))
    const unrelated = rootview(result.state, data.operation, key("view", "i37-incomplete:view:b"))

    expect(affected.result).toBe("failure")
    expect(affected.failureRevision).toBeDefined()
    expect(unrelated.result).toBe("pending")
    expect(unrelated.failureRevision).toBeUndefined()
  })
})

// CP-023 Gate 3 adds two pure accessors to the certified model. `view` deep-copies the entire
// model, which is far too costly for a guard that runs on every prompt turn and Task start, so the
// admission seams read through these instead. They add no transition and no branch to `step`.
//
// These cover the mutants the coordinator-level admission tests cannot reach: the fresh-record
// property (nothing there mutates a returned fence), and `sessionEpoch`'s absent-session default.
// Predicate negation and field fidelity are covered here *and* end-to-end in closure-admission.
describe("SessionClosureModel admission accessors", () => {
  function fencedState(prefix: string) {
    const instance = key("instance", `${prefix}:instance`)
    const root = key("session", `${prefix}:root`)
    const initial = SessionClosureModel.make({ instance, sessions: [root] })
    const data = begin({ state: initial, instance, root, prefix })
    return { instance, root, initial, state: data.claimed.state }
  }

  test("reads an unfenced session as absent, at the default epoch", () => {
    const setup = fencedState("accessor-absent")
    // Positive precondition: this construction really does produce a fence, so "absent" below is a
    // property of the queried state and not of a setup that never fenced anything.
    expect(SessionClosureModel.fence(setup.state, setup.root)).toBeDefined()

    expect(SessionClosureModel.fence(setup.initial, setup.root)).toBeUndefined()
    expect(SessionClosureModel.sessionEpoch(setup.initial, setup.root)).toBe(0n)

    // `make` seeds an epochs entry for every session it is given, so the assertion above returns
    // through `?.epoch` and never reaches the `?? 0n` fallback. Only a session the model has never
    // seen exercises that default. Mutation verification caught exactly this gap: `?? 0n -> ?? 1n`
    // survived the whole suite until this line existed.
    expect(SessionClosureModel.sessionEpoch(setup.initial, key("session", `${"accessor-absent"}:unseen`))).toBe(0n)
    expect(SessionClosureModel.sessionEpoch(setup.state, key("session", `${"accessor-absent"}:unseen`))).toBe(0n)
  })

  test("returns exactly the projected fence record", () => {
    const setup = fencedState("accessor-exact")
    const projected = SessionClosureModel.view(setup.state).fences
    expect(projected).toHaveLength(1)
    expect(SessionClosureModel.fence(setup.state, setup.root)).toEqual(projected[0])
  })

  test("discriminates by session rather than returning whichever fence exists", () => {
    const setup = fencedState("accessor-discriminate")
    expect(SessionClosureModel.fence(setup.state, setup.root)).toBeDefined()
    expect(SessionClosureModel.fence(setup.state, key("session", "accessor-discriminate:other"))).toBeUndefined()
  })

  test("returns a fresh record so internal state cannot be mutated through it", () => {
    const setup = fencedState("accessor-copy")
    const first = SessionClosureModel.fence(setup.state, setup.root)
    expect(first).toBeDefined()
    const before = first!.state
    ;(first as { state: SessionClosureModel.FenceState }).state = "record_failed"
    const second = SessionClosureModel.fence(setup.state, setup.root)
    expect(second!.state).toBe(before)
    expect(second!.state).not.toBe("record_failed")
  })

  test("sessionEpoch agrees with the epoch the fence was taken at", () => {
    const setup = fencedState("accessor-epoch")
    const found = SessionClosureModel.fence(setup.state, setup.root)
    expect(found).toBeDefined()
    expect(found!.epoch).toBe(SessionClosureModel.sessionEpoch(setup.state, setup.root))
  })
})
