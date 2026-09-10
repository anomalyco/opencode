import { describe, expect, test } from "bun:test"
import { SessionClosureModel } from "@/session/closure/model"

type Fixture = ReturnType<typeof fixture>
type Operation = SessionClosureModel.OperationView
type WorkerExit = Extract<SessionClosureModel.Event, { readonly type: "worker.exited" }>

function fixture(name: string) {
  return {
    instance: SessionClosureModel.id("instance", `${name}-instance`),
    root: SessionClosureModel.id("session", `${name}-root`),
    other: SessionClosureModel.id("session", `${name}-other`),
    third: SessionClosureModel.id("session", `${name}-third`),
    operationA: SessionClosureModel.id("operation", `${name}-operation-a`),
    operationB: SessionClosureModel.id("operation", `${name}-operation-b`),
    operationC: SessionClosureModel.id("operation", `${name}-operation-c`),
    viewA: SessionClosureModel.id("view", `${name}-view-a`),
    viewB: SessionClosureModel.id("view", `${name}-view-b`),
    viewC: SessionClosureModel.id("view", `${name}-view-c`),
    waiterA: SessionClosureModel.id("waiter", `${name}-waiter-a`),
    waiterB: SessionClosureModel.id("waiter", `${name}-waiter-b`),
    waiterC: SessionClosureModel.id("waiter", `${name}-waiter-c`),
    ticketA: SessionClosureModel.id("ticket", `${name}-ticket-a`),
    ticketB: SessionClosureModel.id("ticket", `${name}-ticket-b`),
    ticketC: SessionClosureModel.id("ticket", `${name}-ticket-c`),
    workerA: SessionClosureModel.id("worker", `${name}-worker-a`),
    workerB: SessionClosureModel.id("worker", `${name}-worker-b`),
    workerC: SessionClosureModel.id("worker", `${name}-worker-c`),
    repairA: SessionClosureModel.id("repair", `${name}-repair-a`),
    repairB: SessionClosureModel.id("repair", `${name}-repair-b`),
    repairC: SessionClosureModel.id("repair", `${name}-repair-c`),
    signalA: SessionClosureModel.id("effect", `${name}-signal-a`),
    permitA: SessionClosureModel.id("effect", `${name}-permit-a`),
    permitB: SessionClosureModel.id("effect", `${name}-permit-b`),
    pairA: SessionClosureModel.id("pair", `${name}-pair-a`),
  }
}

function ticketOffer(input: SessionClosureModel.Step) {
  const result = input.commands.filter((command) => command.type === "ticket.offer")
  const command = result[0]
  if (result.length !== 1 || command?.type !== "ticket.offer") throw new Error("expected exactly one ticket.offer")
  return command
}

function workerRegistration(input: SessionClosureModel.Step) {
  const result = input.commands.filter((command) => command.type === "worker.register")
  const command = result[0]
  if (result.length !== 1 || command?.type !== "worker.register")
    throw new Error("expected exactly one worker.register")
  return command
}

function workerOpening(input: SessionClosureModel.Step) {
  const result = input.commands.filter((command) => command.type === "worker.open")
  const command = result[0]
  if (result.length !== 1 || command?.type !== "worker.open") throw new Error("expected exactly one worker.open")
  return command
}

function driverCommand(input: SessionClosureModel.Step) {
  const result = input.commands.filter((command) => command.type === "driver.run")
  const command = result[0]
  if (result.length !== 1 || command?.type !== "driver.run") throw new Error("expected exactly one driver.run")
  return command
}

function effectCommand(input: SessionClosureModel.Step) {
  const result = input.commands.filter((command) => command.type === "effect.run")
  const command = result[0]
  if (result.length !== 1 || command?.type !== "effect.run") throw new Error("expected exactly one effect.run")
  return command
}

function planCommand(input: SessionClosureModel.Step) {
  const result = input.commands.filter((command) => command.type === "plan.read")
  const command = result[0]
  if (result.length !== 1 || command?.type !== "plan.read") throw new Error("expected exactly one plan.read")
  return command
}

function pairCandidate(input: SessionClosureModel.Step) {
  const result = input.commands.filter((command) => command.type === "pair.candidate")
  const command = result[0]
  if (result.length !== 1 || command?.type !== "pair.candidate") throw new Error("expected exactly one pair.candidate")
  return command
}

function pairWrite(input: SessionClosureModel.Step) {
  const result = input.commands.filter((command) => command.type === "pair.write")
  const command = result[0]
  if (result.length !== 1 || command?.type !== "pair.write") throw new Error("expected exactly one pair.write")
  return command
}

function releaseCheck(input: SessionClosureModel.Step) {
  const result = input.commands.filter((command) => command.type === "release.verify")
  const command = result[0]
  if (result.length !== 1 || command?.type !== "release.verify") throw new Error("expected exactly one release.verify")
  return command
}

function waiterDelivery(input: SessionClosureModel.Step) {
  const result = input.commands.filter((command) => command.type === "waiter.deliver")
  const command = result[0]
  if (result.length !== 1 || command?.type !== "waiter.deliver") throw new Error("expected exactly one waiter.deliver")
  return command
}

function waiterDeliveries(input: SessionClosureModel.Step) {
  return input.commands.filter(
    (command): command is Extract<SessionClosureModel.Command, { readonly type: "waiter.deliver" }> =>
      command.type === "waiter.deliver",
  )
}

function failureDelivery(
  input: SessionClosureModel.Step,
  operationID: SessionClosureModel.OperationID,
  waiters: readonly SessionClosureModel.WaiterID[],
) {
  const delivery = waiterDelivery(input)
  const current = operation(input.state, operationID)
  if (!current.failure) throw new Error(`missing failure for ${operationID}`)
  expect(delivery.instance).toBe(SessionClosureModel.view(input.state).instance)
  expect(delivery.operation).toBe(operationID)
  expect(delivery.revision).toBe(current.failure.revision)
  expect(delivery.failure).toBe(current.failure.kind)
  expect(delivery.waiters).toEqual(waiters)
  return delivery
}

function operation(state: SessionClosureModel.State, id: SessionClosureModel.OperationID) {
  const result = SessionClosureModel.view(state).operations.find((item) => item.id === id)
  if (!result) throw new Error(`missing operation ${id}`)
  return result
}

function ticket(state: SessionClosureModel.State, id: SessionClosureModel.TicketID) {
  const result = SessionClosureModel.view(state).tickets.find((item) => item.id === id)
  if (!result) throw new Error(`missing ticket ${id}`)
  return result
}

function waiter(
  state: SessionClosureModel.State,
  operationID: SessionClosureModel.OperationID,
  id: SessionClosureModel.WaiterID,
) {
  const result = operation(state, operationID).waiters.find((item) => item.id === id)
  if (!result) throw new Error(`missing waiter ${id}`)
  return result
}

function rootView(state: SessionClosureModel.State, operationID: SessionClosureModel.OperationID) {
  const result = operation(state, operationID).views[0]
  if (!result) throw new Error(`missing view for ${operationID}`)
  return result
}

function repair(input: Operation) {
  if (input.driver.state !== "none") return input.driver.repair
  if (input.repair) return input.repair
  throw new Error(`missing repair for ${input.id}`)
}

function request(
  state: SessionClosureModel.State,
  ids: Fixture,
  input: {
    readonly root: SessionClosureModel.SessionID
    readonly operation: SessionClosureModel.OperationID
    readonly view: SessionClosureModel.ViewID
    readonly waiter: SessionClosureModel.WaiterID
    readonly ticket: SessionClosureModel.TicketID
    readonly repair: SessionClosureModel.RepairID
  },
) {
  return SessionClosureModel.step(state, {
    type: "request",
    instance: ids.instance,
    root: input.root,
    operation: input.operation,
    view: input.view,
    waiter: input.waiter,
    ticket: input.ticket,
    repair: input.repair,
  })
}

function reserved(name: string) {
  const ids = fixture(name)
  const initial = SessionClosureModel.make({ instance: ids.instance, sessions: [ids.root, ids.other, ids.third] })
  const requested = request(initial, ids, {
    root: ids.root,
    operation: ids.operationA,
    view: ids.viewA,
    waiter: ids.waiterA,
    ticket: ids.ticketA,
    repair: ids.repairA,
  })
  const offer = ticketOffer(requested)
  return { ids, initial, requested, offer }
}

function accepted(name: string) {
  const setup = reserved(name)
  const received = SessionClosureModel.step(setup.requested.state, {
    type: "ticket.received",
    instance: setup.ids.instance,
    offer: setup.offer,
  })
  const transition = SessionClosureModel.step(received.state, {
    type: "ticket.accept",
    instance: setup.ids.instance,
    offer: setup.offer,
  })
  return {
    ids: setup.ids,
    initial: setup.initial,
    requested: setup.requested,
    offer: setup.offer,
    received,
    accepted: transition,
  }
}

function start(
  state: SessionClosureModel.State,
  ids: Fixture,
  offer: Extract<SessionClosureModel.Command, { readonly type: "ticket.offer" }>,
  worker: SessionClosureModel.WorkerID,
) {
  const dequeued = SessionClosureModel.step(state, {
    type: "ticket.dequeued",
    instance: ids.instance,
    offer,
  })
  const registration = workerRegistration(dequeued)
  const registered = SessionClosureModel.step(dequeued.state, {
    type: "worker.registered",
    instance: ids.instance,
    registration,
    worker,
  })
  const opening = workerOpening(registered)
  const started = SessionClosureModel.step(registered.state, {
    type: "worker.started",
    instance: ids.instance,
    opening,
  })
  return { dequeued, registration, registered, opening, started }
}

function running(name: string) {
  const setup = accepted(name)
  const driver = start(setup.accepted.state, setup.ids, setup.offer, setup.ids.workerA)
  return {
    ids: setup.ids,
    initial: setup.initial,
    requested: setup.requested,
    offer: setup.offer,
    received: setup.received,
    accepted: setup.accepted,
    dequeued: driver.dequeued,
    registration: driver.registration,
    registered: driver.registered,
    opening: driver.opening,
    started: driver.started,
  }
}

function joined(
  state: SessionClosureModel.State,
  ids: Fixture,
  input: {
    readonly waiter: SessionClosureModel.WaiterID
    readonly operation: SessionClosureModel.OperationID
    readonly view: SessionClosureModel.ViewID
    readonly ticket: SessionClosureModel.TicketID
    readonly repair: SessionClosureModel.RepairID
  },
) {
  return request(state, ids, {
    root: ids.root,
    operation: input.operation,
    view: input.view,
    waiter: input.waiter,
    ticket: input.ticket,
    repair: input.repair,
  })
}

function claimed(
  state: SessionClosureModel.State,
  ids: Fixture,
  operationID: SessionClosureModel.OperationID,
  signal: SessionClosureModel.EffectID,
) {
  const current = operation(state, operationID)
  const transition = SessionClosureModel.step(state, {
    type: "operation.claim",
    instance: ids.instance,
    operation: operationID,
    repair: repair(current),
    revision: current.revision,
    proofs: [{ value: "proven_connected", root: ids.root, active: ids.root, path: [ids.root], edges: [] }],
    signals: [signal],
  })
  const command = effectCommand(transition)
  const dispatched = SessionClosureModel.step(transition.state, {
    type: "effect.dispatch",
    instance: ids.instance,
    command,
  })
  const returned = SessionClosureModel.step(dispatched.state, {
    type: "effect.return",
    instance: ids.instance,
    command,
    result: "success",
  })
  return { claimed: transition, command, dispatched, returned }
}

function quiescing(state: SessionClosureModel.State, ids: Fixture, operationID: SessionClosureModel.OperationID) {
  const view = rootView(state, operationID)
  const required = SessionClosureModel.step(state, {
    type: "view.require",
    instance: ids.instance,
    operation: operationID,
    view: view.id,
    nodes: [ids.root],
    facts: [{ type: "root", root: ids.root }],
  })
  const fenced = SessionClosureModel.step(required.state, {
    type: "operation.advance",
    instance: ids.instance,
    operation: operationID,
    to: { type: "fencing" },
  })
  const transition = SessionClosureModel.step(fenced.state, {
    type: "operation.advance",
    instance: ids.instance,
    operation: operationID,
    to: { type: "quiescing" },
  })
  return { required, fenced, quiescing: transition }
}

function recording(
  state: SessionClosureModel.State,
  ids: Fixture,
  operationID: SessionClosureModel.OperationID,
  name: string,
) {
  const stages = quiescing(state, ids, operationID)
  const capture = SessionClosureModel.scan(stages.quiescing.state, operationID)
  const proved = SessionClosureModel.step(stages.quiescing.state, {
    type: "quiescence.prove",
    instance: ids.instance,
    operation: operationID,
    prior: capture,
    current: capture,
  })
  const begun = SessionClosureModel.step(proved.state, {
    type: "planning.begin",
    instance: ids.instance,
    operation: operationID,
  })
  const read = planCommand(begun)
  const facts = operation(begun.state, operationID).facts
  if (facts.length !== 1) throw new Error("recording fixture requires exactly one root fact")
  const identities = read.targets.map((session) => ({
    session,
    identity: {
      source: "session_identity" as const,
      agent: "closure-driver-test",
      model: {
        providerID: "test-provider",
        modelID: "test-model",
        variant: { present: false as const },
      },
    },
  }))
  const coordinates = facts.map((fact, index) => ({
    fact: fact.id,
    message: SessionClosureModel.id("message", `${name}-message-${index}`),
    part: SessionClosureModel.id("part", `${name}-part-${index}`),
    messageEvent: SessionClosureModel.id("event", `${name}-message-event-${index}`),
    partEvent: SessionClosureModel.id("event", `${name}-part-event-${index}`),
  }))
  const frozen = SessionClosureModel.step(begun.state, {
    type: "planning.return",
    instance: ids.instance,
    read,
    identities,
    seed: { clockMillis: 1000, highWaterMillis: 900, coordinates },
  })
  return {
    required: stages.required,
    fenced: stages.fenced,
    quiescing: stages.quiescing,
    capture,
    proved,
    begun,
    read,
    frozen,
  }
}

function released(
  state: SessionClosureModel.State,
  ids: Fixture,
  operationID: SessionClosureModel.OperationID,
  name: string,
) {
  const stages = recording(state, ids, operationID, name)
  const next = SessionClosureModel.step(stages.frozen.state, {
    type: "writer.next",
    instance: ids.instance,
    operation: operationID,
  })
  const candidate = pairCandidate(next)
  const issued = SessionClosureModel.step(next.state, {
    type: "pair.issue",
    instance: ids.instance,
    candidate,
    permit: ids.pairA,
  })
  const write = pairWrite(issued)
  const verified = SessionClosureModel.step(issued.state, {
    type: "pair.return",
    instance: ids.instance,
    write,
    message: "verified",
    part: "verified",
  })
  const prepared = SessionClosureModel.step(verified.state, {
    type: "release.prepare",
    instance: ids.instance,
    operation: operationID,
  })
  const check = releaseCheck(prepared)
  const committed = SessionClosureModel.step(prepared.state, {
    type: "release.commit",
    instance: ids.instance,
    check,
  })
  const delivery = waiterDelivery(committed)
  return {
    recording: stages,
    next,
    candidate,
    issued,
    write,
    verified,
    prepared,
    check,
    committed,
    delivery,
  }
}

function workerExit(
  state: SessionClosureModel.State,
  ids: Fixture,
  operationID: SessionClosureModel.OperationID,
): WorkerExit {
  const current = operation(state, operationID)
  if (current.driver.state !== "running") throw new Error(`operation ${operationID} has no running worker`)
  return {
    type: "worker.exited",
    instance: ids.instance,
    operation: operationID,
    ticket: current.driver.ticket,
    worker: current.driver.worker,
    repair: current.driver.repair,
    revision: current.driver.revision,
    disposal: false,
  }
}

function issuedEffect(
  state: SessionClosureModel.State,
  ids: Fixture,
  operationID: SessionClosureModel.OperationID,
  permit: SessionClosureModel.EffectID,
  effect: "signal" | "participant" | "plan_read" | "record_readback" | "release_verify",
) {
  const current = operation(state, operationID)
  return SessionClosureModel.step(state, {
    type: "effect.issue",
    instance: ids.instance,
    permit,
    operation: operationID,
    repair: repair(current),
    revision: current.revision,
    effect,
  })
}

function operationProjection(state: SessionClosureModel.State, operationID: SessionClosureModel.OperationID) {
  const current = SessionClosureModel.view(state)
  const tickets = current.tickets.filter((item) => item.operation === operationID)
  const ticketIDs = new Set(tickets.map((item) => item.id))
  return {
    supervisor: current.supervisor,
    queue: current.queue.filter((item) => ticketIDs.has(item)),
    operation: current.operations.find((item) => item.id === operationID),
    tickets,
    aliases: current.aliases.filter((item) => item.alias === operationID || item.canonical === operationID),
    claims: current.claims.filter((item) => item.operation === operationID),
    epochs: current.epochs,
    fences: current.fences.filter((item) => item.operation === operationID),
    effects: current.effects.filter((item) => item.operation === operationID),
    pairs: current.pairs.filter((item) => item.operation === operationID),
  }
}

describe("session closure driver model", () => {
  // I-41 | boundary: make before request | mutant: lazy supervisor creation | red: baseline supervisor/queue assertion.
  test("I-41 publishes the pre-existing supervisor before any closure request", () => {
    const ids = fixture("i41")
    const state = SessionClosureModel.make({ instance: ids.instance, sessions: [ids.root] })
    const current = SessionClosureModel.view(state)

    expect(current.supervisor).toEqual({ state: "running" })
    expect(current.queue).toEqual([])
    expect(current.tickets).toEqual([])
    expect(current.operations).toEqual([])
    expect(current.fences).toEqual([])
    expect(current.effects).toEqual([])
  })

  // I-42/K110(a) | boundary: reserved before receipt | mutant: reserve implies acceptance | red: cleared tuple/no-register.
  test("K110(a) interruption before queue receipt clears the unaccepted reservation", () => {
    const setup = reserved("k110-a")
    const before = SessionClosureModel.view(setup.requested.state)

    expect(before.supervisor.state).toBe("running")
    expect(ticket(setup.requested.state, setup.ids.ticketA)).toMatchObject({
      state: "reserved",
      offer: "pending",
      acceptance: "pending",
      dequeued: false,
    })
    expect(operation(setup.requested.state, setup.ids.operationA).driver).toMatchObject({
      state: "starting",
      ticket: setup.ids.ticketA,
      repair: setup.ids.repairA,
    })
    expect(waiter(setup.requested.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("provisional")

    const interrupted = SessionClosureModel.step(setup.requested.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterA,
    })
    const cleared = SessionClosureModel.view(interrupted.state)
    expect(ticket(interrupted.state, setup.ids.ticketA)).toMatchObject({
      state: "cleared",
      acceptance: "failed",
    })
    expect(cleared.operations).toEqual([])
    expect(cleared.queue).toEqual([])
    expect(cleared.fences).toEqual([])
    expect(cleared.effects).toEqual([])
    expect(cleared.supervisor.state).toBe("running")

    const stale = SessionClosureModel.step(interrupted.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    expect(stale.decision).toEqual({ type: "noop", reason: "stale" })
    expect(stale.commands.some((command) => command.type === "worker.register")).toBe(false)
  })

  // I-42/K110(b) | boundary: dequeued before accept | mutant: queue receipt accepts | red: provisional cleanup/stale copy.
  test("K110(b) queue receipt and dequeue do not accept the ticket", () => {
    const setup = reserved("k110-b")
    const received = SessionClosureModel.step(setup.requested.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: setup.offer,
    })

    expect(ticket(received.state, setup.ids.ticketA)).toMatchObject({
      state: "reserved",
      offer: "received",
      dequeued: false,
      acceptance: "pending",
    })
    expect(waiter(received.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("provisional")
    expect(operation(received.state, setup.ids.operationA).driver.state).toBe("starting")
    expect(SessionClosureModel.view(received.state).queue).toEqual([setup.ids.ticketA])
    expect(received.commands.some((command) => command.type === "worker.register")).toBe(false)

    const dequeued = SessionClosureModel.step(received.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })

    expect(ticket(dequeued.state, setup.ids.ticketA)).toMatchObject({
      state: "reserved",
      offer: "received",
      dequeued: true,
      acceptance: "pending",
    })
    expect(waiter(dequeued.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("provisional")
    expect(operation(dequeued.state, setup.ids.operationA).driver.state).toBe("starting")
    expect(dequeued.commands.some((command) => command.type === "worker.register")).toBe(false)

    const interrupted = SessionClosureModel.step(dequeued.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterA,
    })
    expect(ticket(interrupted.state, setup.ids.ticketA)).toMatchObject({
      state: "cleared",
      acceptance: "failed",
      dequeued: true,
    })
    expect(SessionClosureModel.view(interrupted.state).operations).toEqual([])
    expect(SessionClosureModel.view(interrupted.state).supervisor.state).toBe("running")
    expect(SessionClosureModel.view(interrupted.state).queue).toEqual([])
    expect(SessionClosureModel.view(interrupted.state).fences).toEqual([])
    expect(SessionClosureModel.view(interrupted.state).effects).toEqual([])

    const stale = SessionClosureModel.step(interrupted.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    expect(stale.decision).toEqual({ type: "noop", reason: "stale" })
    expect(stale.commands.some((command) => command.type === "worker.register")).toBe(false)
  })

  // I-26/I-42/K110(c) | boundary: locked accept | mutant: reuse pre-accept cleanup | red: accepted ticket/peer waiter.
  test("K110(c) interruption after locked acceptance detaches only its waiter", () => {
    const setup = accepted("k110-c")

    expect(ticket(setup.accepted.state, setup.ids.ticketA)).toMatchObject({
      state: "enqueued",
      acceptance: "accepted",
    })
    expect(operation(setup.accepted.state, setup.ids.operationA).driver).toMatchObject({
      state: "starting",
      ticket: setup.ids.ticketA,
    })
    expect(waiter(setup.accepted.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("attached")
    expect(SessionClosureModel.view(setup.accepted.state).supervisor.state).toBe("running")

    const second = joined(setup.accepted.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const before = operation(second.state, setup.ids.operationA)

    expect(ticket(second.state, setup.ids.ticketA)).toMatchObject({
      state: "enqueued",
      acceptance: "accepted",
    })
    expect(before.driver).toMatchObject({ state: "starting", ticket: setup.ids.ticketA })
    expect(waiter(second.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("attached")
    expect(waiter(second.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("attached")

    const interrupted = SessionClosureModel.step(second.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterA,
    })
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("detached")
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("attached")
    expect(ticket(interrupted.state, setup.ids.ticketA)).toEqual(ticket(second.state, setup.ids.ticketA))
    expect(operation(interrupted.state, setup.ids.operationA).driver).toEqual(before.driver)
    expect(rootView(interrupted.state, setup.ids.operationA)).toEqual(rootView(second.state, setup.ids.operationA))
    expect(SessionClosureModel.view(interrupted.state).supervisor).toEqual(
      SessionClosureModel.view(second.state).supervisor,
    )

    const dequeued = SessionClosureModel.step(interrupted.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    expect(workerRegistration(dequeued).ticket).toBe(setup.ids.ticketA)
  })

  // I-26/I-42/K110(d) | boundary: one unaccepted reservation held by two provisional waiters | mutant: clear the reservation on any provisional interruption | red: the surviving co-waiter keeps no ticket and no driver.
  test("K110(d) interruption cannot clear a reservation another provisional waiter still holds", () => {
    const setup = reserved("k110-d")
    const second = joined(setup.requested.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const before = operation(second.state, setup.ids.operationA)

    expect(second.decision).toEqual({
      type: "joined",
      operation: setup.ids.operationA,
      repair: setup.ids.repairA,
    })
    expect(second.commands).toEqual([])
    expect(waiter(second.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("provisional")
    expect(waiter(second.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("provisional")
    expect(SessionClosureModel.view(second.state).tickets.map((item) => item.id)).toEqual([setup.ids.ticketA])
    expect(ticket(second.state, setup.ids.ticketA)).toMatchObject({
      state: "reserved",
      offer: "pending",
      acceptance: "pending",
      start: "pending",
    })
    expect(before.driver).toMatchObject({
      state: "starting",
      ticket: setup.ids.ticketA,
      repair: setup.ids.repairA,
    })

    const interrupted = SessionClosureModel.step(second.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterA,
    })
    const after = operation(interrupted.state, setup.ids.operationA)

    expect(interrupted.decision).toEqual({ type: "applied" })
    expect(interrupted.commands).toEqual([])
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("detached")
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("provisional")
    expect(ticket(interrupted.state, setup.ids.ticketA)).toEqual(ticket(second.state, setup.ids.ticketA))
    expect(after.driver).toEqual(before.driver)
    expect(after.revision).toBe(before.revision)
    expect(after.phase).toEqual(before.phase)

    const received = SessionClosureModel.step(interrupted.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    const acceptedTicket = SessionClosureModel.step(received.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: setup.offer,
    })

    expect(acceptedTicket.decision).toEqual({ type: "applied" })
    expect(ticket(acceptedTicket.state, setup.ids.ticketA)).toMatchObject({
      state: "enqueued",
      acceptance: "accepted",
    })
    expect(waiter(acceptedTicket.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("attached")
    expect(waiter(acceptedTicket.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("detached")
    expect(operation(acceptedTicket.state, setup.ids.operationA).phase).toEqual({ type: "claiming" })

    const driver = start(acceptedTicket.state, setup.ids, setup.offer, setup.ids.workerA)
    expect(operation(driver.started.state, setup.ids.operationA).driver).toMatchObject({
      state: "running",
      worker: setup.ids.workerA,
      repair: setup.ids.repairA,
      gate: "opened",
    })
  })

  // I-26/I-42/K110(e) | boundary: the last provisional waiter leaving an unaccepted reservation | mutant: keep the reservation whenever a joiner ever attached | red: a cleared-ticket no-state operation survives with nobody waiting.
  test("K110(e) the last provisional waiter out clears the unaccepted reservation", () => {
    const setup = reserved("k110-e")
    const second = joined(setup.requested.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const before = operation(second.state, setup.ids.operationA)

    expect(waiter(second.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("provisional")
    expect(waiter(second.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("provisional")
    expect(before.driver).toMatchObject({ state: "starting", ticket: setup.ids.ticketA })

    const queued = SessionClosureModel.step(second.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: setup.offer,
    })

    expect(queued.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(queued.state).queue).toEqual([setup.ids.ticketA])
    expect(ticket(queued.state, setup.ids.ticketA)).toMatchObject({ offer: "received", acceptance: "pending" })

    const joinerGone = SessionClosureModel.step(queued.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterB,
    })

    expect(joinerGone.decision).toEqual({ type: "applied" })
    expect(joinerGone.commands).toEqual([])
    expect(waiter(joinerGone.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("detached")
    expect(waiter(joinerGone.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("provisional")
    expect(ticket(joinerGone.state, setup.ids.ticketA)).toEqual(ticket(queued.state, setup.ids.ticketA))
    expect(SessionClosureModel.view(joinerGone.state).queue).toEqual([setup.ids.ticketA])
    expect(operation(joinerGone.state, setup.ids.operationA).driver).toEqual(before.driver)

    const lastOut = SessionClosureModel.step(joinerGone.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterA,
    })
    const cleared = SessionClosureModel.view(lastOut.state)

    expect(lastOut.decision).toEqual({ type: "applied" })
    expect(lastOut.commands).toEqual([])
    expect(ticket(lastOut.state, setup.ids.ticketA)).toMatchObject({
      state: "cleared",
      acceptance: "failed",
      start: "failed",
    })
    expect(cleared.operations).toEqual([])
    expect(cleared.queue).toEqual([])
    expect(cleared.fences).toEqual([])
    expect(cleared.supervisor.state).toBe("running")

    const stale = SessionClosureModel.step(lastOut.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    expect(stale.decision).toEqual({ type: "noop", reason: "stale" })
    expect(stale.commands.some((command) => command.type === "worker.register")).toBe(false)
  })

  // I-26/I-42/K110(f) | boundary: an unaccepted repair reservation held by two provisional waiters | mutant: apply the initial-admission clear to a repair ticket | red: the surviving co-waiter loses the repair reservation.
  test("K110(f) a joiner interruption leaves the repair reservation and retained failure intact", () => {
    const setup = running("k110-f")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const failed = SessionClosureModel.step(
      closure.returned.state,
      workerExit(closure.returned.state, setup.ids, setup.ids.operationA),
    )
    const oldDelivery = failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA])
    const oldSettled = SessionClosureModel.step(failed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: oldDelivery,
      waiter: setup.ids.waiterA,
    })
    const repairRequest = joined(oldSettled.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const repairOffer = ticketOffer(repairRequest)
    const secondJoin = joined(repairRequest.state, setup.ids, {
      waiter: setup.ids.waiterC,
      operation: setup.ids.operationC,
      view: setup.ids.viewC,
      ticket: setup.ids.ticketC,
      repair: setup.ids.repairC,
    })
    const before = operation(secondJoin.state, setup.ids.operationA)
    const fencesBefore = SessionClosureModel.view(secondJoin.state).fences

    expect(secondJoin.decision).toEqual({
      type: "joined",
      operation: setup.ids.operationA,
      repair: setup.ids.repairB,
    })
    expect(secondJoin.commands).toEqual([])
    expect(before.failure).toMatchObject({ kind: "closure_unavailable", repair: setup.ids.repairA })
    expect(waiter(secondJoin.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("settled")
    expect(waiter(secondJoin.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("provisional")
    expect(waiter(secondJoin.state, setup.ids.operationA, setup.ids.waiterC).state).toBe("provisional")
    expect(ticket(secondJoin.state, setup.ids.ticketB)).toMatchObject({
      state: "reserved",
      offer: "pending",
      acceptance: "pending",
    })
    expect(before.driver).toMatchObject({
      state: "starting",
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    expect(fencesBefore).toHaveLength(1)

    const interrupted = SessionClosureModel.step(secondJoin.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterC,
    })
    const after = operation(interrupted.state, setup.ids.operationA)

    expect(interrupted.decision).toEqual({ type: "applied" })
    expect(interrupted.commands).toEqual([])
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterC).state).toBe("detached")
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("provisional")
    expect(ticket(interrupted.state, setup.ids.ticketB)).toEqual(ticket(secondJoin.state, setup.ids.ticketB))
    expect(after.driver).toEqual(before.driver)
    expect(after.failure).toEqual(before.failure)
    expect(after.revision).toBe(before.revision)
    expect(rootView(interrupted.state, setup.ids.operationA)).toEqual(
      rootView(secondJoin.state, setup.ids.operationA),
    )
    expect(SessionClosureModel.view(interrupted.state).fences).toEqual(fencesBefore)

    const received = SessionClosureModel.step(interrupted.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: repairOffer,
    })
    const acceptedRepair = SessionClosureModel.step(received.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: repairOffer,
    })

    expect(acceptedRepair.decision).toEqual({ type: "applied" })
    expect(ticket(acceptedRepair.state, setup.ids.ticketB)).toMatchObject({
      state: "enqueued",
      acceptance: "accepted",
    })
    expect(waiter(acceptedRepair.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("attached")
    expect(waiter(acceptedRepair.state, setup.ids.operationA, setup.ids.waiterC).state).toBe("detached")
  })

  // I-26/I-43/CP 6.4 | boundary: clearing a repair reservation on an operation that holds closure state | mutant: remove the operation unconditionally | red: the retained failure, view, fence, and claim vanish and the fence is orphaned.
  test("K110(g) clearing a repair reservation keeps the failed operation and its retained authority", () => {
    const setup = running("k110-g")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const failed = SessionClosureModel.step(
      closure.returned.state,
      workerExit(closure.returned.state, setup.ids, setup.ids.operationA),
    )
    const oldDelivery = failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA])
    const oldSettled = SessionClosureModel.step(failed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: oldDelivery,
      waiter: setup.ids.waiterA,
    })
    const retained = operation(oldSettled.state, setup.ids.operationA)
    const retainedDriver = retained.driver
    const retainedFailure = retained.failure
    const retainedView = rootView(oldSettled.state, setup.ids.operationA)
    const fencesBefore = SessionClosureModel.view(oldSettled.state).fences
    const claimsBefore = SessionClosureModel.view(oldSettled.state).claims

    const repairRequest = joined(oldSettled.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const reserved = operation(repairRequest.state, setup.ids.operationA)

    expect(retainedDriver).toMatchObject({ state: "failed", repair: setup.ids.repairA })
    expect(retainedFailure).toMatchObject({ kind: "closure_unavailable", repair: setup.ids.repairA })
    expect(retainedView.result).toBe("failure")
    expect(fencesBefore).toHaveLength(1)
    expect(claimsBefore).toHaveLength(1)
    expect(SessionClosureModel.view(repairRequest.state).effects.length).toBeGreaterThan(0)
    expect(reserved.driver).toMatchObject({
      state: "starting",
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    expect(waiter(repairRequest.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("provisional")
    expect(
      operation(repairRequest.state, setup.ids.operationA).waiters.filter(
        (item) => item.state === "provisional" || item.state === "attached" || item.state === "delivery_reserved",
      ),
    ).toHaveLength(1)

    const interrupted = SessionClosureModel.step(repairRequest.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterB,
    })
    const after = operation(interrupted.state, setup.ids.operationA)

    expect(interrupted.decision).toEqual({ type: "applied" })
    expect(interrupted.commands).toEqual([])
    expect(ticket(interrupted.state, setup.ids.ticketB)).toMatchObject({
      state: "cleared",
      acceptance: "failed",
      start: "failed",
    })
    expect(SessionClosureModel.view(interrupted.state).queue).toEqual([])
    expect(SessionClosureModel.view(interrupted.state).operations.some((item) => item.id === setup.ids.operationA)).toBe(
      true,
    )
    expect(after.driver).toEqual(retainedDriver)
    expect(after.failure).toEqual(retainedFailure)
    expect(rootView(interrupted.state, setup.ids.operationA)).toEqual(retainedView)
    expect(SessionClosureModel.view(interrupted.state).fences).toEqual(fencesBefore)
    expect(SessionClosureModel.view(interrupted.state).claims).toEqual(claimsBefore)
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("detached")
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("settled")

    const readmitted = joined(interrupted.state, setup.ids, {
      waiter: setup.ids.waiterC,
      operation: setup.ids.operationC,
      view: setup.ids.viewC,
      ticket: setup.ids.ticketC,
      repair: setup.ids.repairC,
    })

    expect(readmitted.decision).toEqual({
      type: "joined",
      operation: setup.ids.operationA,
      repair: setup.ids.repairC,
    })
    expect(SessionClosureModel.view(readmitted.state).operations.map((item) => item.id)).toEqual([
      setup.ids.operationA,
    ])
    expect(SessionClosureModel.view(readmitted.state).fences).toEqual(fencesBefore)
  })

  // I-26/CP 6.4 | boundary: clearing a repair reservation on a failed operation that never claimed | mutant: ignore accepted views in the state test | red: the only state the operation holds is its resolved view, so it is removed and its retained failure is destroyed.
  test("K110(h) clearing a repair reservation keeps a failed operation that holds only a resolved view", () => {
    const setup = running("k110-h")
    const failed = SessionClosureModel.step(
      setup.started.state,
      workerExit(setup.started.state, setup.ids, setup.ids.operationA),
    )
    const oldDelivery = failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA])
    const settled = SessionClosureModel.step(failed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: oldDelivery,
      waiter: setup.ids.waiterA,
    })
    const retained = operation(settled.state, setup.ids.operationA)
    const retainedDriver = retained.driver
    const retainedFailure = retained.failure
    const retainedView = rootView(settled.state, setup.ids.operationA)

    expect(SessionClosureModel.view(settled.state).fences).toEqual([])
    expect(SessionClosureModel.view(settled.state).effects).toEqual([])
    expect(SessionClosureModel.view(settled.state).claims).toEqual([])
    expect(retainedView.result).toBe("failure")
    expect(retainedView.facts).toEqual([])
    expect(retainedDriver).toMatchObject({ state: "failed", repair: setup.ids.repairA })

    const repairRequest = joined(settled.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })

    expect(waiter(repairRequest.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("provisional")
    expect(waiter(repairRequest.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("settled")
    expect(
      operation(repairRequest.state, setup.ids.operationA).waiters.filter(
        (item) => item.state === "provisional" || item.state === "attached" || item.state === "delivery_reserved",
      ),
    ).toHaveLength(1)

    const interrupted = SessionClosureModel.step(repairRequest.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterB,
    })
    const after = operation(interrupted.state, setup.ids.operationA)

    expect(interrupted.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(interrupted.state).operations.some((item) => item.id === setup.ids.operationA)).toBe(
      true,
    )
    expect(after.driver).toEqual(retainedDriver)
    expect(after.failure).toEqual(retainedFailure)
    expect(rootView(interrupted.state, setup.ids.operationA)).toEqual(retainedView)
    expect(ticket(interrupted.state, setup.ids.ticketB)).toMatchObject({
      state: "cleared",
      acceptance: "failed",
    })
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("detached")
  })

  // I-43/CP 6.4 | boundary: phase advance with no worker owning the attempt | mutant: drop the running-attempt guard | red: a failed or unaccepted-starting attempt advances the phase with nobody owning the work.
  test("I-43 phase advance requires a live accepted attempt", () => {
    const setup = running("i43-advance-authority")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const stages = recording(closure.returned.state, setup.ids, setup.ids.operationA, "i43-advance-authority")
    const next = SessionClosureModel.step(stages.frozen.state, {
      type: "writer.next",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
    })
    const candidate = pairCandidate(next)
    const pairIssued = SessionClosureModel.step(next.state, {
      type: "pair.issue",
      instance: setup.ids.instance,
      candidate,
      permit: setup.ids.pairA,
    })
    const write = pairWrite(pairIssued)
    const recordFailed = SessionClosureModel.step(pairIssued.state, {
      type: "pair.return",
      instance: setup.ids.instance,
      write,
      message: "verified",
      part: "absent",
    })
    const failedDelivery = failureDelivery(recordFailed, setup.ids.operationA, [setup.ids.waiterA])
    const settled = SessionClosureModel.step(recordFailed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: failedDelivery,
      waiter: setup.ids.waiterA,
    })
    const generation = operation(settled.state, setup.ids.operationA).generations[0]
    const target = { type: "recording" as const, generation: generation?.generation ?? 1 }

    expect(operation(settled.state, setup.ids.operationA).phase).toEqual({ type: "record_failed" })
    expect(operation(settled.state, setup.ids.operationA).driver.state).toBe("failed")

    const underFailed = SessionClosureModel.step(settled.state, {
      type: "operation.advance",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      to: target,
    })

    expect(underFailed.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(underFailed.commands).toEqual([])
    expect(SessionClosureModel.view(underFailed.state)).toEqual(SessionClosureModel.view(settled.state))

    const repairRequest = joined(settled.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const repairOffer = ticketOffer(repairRequest)

    expect(operation(repairRequest.state, setup.ids.operationA).driver).toMatchObject({
      state: "starting",
      ticket: setup.ids.ticketB,
    })
    expect(ticket(repairRequest.state, setup.ids.ticketB).acceptance).toBe("pending")

    const underReserved = SessionClosureModel.step(repairRequest.state, {
      type: "operation.advance",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      to: target,
    })

    expect(underReserved.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(underReserved.commands).toEqual([])
    expect(SessionClosureModel.view(underReserved.state)).toEqual(SessionClosureModel.view(repairRequest.state))

    const received = SessionClosureModel.step(repairRequest.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: repairOffer,
    })
    const acceptedRepair = SessionClosureModel.step(received.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: repairOffer,
    })
    const underAccepted = SessionClosureModel.step(acceptedRepair.state, {
      type: "operation.advance",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      to: target,
    })

    expect(ticket(acceptedRepair.state, setup.ids.ticketB).acceptance).toBe("accepted")
    expect(operation(acceptedRepair.state, setup.ids.operationA).driver.state).toBe("starting")
    expect(underAccepted.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(SessionClosureModel.view(underAccepted.state)).toEqual(SessionClosureModel.view(acceptedRepair.state))

    const repairDriver = start(acceptedRepair.state, setup.ids, repairOffer, setup.ids.workerB)
    const underPendingGate = SessionClosureModel.step(repairDriver.registered.state, {
      type: "operation.advance",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      to: target,
    })

    expect(operation(repairDriver.registered.state, setup.ids.operationA).driver).toMatchObject({
      state: "running",
      worker: setup.ids.workerB,
      gate: "pending",
    })
    expect(underPendingGate.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(underPendingGate.commands).toEqual([])
    expect(SessionClosureModel.view(underPendingGate.state)).toEqual(
      SessionClosureModel.view(repairDriver.registered.state),
    )

    const elected = SessionClosureModel.step(repairDriver.started.state, {
      type: "operation.advance",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      to: target,
    })

    expect(operation(repairDriver.started.state, setup.ids.operationA).driver).toMatchObject({
      state: "running",
      worker: setup.ids.workerB,
      gate: "opened",
    })
    expect(elected.decision).toEqual({ type: "applied" })
    expect(operation(elected.state, setup.ids.operationA).phase).toEqual(target)
    expect(operation(elected.state, setup.ids.operationA).failure).toBeUndefined()
  })

  // I-13/I-27 | boundary: a provisional waiter absorbed by merge, present at successful release | mutant: reserve only attached waiters at release | red: the absorbed waiter is never delivered and its request never settles.
  test("I-27 successful release settles a provisional waiter absorbed by merge", () => {
    const setup = running("merge-provisional")
    const closureA = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)

    const requestB = request(closureA.returned.state, setup.ids, {
      root: setup.ids.other,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      waiter: setup.ids.waiterB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const offerB = ticketOffer(requestB)
    const receivedB = SessionClosureModel.step(requestB.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: offerB,
    })
    const acceptedB = SessionClosureModel.step(receivedB.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: offerB,
    })
    const driverB = start(acceptedB.state, setup.ids, offerB, setup.ids.workerB)
    const operationBefore = operation(driverB.started.state, setup.ids.operationB)
    const claimB = SessionClosureModel.step(driverB.started.state, {
      type: "operation.claim",
      instance: setup.ids.instance,
      operation: setup.ids.operationB,
      repair: repair(operationBefore),
      revision: operationBefore.revision,
      proofs: [
        { value: "proven_connected", root: setup.ids.other, active: setup.ids.other, path: [setup.ids.other], edges: [] },
      ],
      signals: [setup.ids.permitB],
    })
    const signalB = effectCommand(claimB)
    const dispatchedB = SessionClosureModel.step(claimB.state, {
      type: "effect.dispatch",
      instance: setup.ids.instance,
      command: signalB,
    })
    const returnedB = SessionClosureModel.step(dispatchedB.state, {
      type: "effect.return",
      instance: setup.ids.instance,
      command: signalB,
      result: "success",
    })

    const failedB = SessionClosureModel.step(
      returnedB.state,
      workerExit(returnedB.state, setup.ids, setup.ids.operationB),
    )
    const deliveryB = failureDelivery(failedB, setup.ids.operationB, [setup.ids.waiterB])
    const settledB = SessionClosureModel.step(failedB.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: deliveryB,
      waiter: setup.ids.waiterB,
    })
    const repairB = request(settledB.state, setup.ids, {
      root: setup.ids.other,
      operation: setup.ids.operationC,
      view: setup.ids.viewC,
      waiter: setup.ids.waiterC,
      ticket: setup.ids.ticketC,
      repair: setup.ids.repairC,
    })

    expect(waiter(repairB.state, setup.ids.operationB, setup.ids.waiterC).state).toBe("provisional")

    const winnerBefore = operation(repairB.state, setup.ids.operationA)
    const mergeClaim = SessionClosureModel.step(repairB.state, {
      type: "operation.claim",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      repair: repair(winnerBefore),
      revision: winnerBefore.revision,
      proofs: [
        {
          value: "proven_connected",
          root: setup.ids.root,
          active: setup.ids.other,
          path: [setup.ids.root, setup.ids.other],
          edges: [
            {
              id: SessionClosureModel.id("edge", "merge-provisional-edge-a"),
              owner: setup.ids.root,
              child: setup.ids.other,
            },
          ],
        },
      ],
      signals: [setup.ids.permitA],
    })
    const mergeSignal = effectCommand(mergeClaim)
    const mergeDispatched = SessionClosureModel.step(mergeClaim.state, {
      type: "effect.dispatch",
      instance: setup.ids.instance,
      command: mergeSignal,
    })
    const merged = SessionClosureModel.step(mergeDispatched.state, {
      type: "effect.return",
      instance: setup.ids.instance,
      command: mergeSignal,
      result: "success",
    })
    const winner = operation(merged.state, setup.ids.operationA)

    expect(mergeClaim.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(merged.state).aliases).toContainEqual({
      alias: setup.ids.operationB,
      canonical: setup.ids.operationA,
    })
    expect(winner.driver).toMatchObject({ state: "running", worker: setup.ids.workerA, gate: "opened" })
    expect(waiter(merged.state, setup.ids.operationA, setup.ids.waiterC).state).toBe("provisional")
    expect(waiter(merged.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("attached")
    expect(ticket(merged.state, setup.ids.ticketC)).toMatchObject({ state: "failed", acceptance: "failed" })

    const stages = recording(merged.state, setup.ids, setup.ids.operationA, "merge-provisional")
    const next = SessionClosureModel.step(stages.frozen.state, {
      type: "writer.next",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
    })
    const candidate = pairCandidate(next)
    const pairIssued = SessionClosureModel.step(next.state, {
      type: "pair.issue",
      instance: setup.ids.instance,
      candidate,
      permit: setup.ids.pairA,
    })
    const write = pairWrite(pairIssued)
    const verified = SessionClosureModel.step(pairIssued.state, {
      type: "pair.return",
      instance: setup.ids.instance,
      write,
      message: "verified",
      part: "verified",
    })
    const prepared = SessionClosureModel.step(verified.state, {
      type: "release.prepare",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
    })
    const check = releaseCheck(prepared)

    expect(waiter(verified.state, setup.ids.operationA, setup.ids.waiterC).state).toBe("provisional")

    const committed = SessionClosureModel.step(prepared.state, {
      type: "release.commit",
      instance: setup.ids.instance,
      check,
    })
    const released = operation(committed.state, setup.ids.operationA)
    const delivery = waiterDelivery(committed)

    expect(committed.decision).toEqual({ type: "applied" })
    expect(released.phase).toEqual({ type: "released_pending_delivery" })
    expect(delivery.failure).toBeUndefined()
    expect(delivery.waiters).toContain(setup.ids.waiterC)
    expect(delivery.waiters).toContain(setup.ids.waiterA)
    expect(delivery.waiters).not.toContain(setup.ids.waiterB)
    expect(waiter(committed.state, setup.ids.operationA, setup.ids.waiterC)).toMatchObject({
      state: "delivery_reserved",
      deliveryRevision: released.revision,
    })

    const deliveredC = SessionClosureModel.step(committed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery,
      waiter: setup.ids.waiterC,
    })

    expect(deliveredC.decision).toEqual({ type: "applied" })
    expect(waiter(deliveredC.state, setup.ids.operationA, setup.ids.waiterC).state).toBe("settled")

    const duplicate = SessionClosureModel.step(deliveredC.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery,
      waiter: setup.ids.waiterC,
    })
    expect(duplicate.decision).toEqual({ type: "noop", reason: "settled" })
  })

  // I-43 | boundary: worker.registered before start | mutant: promotion emits driver.run | red: pending gate/zero run.
  test("I-43 promotion installs only running gate-pending authority", () => {
    const setup = accepted("i43-promotion")
    const dequeued = SessionClosureModel.step(setup.accepted.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    const registration = workerRegistration(dequeued)

    expect(operation(dequeued.state, setup.ids.operationA).driver.state).toBe("starting")
    expect(ticket(dequeued.state, setup.ids.ticketA)).toMatchObject({ state: "enqueued", start: "pending" })

    const promoted = SessionClosureModel.step(dequeued.state, {
      type: "worker.registered",
      instance: setup.ids.instance,
      registration,
      worker: setup.ids.workerA,
    })
    expect(operation(promoted.state, setup.ids.operationA).driver).toMatchObject({
      state: "running",
      worker: setup.ids.workerA,
      gate: "pending",
    })
    expect(ticket(promoted.state, setup.ids.ticketA)).toMatchObject({ state: "consumed", start: "pending" })
    expect(promoted.commands.filter((command) => command.type === "worker.open")).toHaveLength(1)
    expect(promoted.commands.some((command) => command.type === "driver.run")).toBe(false)
  })

  // I-43 | boundary: worker.started | mutant: start gate lacks CAS | red: duplicate emits a second driver.run.
  test("I-43 the exact start gate opens once and emits one driver command", () => {
    const setup = accepted("i43-start")
    const stages = start(setup.accepted.state, setup.ids, setup.offer, setup.ids.workerA)

    expect(operation(stages.registered.state, setup.ids.operationA).driver).toMatchObject({
      state: "running",
      gate: "pending",
    })
    expect(ticket(stages.registered.state, setup.ids.ticketA).start).toBe("pending")
    expect(stages.registered.commands.some((command) => command.type === "driver.run")).toBe(false)

    expect(operation(stages.started.state, setup.ids.operationA).driver).toMatchObject({
      state: "running",
      gate: "opened",
    })
    expect(ticket(stages.started.state, setup.ids.ticketA).start).toBe("opened")
    expect(driverCommand(stages.started).worker).toBe(setup.ids.workerA)
    expect(stages.started.commands.filter((command) => command.type === "driver.run")).toHaveLength(1)

    const duplicate = SessionClosureModel.step(stages.started.state, {
      type: "worker.started",
      instance: setup.ids.instance,
      opening: stages.opening,
    })
    expect(duplicate.decision).toEqual({ type: "noop", reason: "duplicate" })
    expect(duplicate.commands.some((command) => command.type === "driver.run")).toBe(false)
    expect(SessionClosureModel.view(duplicate.state)).toEqual(SessionClosureModel.view(stages.started.state))
  })

  // I-20/I-43/I-45 | boundary: invalid C2 cells | mutant: permissive undefined-cell fallback | red: rejection/view.
  test("C2 invalid phase and terminal cells reject without changing authority", () => {
    const setup = running("c2-invalid")
    const current = operation(setup.started.state, setup.ids.operationA)
    const before = SessionClosureModel.view(setup.started.state)

    expect(current.phase).toEqual({ type: "claiming" })
    expect(current.driver).toMatchObject({ state: "running", gate: "opened" })

    const failure = SessionClosureModel.step(setup.started.state, {
      type: "operation.fail",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      repair: repair(current),
      revision: current.revision,
      failure: "record_failed",
    })
    expect(failure.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(failure.commands).toEqual([])
    expect(SessionClosureModel.view(failure.state)).toEqual(before)

    const cleanup = SessionClosureModel.step(setup.started.state, {
      type: "cleanup",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      revision: current.revision,
    })
    expect(cleanup.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(cleanup.commands).toEqual([])
    expect(SessionClosureModel.view(cleanup.state)).toEqual(before)

    const disposed = SessionClosureModel.step(setup.started.state, {
      type: "dispose",
      instance: setup.ids.instance,
    })
    expect(SessionClosureModel.view(disposed.state).supervisor.state).toBe("disposed")
    const terminal = request(disposed.state, setup.ids, {
      root: setup.ids.other,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      waiter: setup.ids.waiterB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    expect(terminal.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(terminal.commands).toEqual([])
    expect(SessionClosureModel.view(terminal.state)).toEqual(SessionClosureModel.view(disposed.state))
  })

  // I-42 | boundary: invalid/terminal ticket callbacks | mutant: omit ticket-state guard | red: rejection/no-op/view.
  test("C2 ticket callbacks have explicit invalid stale and duplicate dispositions", () => {
    const setup = reserved("c2-ticket-cells")
    const before = SessionClosureModel.view(setup.requested.state)

    expect(ticket(setup.requested.state, setup.ids.ticketA)).toMatchObject({
      state: "reserved",
      offer: "pending",
      dequeued: false,
      acceptance: "pending",
    })

    const earlyAccept = SessionClosureModel.step(setup.requested.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    expect(earlyAccept.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(earlyAccept.commands).toEqual([])
    expect(SessionClosureModel.view(earlyAccept.state)).toEqual(before)

    const earlyDequeue = SessionClosureModel.step(setup.requested.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    expect(earlyDequeue.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(earlyDequeue.commands).toEqual([])
    expect(SessionClosureModel.view(earlyDequeue.state)).toEqual(before)

    const received = SessionClosureModel.step(setup.requested.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    const lateFailure = SessionClosureModel.step(received.state, {
      type: "ticket.offer_failed",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    expect(lateFailure.decision).toEqual({ type: "noop", reason: "stale" })
    expect(lateFailure.commands).toEqual([])
    expect(SessionClosureModel.view(lateFailure.state)).toEqual(SessionClosureModel.view(received.state))

    const acceptedTicket = SessionClosureModel.step(received.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    const duplicateReceipt = SessionClosureModel.step(acceptedTicket.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    expect(duplicateReceipt.decision).toEqual({ type: "noop", reason: "duplicate" })
    expect(duplicateReceipt.commands).toEqual([])
    expect(SessionClosureModel.view(duplicateReceipt.state)).toEqual(SessionClosureModel.view(acceptedTicket.state))

    const duplicateAccept = SessionClosureModel.step(acceptedTicket.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    expect(duplicateAccept.decision).toEqual({ type: "noop", reason: "duplicate" })
    expect(duplicateAccept.commands).toEqual([])
    expect(SessionClosureModel.view(duplicateAccept.state)).toEqual(SessionClosureModel.view(acceptedTicket.state))

    const dequeued = SessionClosureModel.step(acceptedTicket.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    workerRegistration(dequeued)
    const duplicateDequeue = SessionClosureModel.step(dequeued.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    expect(duplicateDequeue.decision).toEqual({ type: "noop", reason: "duplicate" })
    expect(duplicateDequeue.commands).toEqual([])
    expect(SessionClosureModel.view(duplicateDequeue.state)).toEqual(SessionClosureModel.view(dequeued.state))

    const failedSetup = reserved("c2-ticket-failed")
    const failed = SessionClosureModel.step(failedSetup.requested.state, {
      type: "ticket.offer_failed",
      instance: failedSetup.ids.instance,
      offer: failedSetup.offer,
    })
    const failedBefore = SessionClosureModel.view(failed.state)
    expect(ticket(failed.state, failedSetup.ids.ticketA).state).toBe("failed")
    const failedCallbacks: readonly SessionClosureModel.Event[] = [
      { type: "ticket.received", instance: failedSetup.ids.instance, offer: failedSetup.offer },
      { type: "ticket.dequeued", instance: failedSetup.ids.instance, offer: failedSetup.offer },
      { type: "ticket.accept", instance: failedSetup.ids.instance, offer: failedSetup.offer },
    ]
    failedCallbacks.forEach((callback) => {
      const result = SessionClosureModel.step(failed.state, callback)
      expect(result.decision).toEqual({ type: "noop", reason: "stale" })
      expect(result.commands).toEqual([])
      expect(SessionClosureModel.view(result.state)).toEqual(failedBefore)
    })

    const clearedSetup = reserved("c2-ticket-cleared")
    const cleared = SessionClosureModel.step(clearedSetup.requested.state, {
      type: "waiter.interrupt",
      instance: clearedSetup.ids.instance,
      waiter: clearedSetup.ids.waiterA,
    })
    const clearedBefore = SessionClosureModel.view(cleared.state)
    expect(ticket(cleared.state, clearedSetup.ids.ticketA).state).toBe("cleared")
    const clearedCallbacks: readonly SessionClosureModel.Event[] = [
      { type: "ticket.received", instance: clearedSetup.ids.instance, offer: clearedSetup.offer },
      { type: "ticket.dequeued", instance: clearedSetup.ids.instance, offer: clearedSetup.offer },
      { type: "ticket.accept", instance: clearedSetup.ids.instance, offer: clearedSetup.offer },
    ]
    clearedCallbacks.forEach((callback) => {
      const result = SessionClosureModel.step(cleared.state, callback)
      expect(result.decision).toEqual({ type: "noop", reason: "stale" })
      expect(result.commands).toEqual([])
      expect(SessionClosureModel.view(result.state)).toEqual(clearedBefore)
    })
  })

  // I-43/I-44 | boundary: invalid/terminal worker callbacks | mutant: omit current-tuple guard | red: rejection/no-op.
  test("C2 worker callbacks reject pre-promotion results and ignore stale terminal results", () => {
    const setup = accepted("c2-worker-cells")
    const dequeued = SessionClosureModel.step(setup.accepted.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    const registration = workerRegistration(dequeued)

    const earlyPromotion = SessionClosureModel.step(setup.accepted.state, {
      type: "worker.registered",
      instance: setup.ids.instance,
      registration,
      worker: setup.ids.workerA,
    })
    expect(earlyPromotion.decision.type).toBe("rejected")
    if (earlyPromotion.decision.type === "rejected")
      expect(["invalid_transition", "unverified"]).toContain(earlyPromotion.decision.reason)
    expect(earlyPromotion.commands).toEqual([])
    expect(SessionClosureModel.view(earlyPromotion.state)).toEqual(SessionClosureModel.view(setup.accepted.state))

    const earlyRegistrationFailure = SessionClosureModel.step(setup.accepted.state, {
      type: "worker.registration_failed",
      instance: setup.ids.instance,
      registration,
    })
    expect(earlyRegistrationFailure.decision.type).toBe("rejected")
    if (earlyRegistrationFailure.decision.type === "rejected")
      expect(["invalid_transition", "unverified"]).toContain(earlyRegistrationFailure.decision.reason)
    expect(earlyRegistrationFailure.commands).toEqual([])
    expect(SessionClosureModel.view(earlyRegistrationFailure.state)).toEqual(
      SessionClosureModel.view(setup.accepted.state),
    )

    const registered = SessionClosureModel.step(dequeued.state, {
      type: "worker.registered",
      instance: setup.ids.instance,
      registration,
      worker: setup.ids.workerA,
    })
    const opening = workerOpening(registered)
    const earlyStart = SessionClosureModel.step(dequeued.state, {
      type: "worker.started",
      instance: setup.ids.instance,
      opening,
    })
    expect(earlyStart.decision.type).toBe("rejected")
    if (earlyStart.decision.type === "rejected")
      expect(["invalid_transition", "unverified"]).toContain(earlyStart.decision.reason)
    expect(earlyStart.commands).toEqual([])
    expect(SessionClosureModel.view(earlyStart.state)).toEqual(SessionClosureModel.view(dequeued.state))

    const started = SessionClosureModel.step(registered.state, {
      type: "worker.started",
      instance: setup.ids.instance,
      opening,
    })
    const exit = workerExit(started.state, setup.ids, setup.ids.operationA)
    const staleExit = SessionClosureModel.step(setup.accepted.state, exit)
    expect(staleExit.decision).toEqual({ type: "noop", reason: "stale" })
    expect(staleExit.commands).toEqual([])
    expect(SessionClosureModel.view(staleExit.state)).toEqual(SessionClosureModel.view(setup.accepted.state))

    const duplicatePromotion = SessionClosureModel.step(started.state, {
      type: "worker.registered",
      instance: setup.ids.instance,
      registration,
      worker: setup.ids.workerA,
    })
    expect(duplicatePromotion.decision.type).toBe("noop")
    if (duplicatePromotion.decision.type === "noop")
      expect(["stale", "duplicate"]).toContain(duplicatePromotion.decision.reason)
    expect(duplicatePromotion.commands).toEqual([])
    expect(SessionClosureModel.view(duplicatePromotion.state)).toEqual(SessionClosureModel.view(started.state))

    const failed = SessionClosureModel.step(setup.initial, {
      type: "supervisor.failed",
      instance: setup.ids.instance,
    })
    expect(SessionClosureModel.view(failed.state).supervisor.state).toBe("failed")
    const duplicateFailure = SessionClosureModel.step(failed.state, {
      type: "supervisor.failed",
      instance: setup.ids.instance,
    })
    expect(duplicateFailure.decision.type).toBe("noop")
    if (duplicateFailure.decision.type === "noop")
      expect(["duplicate", "settled"]).toContain(duplicateFailure.decision.reason)
    expect(duplicateFailure.commands).toEqual([])
    expect(SessionClosureModel.view(duplicateFailure.state)).toEqual(SessionClosureModel.view(failed.state))
  })

  // I-26/I-27 | boundary: detached waiter terminal callback | mutant: omit waiter-state CAS | red: duplicate no-op.
  test("C2 repeated waiter interruption cannot change an already detached waiter", () => {
    const setup = accepted("c2-waiter-cells")
    const interrupted = SessionClosureModel.step(setup.accepted.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterA,
    })

    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("detached")
    expect(ticket(interrupted.state, setup.ids.ticketA)).toMatchObject({
      state: "enqueued",
      acceptance: "accepted",
    })
    const before = SessionClosureModel.view(interrupted.state)

    const duplicate = SessionClosureModel.step(interrupted.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterA,
    })
    expect(duplicate.decision.type).toBe("noop")
    if (duplicate.decision.type === "noop") expect(["duplicate", "settled"]).toContain(duplicate.decision.reason)
    expect(duplicate.commands).toEqual([])
    expect(SessionClosureModel.view(duplicate.state)).toEqual(before)
  })

  // I-20/I-40 internal half/K111(a) | boundary: offer failure | mutant: ignore enqueue error | red: typed failure.
  test("K111(a) queue offer failure retains closure_unavailable without driver fiction", () => {
    const setup = reserved("k111-a")

    expect(ticket(setup.requested.state, setup.ids.ticketA)).toMatchObject({ state: "reserved", acceptance: "pending" })
    expect(waiter(setup.requested.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("provisional")
    expect(operation(setup.requested.state, setup.ids.operationA).driver.state).toBe("starting")

    const failed = SessionClosureModel.step(setup.requested.state, {
      type: "ticket.offer_failed",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    const current = operation(failed.state, setup.ids.operationA)
    expect(current.phase).toEqual({ type: "closure_unavailable" })
    expect(current.failure?.kind).toBe("closure_unavailable")
    expect(current.driver.state).toBe("failed")
    expect(ticket(failed.state, setup.ids.ticketA)).toMatchObject({
      state: "failed",
      acceptance: "failed",
      start: "failed",
    })
    expect(waiter(failed.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("delivery_reserved")
    expect(rootView(failed.state, setup.ids.operationA).result).toBe("failure")
    failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA])
    expect(failed.commands.some((command) => command.type === "worker.register" || command.type === "driver.run")).toBe(
      false,
    )
    expect(SessionClosureModel.view(failed.state).epochs).toEqual(SessionClosureModel.view(setup.initial).epochs)
  })

  // I-25/I-41/K111(b) | boundary: supervisor.failed | mutant: fail first ticket only | red: all gates/future admission.
  test("K111(b) supervisor failure is terminal and fails every queued ticket", () => {
    const setup = accepted("k111-b")
    const secondRequest = request(setup.accepted.state, setup.ids, {
      root: setup.ids.other,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      waiter: setup.ids.waiterB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const secondOffer = ticketOffer(secondRequest)
    const secondReceived = SessionClosureModel.step(secondRequest.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: secondOffer,
    })
    const secondAccepted = SessionClosureModel.step(secondReceived.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: secondOffer,
    })
    const before = SessionClosureModel.view(secondAccepted.state)

    expect(before.supervisor.state).toBe("running")
    expect(before.queue).toEqual([setup.ids.ticketA, setup.ids.ticketB])
    expect(ticket(secondAccepted.state, setup.ids.ticketA)).toMatchObject({ state: "enqueued", start: "pending" })
    expect(ticket(secondAccepted.state, setup.ids.ticketB)).toMatchObject({ state: "enqueued", start: "pending" })
    expect(waiter(secondAccepted.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("attached")
    expect(waiter(secondAccepted.state, setup.ids.operationB, setup.ids.waiterB).state).toBe("attached")

    const failed = SessionClosureModel.step(secondAccepted.state, {
      type: "supervisor.failed",
      instance: setup.ids.instance,
    })
    expect(SessionClosureModel.view(failed.state).supervisor.state).toBe("failed")
    expect(ticket(failed.state, setup.ids.ticketA)).toMatchObject({ state: "failed", start: "failed" })
    expect(ticket(failed.state, setup.ids.ticketB)).toMatchObject({ state: "failed", start: "failed" })
    expect(operation(failed.state, setup.ids.operationA).phase).toEqual({ type: "closure_unavailable" })
    expect(operation(failed.state, setup.ids.operationB).phase).toEqual({ type: "closure_unavailable" })
    expect(waiter(failed.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("delivery_reserved")
    expect(waiter(failed.state, setup.ids.operationB, setup.ids.waiterB).state).toBe("delivery_reserved")
    const deliveries = waiterDeliveries(failed)
    const deliveryA = deliveries.find((item) => item.operation === setup.ids.operationA)
    const deliveryB = deliveries.find((item) => item.operation === setup.ids.operationB)
    const failureA = operation(failed.state, setup.ids.operationA).failure
    const failureB = operation(failed.state, setup.ids.operationB).failure
    if (!failureA || !failureB) throw new Error("supervisor failure did not retain both operations")
    expect(deliveries).toHaveLength(2)
    expect(deliveryA).toEqual({
      type: "waiter.deliver",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      revision: failureA.revision,
      failure: "closure_unavailable",
      waiters: [setup.ids.waiterA],
    })
    expect(deliveryB).toEqual({
      type: "waiter.deliver",
      instance: setup.ids.instance,
      operation: setup.ids.operationB,
      revision: failureB.revision,
      failure: "closure_unavailable",
      waiters: [setup.ids.waiterB],
    })
    expect(failed.commands.some((command) => command.type === "driver.run")).toBe(false)
    const failedQueue = SessionClosureModel.view(failed.state).queue

    const future = request(failed.state, setup.ids, {
      root: setup.ids.third,
      operation: setup.ids.operationC,
      view: setup.ids.viewC,
      waiter: setup.ids.waiterC,
      ticket: setup.ids.ticketC,
      repair: setup.ids.repairC,
    })
    const futureOperation = operation(future.state, setup.ids.operationC)
    expect(futureOperation.phase).toEqual({ type: "closure_unavailable" })
    expect(futureOperation.failure?.kind).toBe("closure_unavailable")
    expect(futureOperation.driver.state).toBe("failed")
    expect(future.commands.some((command) => command.type === "ticket.offer")).toBe(false)
    expect(SessionClosureModel.view(future.state).supervisor.state).toBe("failed")
    expect(SessionClosureModel.view(future.state).queue).toEqual(failedQueue)
    const futureTicket = SessionClosureModel.view(future.state).tickets.find((item) => item.id === setup.ids.ticketC)
    expect(futureTicket?.state === "failed" || futureTicket?.state === "cleared" || !futureTicket).toBe(true)
    expect(futureTicket?.acceptance).not.toBe("accepted")
    expect(waiter(future.state, setup.ids.operationC, setup.ids.waiterC).state).toBe("delivery_reserved")
    failureDelivery(future, setup.ids.operationC, [setup.ids.waiterC])
  })

  // I-43/I-44/K111(c) | boundary: registration failure | mutant: retain starting | red: failed gate/zero run.
  test("K111(c) registration failure removes starting authority and runs nothing", () => {
    const setup = accepted("k111-c")
    const dequeued = SessionClosureModel.step(setup.accepted.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    const registration = workerRegistration(dequeued)

    expect(operation(dequeued.state, setup.ids.operationA).driver.state).toBe("starting")
    expect(ticket(dequeued.state, setup.ids.ticketA)).toMatchObject({
      state: "enqueued",
      dequeued: true,
      start: "pending",
    })

    const failed = SessionClosureModel.step(dequeued.state, {
      type: "worker.registration_failed",
      instance: setup.ids.instance,
      registration,
    })
    const current = operation(failed.state, setup.ids.operationA)
    expect(current.phase).toEqual({ type: "closure_unavailable" })
    expect(current.failure?.kind).toBe("closure_unavailable")
    expect(current.driver.state).toBe("failed")
    expect(ticket(failed.state, setup.ids.ticketA)).toMatchObject({ state: "failed", start: "failed" })
    expect(waiter(failed.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("delivery_reserved")
    expect(rootView(failed.state, setup.ids.operationA).result).toBe("failure")
    failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA])
    expect(failed.commands.some((command) => command.type === "driver.run")).toBe(false)
  })

  // I-43/K111(d) | boundary: promoted gate pending | mutant: supervisor defect leaves gate openable | red: failed gate/zero run.
  test("K111(d) supervisor failure after promotion fails the unopened gate", () => {
    const setup = accepted("k111-d")
    const dequeued = SessionClosureModel.step(setup.accepted.state, {
      type: "ticket.dequeued",
      instance: setup.ids.instance,
      offer: setup.offer,
    })
    const registration = workerRegistration(dequeued)
    const promoted = SessionClosureModel.step(dequeued.state, {
      type: "worker.registered",
      instance: setup.ids.instance,
      registration,
      worker: setup.ids.workerA,
    })

    expect(operation(promoted.state, setup.ids.operationA).driver).toMatchObject({
      state: "running",
      worker: setup.ids.workerA,
      gate: "pending",
    })
    expect(ticket(promoted.state, setup.ids.ticketA).start).toBe("pending")
    expect(promoted.commands.some((command) => command.type === "driver.run")).toBe(false)

    const failed = SessionClosureModel.step(promoted.state, {
      type: "supervisor.failed",
      instance: setup.ids.instance,
    })
    expect(SessionClosureModel.view(failed.state).supervisor.state).toBe("failed")
    const current = operation(failed.state, setup.ids.operationA)
    expect(current.phase).toEqual({ type: "closure_unavailable" })
    expect(current.failure?.kind).toBe("closure_unavailable")
    expect(current.driver.state).toBe("failed")
    expect(ticket(failed.state, setup.ids.ticketA).start).toBe("failed")
    expect(waiter(failed.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("delivery_reserved")
    expect(rootView(failed.state, setup.ids.operationA).result).toBe("failure")
    failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA])
    expect(failed.commands.some((command) => command.type === "driver.run")).toBe(false)
  })

  // I-26/K59 | boundary: accepted waiter interrupt | mutant: interrupt cancels shared progress | red: peer/fence/driver drift.
  test("K59 detached waiter cannot stop the accepted service-owned operation", () => {
    const setup = running("k59")
    const second = joined(setup.started.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })

    expect(second.decision.type).toBe("joined")
    if (second.decision.type === "joined") expect(second.decision.operation).toBe(setup.ids.operationA)
    expect(second.commands).toEqual([])
    expect(SessionClosureModel.view(second.state).operations).toHaveLength(1)
    expect(SessionClosureModel.view(second.state).tickets).toHaveLength(1)
    expect(SessionClosureModel.view(second.state).operations.some((item) => item.id === setup.ids.operationB)).toBe(
      false,
    )
    expect(SessionClosureModel.view(second.state).tickets.some((item) => item.id === setup.ids.ticketB)).toBe(false)
    expect(waiter(second.state, setup.ids.operationA, setup.ids.waiterB).view).toBe(setup.ids.viewA)
    expect(rootView(second.state, setup.ids.operationA).id).toBe(setup.ids.viewA)

    const closure = claimed(second.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const beforeOperation = operation(closure.returned.state, setup.ids.operationA)
    const beforeFence = SessionClosureModel.view(closure.returned.state).fences
    const beforeTicket = ticket(closure.returned.state, setup.ids.ticketA)
    const beforeView = rootView(closure.returned.state, setup.ids.operationA)

    expect(beforeOperation.driver).toMatchObject({ state: "running", gate: "opened" })
    expect(beforeTicket).toMatchObject({ state: "consumed", acceptance: "accepted", start: "opened" })
    expect(beforeFence).toEqual([
      { session: setup.ids.root, epoch: 0n, operation: setup.ids.operationA, state: "closing" },
    ])
    expect(waiter(closure.returned.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("attached")
    expect(waiter(closure.returned.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("attached")

    const interrupted = SessionClosureModel.step(closure.returned.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterA,
    })
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("detached")
    expect(waiter(interrupted.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("attached")
    expect(operation(interrupted.state, setup.ids.operationA).driver).toEqual(beforeOperation.driver)
    expect(SessionClosureModel.view(interrupted.state).fences).toEqual(beforeFence)
    expect(ticket(interrupted.state, setup.ids.ticketA)).toEqual(beforeTicket)
    expect(rootView(interrupted.state, setup.ids.operationA)).toEqual(beforeView)

    const release = released(interrupted.state, setup.ids, setup.ids.operationA, "k59")
    expect(release.delivery.waiters).toEqual([setup.ids.waiterB])
    expect(release.delivery.failure).toBeUndefined()
    expect(waiter(release.committed.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("detached")
    expect(waiter(release.committed.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("delivery_reserved")

    const delivered = SessionClosureModel.step(release.committed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: release.delivery,
      waiter: setup.ids.waiterB,
    })
    expect(waiter(delivered.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("settled")
    expect(waiter(delivered.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("detached")
    expect(rootView(delivered.state, setup.ids.operationA).result).toBe("success")
  })

  // I-27/K60 | boundary: failure reservation/delivery | mutant: remove waiter CAS | red: duplicate/late resettlement.
  test("K60 retained failure reserves and settles three waiters exactly once", () => {
    const setup = running("k60")
    const second = joined(setup.started.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const third = joined(second.state, setup.ids, {
      waiter: setup.ids.waiterC,
      operation: setup.ids.operationC,
      view: setup.ids.viewC,
      ticket: setup.ids.ticketC,
      repair: setup.ids.repairC,
    })
    const closure = claimed(third.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const issued = issuedEffect(
      closure.returned.state,
      setup.ids,
      setup.ids.operationA,
      setup.ids.permitA,
      "participant",
    )
    const pending = effectCommand(issued)
    const authority = operation(issued.state, setup.ids.operationA)
    const exit = workerExit(issued.state, setup.ids, setup.ids.operationA)

    expect(SessionClosureModel.view(issued.state).fences).toHaveLength(1)
    expect(operation(issued.state, setup.ids.operationA).waiters.map((item) => item.state)).toEqual([
      "attached",
      "attached",
      "attached",
    ])
    expect(operation(issued.state, setup.ids.operationA).driver.state).toBe("running")
    expect(SessionClosureModel.view(issued.state).effects.find((item) => item.id === setup.ids.permitA)?.state).toBe(
      "issued",
    )
    expect(pending).toEqual({
      type: "effect.run",
      instance: setup.ids.instance,
      permit: setup.ids.permitA,
      operation: setup.ids.operationA,
      repair: repair(authority),
      revision: authority.revision,
      effect: "participant",
    })

    const failed = SessionClosureModel.step(issued.state, exit)
    const delivery = failureDelivery(failed, setup.ids.operationA, [
      setup.ids.waiterA,
      setup.ids.waiterB,
      setup.ids.waiterC,
    ])
    const retainedFences = SessionClosureModel.view(failed.state).fences
    expect(operation(failed.state, setup.ids.operationA).phase).toEqual({ type: "closure_unavailable" })
    expect(operation(failed.state, setup.ids.operationA).failure?.kind).toBe("closure_unavailable")
    expect(operation(failed.state, setup.ids.operationA).waiters.map((item) => item.state)).toEqual([
      "delivery_reserved",
      "delivery_reserved",
      "delivery_reserved",
    ])
    expect(retainedFences).toHaveLength(1)

    const deliveredA = SessionClosureModel.step(failed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery,
      waiter: setup.ids.waiterA,
    })
    const deliveredB = SessionClosureModel.step(deliveredA.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery,
      waiter: setup.ids.waiterB,
    })
    const deliveredC = SessionClosureModel.step(deliveredB.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery,
      waiter: setup.ids.waiterC,
    })
    expect(operation(deliveredC.state, setup.ids.operationA).waiters.map((item) => item.state)).toEqual([
      "settled",
      "settled",
      "settled",
    ])
    expect(rootView(deliveredC.state, setup.ids.operationA).result).toBe("failure")
    expect(operation(deliveredC.state, setup.ids.operationA).phase).toEqual({ type: "closure_unavailable" })
    expect(SessionClosureModel.view(deliveredC.state).fences).toEqual(retainedFences)

    const settled = SessionClosureModel.view(deliveredC.state)
    const duplicate = SessionClosureModel.step(deliveredC.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery,
      waiter: setup.ids.waiterA,
    })
    expect(duplicate.decision).toEqual({ type: "noop", reason: "settled" })
    expect(duplicate.commands).toEqual([])
    expect(SessionClosureModel.view(duplicate.state)).toEqual(settled)

    const lateEffect = SessionClosureModel.step(duplicate.state, {
      type: "effect.return",
      instance: setup.ids.instance,
      command: pending,
      result: "success",
    })
    expect(lateEffect.decision).toEqual({ type: "noop", reason: "stale" })
    expect(lateEffect.commands).toEqual([])
    expect(SessionClosureModel.view(lateEffect.state)).toEqual(settled)

    const lateWorker = SessionClosureModel.step(lateEffect.state, exit)
    expect(lateWorker.decision).toEqual({ type: "noop", reason: "stale" })
    expect(lateWorker.commands).toEqual([])
    expect(SessionClosureModel.view(lateWorker.state)).toEqual(settled)
  })

  // I-27/K61 | boundary: second retry joins elected repair | mutant: allocate repair per retry | red: ticket/repair count.
  test("K61 concurrent repeat aborts elect one repair attempt", () => {
    const setup = running("k61")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const exit = workerExit(closure.returned.state, setup.ids, setup.ids.operationA)
    const failed = SessionClosureModel.step(closure.returned.state, exit)
    const oldDelivery = failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA])
    const oldSettled = SessionClosureModel.step(failed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: oldDelivery,
      waiter: setup.ids.waiterA,
    })

    expect(operation(oldSettled.state, setup.ids.operationA).phase).toEqual({ type: "closure_unavailable" })
    expect(operation(oldSettled.state, setup.ids.operationA).failure?.kind).toBe("closure_unavailable")
    expect(SessionClosureModel.view(oldSettled.state).fences).toHaveLength(1)

    const first = joined(oldSettled.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const offer = ticketOffer(first)
    const elected = operation(first.state, setup.ids.operationA)
    expect(elected.driver).toMatchObject({
      state: "starting",
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    expect(ticket(first.state, setup.ids.ticketB).state).toBe("reserved")
    expect(waiter(first.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("provisional")

    const second = joined(first.state, setup.ids, {
      waiter: setup.ids.waiterC,
      operation: setup.ids.operationC,
      view: setup.ids.viewC,
      ticket: setup.ids.ticketC,
      repair: setup.ids.repairC,
    })
    expect(second.commands).toEqual([])
    expect(operation(second.state, setup.ids.operationA).driver).toEqual(elected.driver)
    expect(SessionClosureModel.view(second.state).tickets.filter((item) => item.state === "reserved")).toHaveLength(1)
    expect(waiter(second.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("provisional")
    expect(waiter(second.state, setup.ids.operationA, setup.ids.waiterC).state).toBe("provisional")

    const received = SessionClosureModel.step(second.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer,
    })
    const acceptedRepair = SessionClosureModel.step(received.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer,
    })
    expect(waiter(acceptedRepair.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("attached")
    expect(waiter(acceptedRepair.state, setup.ids.operationA, setup.ids.waiterC).state).toBe("attached")

    const repairDriver = start(acceptedRepair.state, setup.ids, offer, setup.ids.workerB)
    expect(operation(repairDriver.started.state, setup.ids.operationA).driver).toMatchObject({
      state: "running",
      worker: setup.ids.workerB,
      repair: setup.ids.repairB,
      gate: "opened",
    })

    const release = released(repairDriver.started.state, setup.ids, setup.ids.operationA, "k61")
    expect(release.delivery.waiters).toEqual([setup.ids.waiterB, setup.ids.waiterC])
    expect(release.delivery.failure).toBeUndefined()
    const deliveredB = SessionClosureModel.step(release.committed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: release.delivery,
      waiter: setup.ids.waiterB,
    })
    const deliveredC = SessionClosureModel.step(deliveredB.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: release.delivery,
      waiter: setup.ids.waiterC,
    })
    expect(waiter(deliveredC.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("settled")
    expect(waiter(deliveredC.state, setup.ids.operationA, setup.ids.waiterC).state).toBe("settled")
    expect(rootView(deliveredC.state, setup.ids.operationA).result).toBe("success")
  })

  // I-27 | boundary: successful waiter delivery | mutant: remove success-delivery CAS | red: duplicate settlement.
  test("I-27 successful release settles its waiter exactly once", () => {
    const setup = running("i27-success")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const release = released(closure.returned.state, setup.ids, setup.ids.operationA, "i27-success")

    expect(release.delivery.waiters).toEqual([setup.ids.waiterA])
    expect(release.delivery.failure).toBeUndefined()
    expect(waiter(release.committed.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("delivery_reserved")
    expect(rootView(release.committed.state, setup.ids.operationA).result).toBe("success")

    const delivered = SessionClosureModel.step(release.committed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: release.delivery,
      waiter: setup.ids.waiterA,
    })
    expect(waiter(delivered.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("settled")
    const settled = SessionClosureModel.view(delivered.state)

    const duplicate = SessionClosureModel.step(delivered.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: release.delivery,
      waiter: setup.ids.waiterA,
    })
    expect(duplicate.decision).toEqual({ type: "noop", reason: "settled" })
    expect(duplicate.commands).toEqual([])
    expect(SessionClosureModel.view(duplicate.state)).toEqual(settled)
  })

  // I-20 | boundary: quiescence failure | mutant: failure releases fence | red: fence/epoch/view retention.
  test("I-20 quiescence failure retains the exact fenced operation", () => {
    const setup = running("i20-quiescence")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const stages = quiescing(closure.returned.state, setup.ids, setup.ids.operationA)
    const before = operation(stages.quiescing.state, setup.ids.operationA)
    const beforeFence = SessionClosureModel.view(stages.quiescing.state).fences
    const beforeEpochs = SessionClosureModel.view(stages.quiescing.state).epochs

    expect(before.phase).toEqual({ type: "quiescing" })
    expect(beforeFence).toHaveLength(1)
    expect(rootView(stages.quiescing.state, setup.ids.operationA).result).toBe("pending")

    const failed = SessionClosureModel.step(stages.quiescing.state, {
      type: "operation.fail",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      repair: repair(before),
      revision: before.revision,
      failure: "quiescence_failed",
    })
    expect(operation(failed.state, setup.ids.operationA).phase).toEqual({ type: "quiescence_failed" })
    expect(operation(failed.state, setup.ids.operationA).failure?.kind).toBe("quiescence_failed")
    expect(SessionClosureModel.view(failed.state).fences).toEqual(beforeFence)
    expect(SessionClosureModel.view(failed.state).epochs).toEqual(beforeEpochs)
    expect(rootView(failed.state, setup.ids.operationA).result).toBe("failure")
    expect(waiter(failed.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("delivery_reserved")
  })

  // I-20/I-40 internal half | boundary: planning failure | mutant: drop captured plan | red: retained plan/no generation.
  test("I-20 planning failure retains captured truth without fabricating a generation", () => {
    const setup = running("i20-planning")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const stages = quiescing(closure.returned.state, setup.ids, setup.ids.operationA)
    const capture = SessionClosureModel.scan(stages.quiescing.state, setup.ids.operationA)
    const proved = SessionClosureModel.step(stages.quiescing.state, {
      type: "quiescence.prove",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      prior: capture,
      current: capture,
    })
    const begun = SessionClosureModel.step(proved.state, {
      type: "planning.begin",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
    })
    const before = operation(begun.state, setup.ids.operationA)
    const beforeFence = SessionClosureModel.view(begun.state).fences
    const beforeEpochs = SessionClosureModel.view(begun.state).epochs

    expect(before.phase).toEqual({ type: "planning" })
    expect(before.planning).toBeDefined()
    expect(beforeFence).toHaveLength(1)
    expect(before.generations).toEqual([])

    const failed = SessionClosureModel.step(begun.state, {
      type: "operation.fail",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      repair: repair(before),
      revision: before.revision,
      failure: "planning_failed",
    })
    const retained = operation(failed.state, setup.ids.operationA)
    expect(retained.phase).toEqual({ type: "planning_failed_identity_missing" })
    expect(retained.failure?.kind).toBe("planning_failed")
    expect(retained.planning).toEqual(before.planning)
    expect(retained.generations).toEqual([])
    expect(SessionClosureModel.view(failed.state).fences).toEqual(beforeFence)
    expect(SessionClosureModel.view(failed.state).epochs).toEqual(beforeEpochs)
    expect(rootView(failed.state, setup.ids.operationA).result).toBe("failure")
  })

  // I-20/K53 | boundary: record failure | mutant: drop frozen generation | red: byte-exact generation/fence retention.
  // K53's premise at model level: the fence entry survives record failure, so fence-presence
  // admission keeps rejecting destructive calls for as long as the operation stays failed. The
  // physical half is `closure-driver.test.ts`'s §8.9 step 8 row.
  test("I-20 record failure retains its immutable generation and fence", () => {
    const setup = running("i20-record")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const stages = recording(closure.returned.state, setup.ids, setup.ids.operationA, "i20-record")
    const before = operation(stages.frozen.state, setup.ids.operationA)
    const beforeFence = SessionClosureModel.view(stages.frozen.state).fences
    const beforeEpochs = SessionClosureModel.view(stages.frozen.state).epochs

    expect(before.phase.type).toBe("recording")
    expect(before.generations).toHaveLength(1)
    expect(beforeFence).toHaveLength(1)

    const failed = SessionClosureModel.step(stages.frozen.state, {
      type: "operation.fail",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      repair: repair(before),
      revision: before.revision,
      failure: "record_failed",
    })
    const retained = operation(failed.state, setup.ids.operationA)
    expect(retained.phase).toEqual({ type: "record_failed" })
    expect(retained.failure?.kind).toBe("record_failed")
    expect(retained.generations).toEqual(before.generations)
    expect(SessionClosureModel.view(failed.state).fences).toEqual(beforeFence)
    expect(SessionClosureModel.view(failed.state).epochs).toEqual(beforeEpochs)
    expect(rootView(failed.state, setup.ids.operationA).result).toBe("failure")
  })

  // I-25 | boundary: dispose with frozen partial operation | mutant: infer completion on death | red: no success/epoch/restart.
  test("I-25 disposal never upgrades partial durable evidence into completed closure", () => {
    const setup = running("i25")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const stages = released(closure.returned.state, setup.ids, setup.ids.operationA, "i25")
    const beforeState = stages.verified.state
    const before = operation(beforeState, setup.ids.operationA)
    const beforeEpochs = SessionClosureModel.view(beforeState).epochs

    expect(before.phase.type).toBe("recording")
    expect(before.generations).toHaveLength(1)
    expect(before.generations[0]?.committedPrefix).toBe(1)
    expect(SessionClosureModel.view(beforeState).fences).toHaveLength(1)
    expect(rootView(beforeState, setup.ids.operationA).result).toBe("pending")
    expect(before.failure).toBeUndefined()

    const disposed = SessionClosureModel.step(beforeState, {
      type: "dispose",
      instance: setup.ids.instance,
    })
    const after = operation(disposed.state, setup.ids.operationA)
    expect(SessionClosureModel.view(disposed.state).supervisor.state).toBe("disposed")
    expect(after.generations).toEqual(before.generations)
    expect(after.failure).toBeUndefined()
    expect(rootView(disposed.state, setup.ids.operationA).result).toBe("pending")
    expect(SessionClosureModel.view(disposed.state).epochs).toEqual(beforeEpochs)
    expect(disposed.commands.some((command) => command.type === "ticket.offer" || command.type === "driver.run")).toBe(
      false,
    )
    expect(disposed.commands.some((command) => command.type === "waiter.deliver")).toBe(false)
  })

  // I-44/K112 | boundary: claiming worker exit | mutant: clear driver without retained failure | red: fence/batch/permit.
  test("K112 claiming worker finalizer retains failure and revokes unstarted authority", () => {
    const setup = running("k112-claiming")
    const second = joined(setup.started.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const closure = claimed(second.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const issued = issuedEffect(
      closure.returned.state,
      setup.ids,
      setup.ids.operationA,
      setup.ids.permitA,
      "participant",
    )
    const exit = workerExit(issued.state, setup.ids, setup.ids.operationA)

    expect(operation(issued.state, setup.ids.operationA).phase).toEqual({ type: "claiming" })
    expect(operation(issued.state, setup.ids.operationA).waiters.map((item) => item.state)).toEqual([
      "attached",
      "attached",
    ])
    expect(SessionClosureModel.view(issued.state).fences).toHaveLength(1)
    expect(SessionClosureModel.view(issued.state).effects.find((item) => item.id === setup.ids.permitA)?.state).toBe(
      "issued",
    )

    const failed = SessionClosureModel.step(issued.state, exit)
    const current = operation(failed.state, setup.ids.operationA)
    const delivery = failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA, setup.ids.waiterB])
    expect(current.phase).toEqual({ type: "closure_unavailable" })
    expect(current.failure?.kind).toBe("closure_unavailable")
    expect(current.driver.state).toBe("failed")
    expect(SessionClosureModel.view(failed.state).fences).toHaveLength(1)
    expect(SessionClosureModel.view(failed.state).effects.find((item) => item.id === setup.ids.permitA)?.state).toBe(
      "revoked",
    )
    expect(operation(failed.state, setup.ids.operationA).waiters.map((item) => item.state)).toEqual([
      "delivery_reserved",
      "delivery_reserved",
    ])
    expect(rootView(failed.state, setup.ids.operationA).result).toBe("failure")
    expect(delivery.waiters).toEqual([setup.ids.waiterA, setup.ids.waiterB])
    expect(delivery.failure).toBe("closure_unavailable")
  })

  // I-44/K112 | boundary: dispatched permit before worker exit | mutant: revoke in-flight permit | red: report-once state.
  test("K112 in-flight permit survives worker exit and reports once without follow-on work", () => {
    const setup = running("k112-in-flight")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const issued = issuedEffect(
      closure.returned.state,
      setup.ids,
      setup.ids.operationA,
      setup.ids.permitA,
      "participant",
    )
    const command = effectCommand(issued)
    const authority = operation(issued.state, setup.ids.operationA)

    expect(SessionClosureModel.view(issued.state).effects.find((item) => item.id === setup.ids.permitA)?.state).toBe(
      "issued",
    )
    expect(command).toEqual({
      type: "effect.run",
      instance: setup.ids.instance,
      permit: setup.ids.permitA,
      operation: setup.ids.operationA,
      repair: repair(authority),
      revision: authority.revision,
      effect: "participant",
    })

    const dispatched = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance: setup.ids.instance,
      command,
    })
    expect(dispatched.decision).toEqual({ type: "applied" })
    expect(dispatched.commands).toEqual([])
    expect(
      SessionClosureModel.view(dispatched.state).effects.find((item) => item.id === setup.ids.permitA)?.state,
    ).toBe("in_flight")

    const exit = workerExit(dispatched.state, setup.ids, setup.ids.operationA)
    const failed = SessionClosureModel.step(dispatched.state, exit)
    failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA])
    expect(operation(failed.state, setup.ids.operationA).phase).toEqual({ type: "closure_unavailable" })
    expect(SessionClosureModel.view(failed.state).effects.find((item) => item.id === setup.ids.permitA)?.state).toBe(
      "in_flight",
    )

    const reported = SessionClosureModel.step(failed.state, {
      type: "effect.return",
      instance: setup.ids.instance,
      command,
      result: "success",
    })
    expect(reported.decision).toEqual({ type: "applied" })
    expect(reported.commands).toEqual([])
    expect(operation(reported.state, setup.ids.operationA).phase).toEqual({ type: "closure_unavailable" })
    expect(SessionClosureModel.view(reported.state).effects.find((item) => item.id === setup.ids.permitA)?.state).toBe(
      "returned",
    )
    expect(reported.commands.some((item) => item.type === "effect.run")).toBe(false)

    const before = SessionClosureModel.view(reported.state)
    const duplicate = SessionClosureModel.step(reported.state, {
      type: "effect.return",
      instance: setup.ids.instance,
      command,
      result: "success",
    })
    expect(duplicate.decision.type).toBe("noop")
    if (duplicate.decision.type === "noop") expect(["duplicate", "settled"]).toContain(duplicate.decision.reason)
    expect(duplicate.commands).toEqual([])
    expect(SessionClosureModel.view(duplicate.state)).toEqual(before)
  })

  // I-20/I-27 | boundary: failed Effect return and reserved waiter delivery | mutant: make the failure branch unreachable; red: no typed failure or waiter delivery is reserved.
  test("failed Effect return retains typed failure and settles its waiter exactly once", () => {
    const setup = running("effect-failure")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const issued = issuedEffect(
      closure.returned.state,
      setup.ids,
      setup.ids.operationA,
      setup.ids.permitA,
      "participant",
    )
    const command = effectCommand(issued)
    const dispatched = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance: setup.ids.instance,
      command,
    })

    expect(dispatched.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(dispatched.state).effects).toContainEqual(
      expect.objectContaining({ id: setup.ids.permitA, state: "in_flight" }),
    )
    expect(operation(dispatched.state, setup.ids.operationA).phase).toEqual({ type: "claiming" })
    expect(waiter(dispatched.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("attached")

    const failed = SessionClosureModel.step(dispatched.state, {
      type: "effect.return",
      instance: setup.ids.instance,
      command,
      result: "failure",
    })
    const delivery = failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA])
    expect(failed.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(failed.state).effects).toContainEqual(
      expect.objectContaining({ id: setup.ids.permitA, state: "returned" }),
    )
    expect(operation(failed.state, setup.ids.operationA).phase).toEqual({ type: "quiescence_failed" })
    expect(operation(failed.state, setup.ids.operationA).failure?.kind).toBe("quiescence_failed")
    expect(waiter(failed.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("delivery_reserved")
    expect(delivery.failure).toBe("quiescence_failed")

    const delivered = SessionClosureModel.step(failed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery,
      waiter: setup.ids.waiterA,
    })
    expect(delivered.decision).toEqual({ type: "applied" })
    expect(waiter(delivered.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("settled")
    expect(rootView(delivered.state, setup.ids.operationA).result).toBe("failure")

    const before = SessionClosureModel.view(delivered.state)
    const duplicate = SessionClosureModel.step(delivered.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery,
      waiter: setup.ids.waiterA,
    })
    expect(duplicate.decision).toEqual({ type: "noop", reason: "settled" })
    expect(duplicate.commands).toEqual([])
    expect(SessionClosureModel.view(duplicate.state)).toEqual(before)
  })

  // I-20/I-27 | boundary: a late failed in-flight Effect after another failure reserved delivery | baseline defect: secondary failure currently replaces the first failure and strands its delivery.
  test("late failed Effect cannot invalidate an already-reserved failure delivery", () => {
    const setup = running("effect-secondary-failure")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const issued = issuedEffect(
      closure.returned.state,
      setup.ids,
      setup.ids.operationA,
      setup.ids.permitA,
      "participant",
    )
    const command = effectCommand(issued)
    const dispatched = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance: setup.ids.instance,
      command,
    })
    expect(dispatched.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(dispatched.state).effects).toContainEqual(
      expect.objectContaining({ id: setup.ids.permitA, state: "in_flight" }),
    )

    const exited = SessionClosureModel.step(
      dispatched.state,
      workerExit(dispatched.state, setup.ids, setup.ids.operationA),
    )
    const delivery = failureDelivery(exited, setup.ids.operationA, [setup.ids.waiterA])
    const retained = operation(exited.state, setup.ids.operationA)
    expect(retained.phase).toEqual({ type: "closure_unavailable" })
    expect(retained.failure?.kind).toBe("closure_unavailable")
    expect(retained.delivery).toEqual({ revision: delivery.revision, waiters: delivery.waiters })
    expect(waiter(exited.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("delivery_reserved")
    expect(SessionClosureModel.view(exited.state).effects).toContainEqual(
      expect.objectContaining({ id: setup.ids.permitA, state: "in_flight" }),
    )

    const reported = SessionClosureModel.step(exited.state, {
      type: "effect.return",
      instance: setup.ids.instance,
      command,
      result: "failure",
    })
    const after = operation(reported.state, setup.ids.operationA)
    expect(reported.decision).toEqual({ type: "applied" })
    expect(reported.commands).toEqual([])
    expect(SessionClosureModel.view(reported.state).effects).toContainEqual(
      expect.objectContaining({ id: setup.ids.permitA, state: "returned" }),
    )
    expect(after.phase).toEqual({ type: "closure_unavailable" })
    expect(after.failure).toEqual(retained.failure)
    expect(after.delivery).toEqual(retained.delivery)
    expect(waiter(reported.state, setup.ids.operationA, setup.ids.waiterA)).toMatchObject({
      state: "delivery_reserved",
      deliveryRevision: delivery.revision,
    })

    const delivered = SessionClosureModel.step(reported.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery,
      waiter: setup.ids.waiterA,
    })
    expect(delivered.decision).toEqual({ type: "applied" })
    expect(waiter(delivered.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("settled")
  })

  // I-09/I-22 | boundary: release.prepare with issued and in-flight Effects | mutant: delete the in-flight arm of readyToRelease's Effect predicate; red: release.verify appears before return.
  test("release rejects issued and in-flight Effects at its own boundary", () => {
    const setup = running("release-live-effect")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const release = released(closure.returned.state, setup.ids, setup.ids.operationA, "release-live-effect")
    const ready = release.verified.state

    expect(release.prepared.decision).toEqual({ type: "applied" })
    expect(release.prepared.commands.map((item) => item.type)).toEqual(["release.verify"])
    expect(operation(ready, setup.ids.operationA).phase.type).toBe("recording")
    expect(
      operation(ready, setup.ids.operationA).generations.every((item) => item.committedPrefix === item.facts.length),
    ).toBe(true)

    const issued = issuedEffect(ready, setup.ids, setup.ids.operationA, setup.ids.permitB, "participant")
    const command = effectCommand(issued)
    expect(issued.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(issued.state).effects).toContainEqual(
      expect.objectContaining({ id: setup.ids.permitB, state: "issued" }),
    )
    const issuedBefore = SessionClosureModel.view(issued.state)
    const blockedIssued = SessionClosureModel.step(issued.state, {
      type: "release.prepare",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
    })
    expect(blockedIssued.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(blockedIssued.commands).toEqual([])
    expect(SessionClosureModel.view(blockedIssued.state)).toEqual(issuedBefore)

    const dispatched = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance: setup.ids.instance,
      command,
    })
    expect(dispatched.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(dispatched.state).effects).toContainEqual(
      expect.objectContaining({ id: setup.ids.permitB, state: "in_flight" }),
    )
    const inFlightBefore = SessionClosureModel.view(dispatched.state)
    const blockedInFlight = SessionClosureModel.step(dispatched.state, {
      type: "release.prepare",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
    })
    expect(blockedInFlight.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(blockedInFlight.commands).toEqual([])
    expect(SessionClosureModel.view(blockedInFlight.state)).toEqual(inFlightBefore)

    const returned = SessionClosureModel.step(dispatched.state, {
      type: "effect.return",
      instance: setup.ids.instance,
      command,
      result: "success",
    })
    expect(SessionClosureModel.view(returned.state).effects).toContainEqual(
      expect.objectContaining({ id: setup.ids.permitB, state: "returned" }),
    )
    const prepared = SessionClosureModel.step(returned.state, {
      type: "release.prepare",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
    })
    expect(prepared.decision).toEqual({ type: "applied" })
    expect(prepared.commands.map((item) => item.type)).toEqual(["release.verify"])
  })

  // I-20/I-44/K112 | boundary: quiescing worker exit | mutant: finalizer drops phase truth | red: fence/view retention.
  test("K112 quiescing worker finalizer preserves the fenced phase payload", () => {
    const setup = running("k112-quiescing")
    const second = joined(setup.started.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const closure = claimed(second.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const stages = quiescing(closure.returned.state, setup.ids, setup.ids.operationA)
    const issued = issuedEffect(
      stages.quiescing.state,
      setup.ids,
      setup.ids.operationA,
      setup.ids.permitA,
      "participant",
    )
    const before = operation(issued.state, setup.ids.operationA)
    const beforeFence = SessionClosureModel.view(issued.state).fences
    const exit = workerExit(issued.state, setup.ids, setup.ids.operationA)

    expect(before.phase).toEqual({ type: "quiescing" })
    expect(beforeFence).toHaveLength(1)
    expect(before.waiters.map((item) => item.state)).toEqual(["attached", "attached"])
    expect(SessionClosureModel.view(issued.state).effects.find((item) => item.id === setup.ids.permitA)?.state).toBe(
      "issued",
    )

    const failed = SessionClosureModel.step(issued.state, exit)
    const current = operation(failed.state, setup.ids.operationA)
    const delivery = failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA, setup.ids.waiterB])
    expect(current.phase).toEqual({ type: "closure_unavailable" })
    expect(current.failure?.kind).toBe("closure_unavailable")
    expect(SessionClosureModel.view(failed.state).fences).toEqual(beforeFence)
    expect(rootView(failed.state, setup.ids.operationA).nodes).toEqual(
      rootView(issued.state, setup.ids.operationA).nodes,
    )
    expect(SessionClosureModel.view(failed.state).effects.find((item) => item.id === setup.ids.permitA)?.state).toBe(
      "revoked",
    )
    expect(rootView(failed.state, setup.ids.operationA).result).toBe("failure")
    expect(delivery.waiters).toEqual([setup.ids.waiterA, setup.ids.waiterB])
    expect(delivery.failure).toBe("closure_unavailable")
  })

  // I-20/I-44/K112 | boundary: recording worker exit | mutant: finalizer deletes generation | red: generation/fence batch.
  test("K112 recording worker finalizer preserves the frozen generation", () => {
    const setup = running("k112-recording")
    const second = joined(setup.started.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const closure = claimed(second.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const stages = recording(closure.returned.state, setup.ids, setup.ids.operationA, "k112-recording")
    const issued = issuedEffect(
      stages.frozen.state,
      setup.ids,
      setup.ids.operationA,
      setup.ids.permitA,
      "record_readback",
    )
    const before = operation(issued.state, setup.ids.operationA)
    const beforeFence = SessionClosureModel.view(issued.state).fences
    const exit = workerExit(issued.state, setup.ids, setup.ids.operationA)

    expect(before.phase.type).toBe("recording")
    expect(before.generations).toHaveLength(1)
    expect(before.waiters.map((item) => item.state)).toEqual(["attached", "attached"])
    expect(beforeFence).toHaveLength(1)
    expect(SessionClosureModel.view(issued.state).effects.find((item) => item.id === setup.ids.permitA)?.state).toBe(
      "issued",
    )

    const failed = SessionClosureModel.step(issued.state, exit)
    const current = operation(failed.state, setup.ids.operationA)
    const delivery = failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA, setup.ids.waiterB])
    expect(current.phase).toEqual({ type: "closure_unavailable" })
    expect(current.failure?.kind).toBe("closure_unavailable")
    expect(current.generations).toEqual(before.generations)
    expect(SessionClosureModel.view(failed.state).fences).toEqual(beforeFence)
    expect(SessionClosureModel.view(failed.state).effects.find((item) => item.id === setup.ids.permitA)?.state).toBe(
      "revoked",
    )
    expect(rootView(failed.state, setup.ids.operationA).result).toBe("failure")
    expect(delivery.waiters).toEqual([setup.ids.waiterA, setup.ids.waiterB])
    expect(delivery.failure).toBe("closure_unavailable")
  })

  // I-44/K113 | boundary: stale finalizer after repair permit | mutant: resolve finalizer by operation only | red: repair drift.
  test("K113 stale old finalizer cannot fail the current repair", () => {
    const setup = running("k113")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const oldExit = workerExit(closure.returned.state, setup.ids, setup.ids.operationA)
    const failed = SessionClosureModel.step(closure.returned.state, oldExit)
    const oldDelivery = failureDelivery(failed, setup.ids.operationA, [setup.ids.waiterA])
    const oldSettled = SessionClosureModel.step(failed.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: oldDelivery,
      waiter: setup.ids.waiterA,
    })
    const retry = joined(oldSettled.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const offer = ticketOffer(retry)
    const received = SessionClosureModel.step(retry.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer,
    })
    const acceptedRepair = SessionClosureModel.step(received.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer,
    })
    const repairDriver = start(acceptedRepair.state, setup.ids, offer, setup.ids.workerB)
    const issued = issuedEffect(
      repairDriver.started.state,
      setup.ids,
      setup.ids.operationA,
      setup.ids.permitA,
      "participant",
    )
    const current = operation(issued.state, setup.ids.operationA)
    const currentEffects = SessionClosureModel.view(issued.state).effects.filter(
      (item) => item.operation === setup.ids.operationA && item.repair === setup.ids.repairB,
    )
    const before = SessionClosureModel.view(issued.state)

    expect(current.driver).toMatchObject({
      state: "running",
      worker: setup.ids.workerB,
      repair: setup.ids.repairB,
      gate: "opened",
    })
    expect(waiter(issued.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("attached")
    expect(currentEffects).toHaveLength(1)
    expect(currentEffects[0]?.state).toBe("issued")

    const stale = SessionClosureModel.step(issued.state, oldExit)
    expect(stale.decision).toEqual({ type: "noop", reason: "stale" })
    expect(stale.commands).toEqual([])
    expect(SessionClosureModel.view(stale.state)).toEqual(before)
  })

  // I-45/K62 | boundary: A cleanup after B accepted | mutant: cleanup by root | red: B projection changes/disappears.
  test("K62 old cleanup cannot remove a new post-release operation", () => {
    const setup = running("k62")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const release = released(closure.returned.state, setup.ids, setup.ids.operationA, "k62")
    const old = operation(release.committed.state, setup.ids.operationA)
    const oldRevision = old.revision

    expect(old.phase).toEqual({ type: "released_pending_delivery" })
    expect(waiter(release.committed.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("delivery_reserved")
    expect(release.delivery.failure).toBeUndefined()

    const nextRequest = request(release.committed.state, setup.ids, {
      root: setup.ids.root,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      waiter: setup.ids.waiterB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const nextOffer = ticketOffer(nextRequest)
    const nextReceived = SessionClosureModel.step(nextRequest.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: nextOffer,
    })
    const nextAccepted = SessionClosureModel.step(nextReceived.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: nextOffer,
    })
    const next = operation(nextAccepted.state, setup.ids.operationB)
    const before = operationProjection(nextAccepted.state, setup.ids.operationB)

    expect(next.id).toBe(setup.ids.operationB)
    expect(next.id).not.toBe(setup.ids.operationA)
    expect({ operation: next.id, revision: next.revision }).not.toEqual({
      operation: old.id,
      revision: old.revision,
    })
    expect(next.driver).toMatchObject({ state: "starting", ticket: setup.ids.ticketB })
    expect(ticket(nextAccepted.state, setup.ids.ticketB)).toMatchObject({ state: "enqueued", acceptance: "accepted" })
    expect(waiter(nextAccepted.state, setup.ids.operationB, setup.ids.waiterB).state).toBe("attached")

    const delivered = SessionClosureModel.step(nextAccepted.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: release.delivery,
      waiter: setup.ids.waiterA,
    })
    expect(delivered.decision).toEqual({ type: "applied" })
    expect(delivered.commands).toEqual([])
    expect(waiter(delivered.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("settled")
    expect(operationProjection(delivered.state, setup.ids.operationB)).toEqual(before)

    const cleaned = SessionClosureModel.step(delivered.state, {
      type: "cleanup",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      revision: oldRevision,
    })

    expect(cleaned.decision).toEqual({ type: "applied" })
    expect(cleaned.commands).toEqual([])
    expect(SessionClosureModel.view(cleaned.state).operations.some((item) => item.id === setup.ids.operationA)).toBe(
      false,
    )
    expect(operationProjection(cleaned.state, setup.ids.operationB)).toEqual(before)
  })

  // I-45/K114 | boundary: A completions after B runs | mutant: same-root current lookup | red: B ticket/worker/fence drift.
  test("K114 old delivery cleanup and finalizer cannot affect the new same-root worker", () => {
    const setup = running("k114")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const release = released(closure.returned.state, setup.ids, setup.ids.operationA, "k114")
    const oldExit = workerExit(release.verified.state, setup.ids, setup.ids.operationA)
    const old = operation(release.committed.state, setup.ids.operationA)
    const oldRevision = old.revision

    expect(old.phase).toEqual({ type: "released_pending_delivery" })
    expect(waiter(release.committed.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("delivery_reserved")
    expect(release.delivery.failure).toBeUndefined()

    const nextRequest = request(release.committed.state, setup.ids, {
      root: setup.ids.root,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      waiter: setup.ids.waiterB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const nextOffer = ticketOffer(nextRequest)
    const nextReceived = SessionClosureModel.step(nextRequest.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: nextOffer,
    })
    const nextAccepted = SessionClosureModel.step(nextReceived.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: nextOffer,
    })
    const nextDriver = start(nextAccepted.state, setup.ids, nextOffer, setup.ids.workerB)
    const nextClosure = claimed(nextDriver.started.state, setup.ids, setup.ids.operationB, setup.ids.permitB)
    const before = operationProjection(nextClosure.returned.state, setup.ids.operationB)
    const current = operation(nextClosure.returned.state, setup.ids.operationB)

    expect(current.id).toBe(setup.ids.operationB)
    expect(current.id).not.toBe(setup.ids.operationA)
    expect({ operation: current.id, revision: current.revision }).not.toEqual({
      operation: old.id,
      revision: old.revision,
    })
    expect(current.driver).toMatchObject({
      state: "running",
      ticket: setup.ids.ticketB,
      worker: setup.ids.workerB,
      gate: "opened",
    })
    expect(SessionClosureModel.view(nextClosure.returned.state).fences).toEqual([
      { session: setup.ids.root, epoch: 1n, operation: setup.ids.operationB, state: "closing" },
    ])
    expect(before.effects).toHaveLength(1)
    expect(before.effects[0]?.id).toBe(setup.ids.permitB)

    const delivered = SessionClosureModel.step(nextClosure.returned.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: release.delivery,
      waiter: setup.ids.waiterA,
    })
    expect(delivered.decision).toEqual({ type: "applied" })
    expect(delivered.commands).toEqual([])
    expect(waiter(delivered.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("settled")
    expect(operationProjection(delivered.state, setup.ids.operationB)).toEqual(before)

    const cleaned = SessionClosureModel.step(delivered.state, {
      type: "cleanup",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      revision: oldRevision,
    })
    expect(cleaned.decision).toEqual({ type: "applied" })
    expect(cleaned.commands).toEqual([])
    expect(SessionClosureModel.view(cleaned.state).operations.some((item) => item.id === setup.ids.operationA)).toBe(
      false,
    )
    expect(operationProjection(cleaned.state, setup.ids.operationB)).toEqual(before)

    const stale = SessionClosureModel.step(cleaned.state, oldExit)
    expect(stale.decision).toEqual({ type: "noop", reason: "stale" })
    expect(stale.commands).toEqual([])
    expect(operationProjection(stale.state, setup.ids.operationB)).toEqual(before)
  })

  // I-28/I-44/K113 | boundary: an in-flight permit from a superseded attempt returning failure after the repair cleared the retained failure | mutant: enter the failure branch without checking attempt currency | red: the current repair is demoted to the stale attempt's failure.
  test("K113 a stale in-flight failure return is accounted without demoting the current repair", () => {
    const setup = running("k113-stale-return")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const issued = issuedEffect(
      closure.returned.state,
      setup.ids,
      setup.ids.operationA,
      setup.ids.permitA,
      "participant",
    )
    const command = effectCommand(issued)
    const dispatched = SessionClosureModel.step(issued.state, {
      type: "effect.dispatch",
      instance: setup.ids.instance,
      command,
    })
    const exited = SessionClosureModel.step(
      dispatched.state,
      workerExit(dispatched.state, setup.ids, setup.ids.operationA),
    )
    const oldDelivery = failureDelivery(exited, setup.ids.operationA, [setup.ids.waiterA])
    const oldSettled = SessionClosureModel.step(exited.state, {
      type: "waiter.delivered",
      instance: setup.ids.instance,
      delivery: oldDelivery,
      waiter: setup.ids.waiterA,
    })
    const retry = joined(oldSettled.state, setup.ids, {
      waiter: setup.ids.waiterB,
      operation: setup.ids.operationB,
      view: setup.ids.viewB,
      ticket: setup.ids.ticketB,
      repair: setup.ids.repairB,
    })
    const repairOffer = ticketOffer(retry)
    const received = SessionClosureModel.step(retry.state, {
      type: "ticket.received",
      instance: setup.ids.instance,
      offer: repairOffer,
    })
    const acceptedRepair = SessionClosureModel.step(received.state, {
      type: "ticket.accept",
      instance: setup.ids.instance,
      offer: repairOffer,
    })
    const repairDriver = start(acceptedRepair.state, setup.ids, repairOffer, setup.ids.workerB)
    const advanced = SessionClosureModel.step(repairDriver.started.state, {
      type: "operation.advance",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      to: { type: "fencing" },
    })
    const current = operation(advanced.state, setup.ids.operationA)
    const currentView = rootView(advanced.state, setup.ids.operationA)
    const before = operationProjection(advanced.state, setup.ids.operationA)

    expect(command.repair).toBe(setup.ids.repairA)
    expect(SessionClosureModel.view(advanced.state).effects).toContainEqual(
      expect.objectContaining({ id: setup.ids.permitA, state: "in_flight", repair: setup.ids.repairA }),
    )
    expect(current.driver).toMatchObject({
      state: "running",
      worker: setup.ids.workerB,
      repair: setup.ids.repairB,
      gate: "opened",
    })
    expect(current.phase).toEqual({ type: "fencing" })
    expect(current.failure).toBeUndefined()
    expect(waiter(advanced.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("attached")

    const stale = SessionClosureModel.step(advanced.state, {
      type: "effect.return",
      instance: setup.ids.instance,
      command,
      result: "failure",
    })
    const after = operation(stale.state, setup.ids.operationA)

    expect(stale.decision).toEqual({ type: "applied" })
    expect(stale.commands).toEqual([])
    expect(SessionClosureModel.view(stale.state).effects).toContainEqual(
      expect.objectContaining({ id: setup.ids.permitA, state: "returned", repair: setup.ids.repairA }),
    )
    expect(after.phase).toEqual({ type: "fencing" })
    expect(after.driver).toEqual(current.driver)
    expect(after.failure).toBeUndefined()
    expect(after.revision).toBe(current.revision)
    expect(waiter(stale.state, setup.ids.operationA, setup.ids.waiterB).state).toBe("attached")
    expect(rootView(stale.state, setup.ids.operationA)).toEqual(currentView)
    expect(operationProjection(stale.state, setup.ids.operationA)).toEqual({
      ...before,
      effects: before.effects.map((item) =>
        item.id === setup.ids.permitA ? { ...item, state: "returned" as const } : item,
      ),
    })
  })

  // I-45/K62 | boundary: successful release whose waiters have all detached | mutant: suppress the delivery command when no waiter remains | red: no command carries the released revision, so nothing authorizes cleanup.
  test("I-45 successful release with no remaining waiter still authorizes exact cleanup", () => {
    const setup = running("release-no-waiter")
    const closure = claimed(setup.started.state, setup.ids, setup.ids.operationA, setup.ids.signalA)
    const detached = SessionClosureModel.step(closure.returned.state, {
      type: "waiter.interrupt",
      instance: setup.ids.instance,
      waiter: setup.ids.waiterA,
    })

    expect(detached.decision).toEqual({ type: "applied" })
    expect(waiter(detached.state, setup.ids.operationA, setup.ids.waiterA).state).toBe("detached")
    expect(operation(detached.state, setup.ids.operationA).waiters).toHaveLength(1)

    const stages = recording(detached.state, setup.ids, setup.ids.operationA, "release-no-waiter")
    const next = SessionClosureModel.step(stages.frozen.state, {
      type: "writer.next",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
    })
    const candidate = pairCandidate(next)
    const pairIssued = SessionClosureModel.step(next.state, {
      type: "pair.issue",
      instance: setup.ids.instance,
      candidate,
      permit: setup.ids.pairA,
    })
    const write = pairWrite(pairIssued)
    const verified = SessionClosureModel.step(pairIssued.state, {
      type: "pair.return",
      instance: setup.ids.instance,
      write,
      message: "verified",
      part: "verified",
    })
    const prepared = SessionClosureModel.step(verified.state, {
      type: "release.prepare",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
    })
    const check = releaseCheck(prepared)

    expect(operation(verified.state, setup.ids.operationA).waiters.every((item) => item.state === "detached")).toBe(
      true,
    )
    expect(prepared.decision).toEqual({ type: "applied" })

    const committed = SessionClosureModel.step(prepared.state, {
      type: "release.commit",
      instance: setup.ids.instance,
      check,
    })
    const released = operation(committed.state, setup.ids.operationA)
    const deliveries = waiterDeliveries(committed)
    const delivery = deliveries[0]

    expect(committed.decision).toEqual({ type: "applied" })
    expect(released.phase).toEqual({ type: "released_pending_delivery" })
    expect(deliveries).toHaveLength(1)
    expect(delivery?.instance).toBe(setup.ids.instance)
    expect(delivery?.operation).toBe(setup.ids.operationA)
    expect(delivery?.revision).toBe(released.revision)
    expect(delivery?.waiters).toEqual([])
    expect(delivery?.failure).toBeUndefined()
    expect(released.delivery).toEqual({ revision: released.revision, waiters: [] })
    expect(released.waiters.some((item) => item.state === "delivery_reserved")).toBe(false)
    expect(rootView(committed.state, setup.ids.operationA).result).toBe("success")

    const wrongRevision = SessionClosureModel.step(committed.state, {
      type: "cleanup",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      revision: released.revision + 1n,
    })
    expect(wrongRevision.decision).toEqual({ type: "noop", reason: "stale" })
    expect(
      SessionClosureModel.view(wrongRevision.state).operations.some((item) => item.id === setup.ids.operationA),
    ).toBe(true)

    const cleaned = SessionClosureModel.step(committed.state, {
      type: "cleanup",
      instance: setup.ids.instance,
      operation: setup.ids.operationA,
      revision: delivery?.revision ?? released.revision,
    })
    expect(cleaned.decision).toEqual({ type: "applied" })
    expect(cleaned.commands).toEqual([])
    expect(SessionClosureModel.view(cleaned.state).operations.some((item) => item.id === setup.ids.operationA)).toBe(
      false,
    )
    expect(SessionClosureModel.view(cleaned.state).tickets.some((item) => item.operation === setup.ids.operationA)).toBe(
      false,
    )
  })
})
