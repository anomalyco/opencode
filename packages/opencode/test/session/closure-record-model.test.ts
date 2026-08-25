import { describe, expect, test } from "bun:test"
import { SessionClosureModel } from "@/session/closure/model"

type Kind = SessionClosureModel.Command["type"]
type Command<T extends Kind> = Extract<SessionClosureModel.Command, { readonly type: T }>

type Run = {
  readonly operation: SessionClosureModel.OperationID
  readonly view: SessionClosureModel.ViewID
  readonly waiter: SessionClosureModel.WaiterID
  readonly ticket: SessionClosureModel.TicketID
  readonly repair: SessionClosureModel.RepairID
  readonly worker: SessionClosureModel.WorkerID
}

type Plan = {
  readonly state: SessionClosureModel.State
  readonly read: Command<"plan.read">
}

type Frozen = {
  readonly state: SessionClosureModel.State
  readonly read: SessionClosureModel.PlanRead
  readonly generation: SessionClosureModel.GenerationView
}

function key<K extends SessionClosureModel.IDKind>(kind: K, value: string) {
  return SessionClosureModel.id(kind, value)
}

function kit(name: string) {
  return {
    instance: key("instance", `${name}:instance`),
    rootA: key("session", `${name}:root-a`),
    rootB: key("session", `${name}:root-b`),
    shared: key("session", `${name}:shared`),
    extra: key("session", `${name}:extra`),
    edgeA: key("edge", `${name}:edge-a`),
    edgeB: key("edge", `${name}:edge-b`),
    edgeExtra: key("edge", `${name}:edge-extra`),
    partA: key("part", `${name}:task-part-a`),
    partB: key("part", `${name}:task-part-b`),
    participant: key("participant", `${name}:participant`),
    lease: key("lease", `${name}:lease`),
    scope: key("scope", `${name}:scope`),
    signalA: key("effect", `${name}:signal-a`),
    signalB: key("effect", `${name}:signal-b`),
    signalC: key("effect", `${name}:signal-c`),
    pairA: key("pair", `${name}:pair-a`),
    pairB: key("pair", `${name}:pair-b`),
    a: {
      operation: key("operation", `${name}:operation-a`),
      view: key("view", `${name}:view-a`),
      waiter: key("waiter", `${name}:waiter-a`),
      ticket: key("ticket", `${name}:ticket-a`),
      repair: key("repair", `${name}:repair-a`),
      worker: key("worker", `${name}:worker-a`),
    },
    b: {
      operation: key("operation", `${name}:operation-b`),
      view: key("view", `${name}:view-b`),
      waiter: key("waiter", `${name}:waiter-b`),
      ticket: key("ticket", `${name}:ticket-b`),
      repair: key("repair", `${name}:repair-b`),
      worker: key("worker", `${name}:worker-b`),
    },
    retry: {
      operation: key("operation", `${name}:operation-retry`),
      view: key("view", `${name}:view-retry`),
      waiter: key("waiter", `${name}:waiter-retry`),
      ticket: key("ticket", `${name}:ticket-retry`),
      repair: key("repair", `${name}:repair-retry`),
      worker: key("worker", `${name}:worker-retry`),
    },
  }
}

type Kit = ReturnType<typeof kit>

function initial(keys: Kit, sessions: readonly SessionClosureModel.SessionID[] = []) {
  return SessionClosureModel.make({
    instance: keys.instance,
    sessions: [keys.rootA, keys.rootB, keys.shared, keys.extra, ...sessions],
  })
}

function command<T extends Kind>(result: SessionClosureModel.Step, type: T): Command<T> {
  const found = result.commands.find((item): item is Command<T> => item.type === type)
  if (!found) throw new Error(`missing ${type} command`)
  return found
}

function operation(state: SessionClosureModel.State, id: SessionClosureModel.OperationID) {
  const found = SessionClosureModel.view(state).operations.find((item) => item.id === id)
  if (!found) throw new Error(`missing operation ${id}`)
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

function boot(
  state: SessionClosureModel.State,
  instance: SessionClosureModel.InstanceID,
  root: SessionClosureModel.SessionID,
  run: Run,
) {
  const reserved = SessionClosureModel.step(state, {
    type: "request",
    instance,
    root,
    operation: run.operation,
    view: run.view,
    waiter: run.waiter,
    ticket: run.ticket,
    repair: run.repair,
  })
  const offer = command(reserved, "ticket.offer")
  const received = SessionClosureModel.step(reserved.state, { type: "ticket.received", instance, offer })
  const accepted = SessionClosureModel.step(received.state, { type: "ticket.accept", instance, offer })
  const dequeued = SessionClosureModel.step(accepted.state, { type: "ticket.dequeued", instance, offer })
  const registration = command(dequeued, "worker.register")
  const registered = SessionClosureModel.step(dequeued.state, {
    type: "worker.registered",
    instance,
    registration,
    worker: run.worker,
  })
  const opening = command(registered, "worker.open")
  const started = SessionClosureModel.step(registered.state, { type: "worker.started", instance, opening })
  return started.state
}

function connected(
  root: SessionClosureModel.SessionID,
  active: SessionClosureModel.SessionID,
  edge: SessionClosureModel.EdgeID,
): SessionClosureModel.ProofInput {
  if (root === active) return { value: "proven_connected", root, active, path: [root], edges: [] }
  return {
    value: "proven_connected",
    root,
    active,
    path: [root, active],
    edges: [{ id: edge, owner: root, child: active }],
  }
}

function claim(
  state: SessionClosureModel.State,
  instance: SessionClosureModel.InstanceID,
  operationID: SessionClosureModel.OperationID,
  proofs: readonly SessionClosureModel.ProofInput[],
  signals: readonly SessionClosureModel.EffectID[],
) {
  const driver = operation(state, operationID).driver
  if (driver.state === "none") throw new Error(`operation ${operationID} has no driver repair authority`)
  return SessionClosureModel.step(state, {
    type: "operation.claim",
    instance,
    operation: operationID,
    repair: driver.repair,
    revision: operation(state, operationID).revision,
    proofs,
    signals,
  })
}

function settle(result: SessionClosureModel.Step) {
  return result.commands.reduce((state, item) => {
    if (item.type !== "effect.run") return state
    const dispatched = SessionClosureModel.step(state, {
      type: "effect.dispatch",
      instance: item.instance,
      command: item,
    })
    return SessionClosureModel.step(dispatched.state, {
      type: "effect.return",
      instance: item.instance,
      command: item,
      result: "success",
    }).state
  }, result.state)
}

function require(
  state: SessionClosureModel.State,
  instance: SessionClosureModel.InstanceID,
  operation: SessionClosureModel.OperationID,
  view: SessionClosureModel.ViewID,
  nodes: readonly SessionClosureModel.SessionID[],
  facts: readonly SessionClosureModel.FactInput[],
) {
  return SessionClosureModel.step(state, { type: "view.require", instance, operation, view, nodes, facts }).state
}

function quiesce(
  state: SessionClosureModel.State,
  instance: SessionClosureModel.InstanceID,
  operationID: SessionClosureModel.OperationID,
): SessionClosureModel.State {
  const phase = operation(state, operationID).phase.type
  if (phase === "quiescing") return state
  if (phase === "claiming") {
    const fencing = SessionClosureModel.step(state, {
      type: "operation.advance",
      instance,
      operation: operationID,
      to: { type: "fencing" },
    })
    return quiesce(fencing.state, instance, operationID)
  }
  if (phase === "fencing") {
    return SessionClosureModel.step(state, {
      type: "operation.advance",
      instance,
      operation: operationID,
      to: { type: "quiescing" },
    }).state
  }
  throw new Error(`cannot quiesce operation from ${phase}`)
}

function prove(
  state: SessionClosureModel.State,
  instance: SessionClosureModel.InstanceID,
  operationID: SessionClosureModel.OperationID,
) {
  const quiescing = quiesce(state, instance, operationID)
  const capture = SessionClosureModel.scan(quiescing, operationID)
  const result = SessionClosureModel.step(quiescing, {
    type: "quiescence.prove",
    instance,
    operation: operationID,
    prior: capture,
    current: capture,
  })
  if (result.decision.type !== "applied") throw new Error("stable quiescence was not applied")
  return result.state
}

function begin(
  state: SessionClosureModel.State,
  instance: SessionClosureModel.InstanceID,
  operation: SessionClosureModel.OperationID,
): Plan {
  const result = SessionClosureModel.step(state, { type: "planning.begin", instance, operation })
  return { state: result.state, read: command(result, "plan.read") }
}

function planned(read: SessionClosureModel.PlanRead) {
  if (read.capture.successors.length > 0) return read.capture.successors
  return read.capture.facts
}

function seed(
  facts: readonly SessionClosureModel.FactID[],
  name: string,
  clockMillis = 1_000,
  highWaterMillis = 900,
): SessionClosureModel.FreezeSeed {
  return {
    clockMillis,
    highWaterMillis,
    coordinates: facts.map((fact, index) => ({
      fact,
      message: key("message", `${name}:message-${index}`),
      part: key("part", `${name}:part-${index}`),
      messageEvent: key("event", `${name}:message-event-${index}`),
      partEvent: key("event", `${name}:part-event-${index}`),
    })),
  }
}

/**
 * I-15's immutable record payload, projected explicitly rather than by comparing an entire
 * GenerationView. Generation progress (`committedPrefix`, `inFlight`, `verified`, `failure`) is
 * SUPPOSED to change; these are the fields that never may.
 */
const frozenRecord = (record: SessionClosureModel.FrozenPair) => ({
  messageBytes: record.messageBytes,
  partBytes: record.partBytes,
  messageTime: record.messageTime,
  partTime: record.partTime,
  message: record.message,
  part: record.part,
  messageEvent: record.messageEvent,
  partEvent: record.partEvent,
  text: record.text,
  metadata: record.metadata,
})

const frozenRecords = (generation: SessionClosureModel.GenerationView) =>
  structuredClone(generation.records.map(frozenRecord))

function identity(
  session: SessionClosureModel.SessionID,
  name: string,
  source: SessionClosureModel.Identity["source"],
): SessionClosureModel.Identity {
  const model = {
    providerID: "test-provider",
    modelID: "test-model",
    variant: { present: true, value: "test-variant" } as const,
  }
  if (source === "prior_user_message") {
    return {
      source,
      sourceMessage: key("message", `${name}:source-${session}`),
      agent: "test-agent",
      model,
    }
  }
  return { source, agent: "test-agent", model }
}

function identities(
  read: SessionClosureModel.PlanRead,
  name: string,
  source: SessionClosureModel.Identity["source"] = "prior_user_message",
) {
  return read.targets.map((session) => ({ session, identity: identity(session, name, source) }))
}

function freeze(
  state: SessionClosureModel.State,
  instance: SessionClosureModel.InstanceID,
  operationID: SessionClosureModel.OperationID,
  name: string,
  source: SessionClosureModel.Identity["source"] = "prior_user_message",
  given?: SessionClosureModel.FreezeSeed,
): Frozen {
  const before = operation(state, operationID).generations
  const plan = begin(state, instance, operationID)
  const result = SessionClosureModel.step(plan.state, {
    type: "planning.return",
    instance,
    read: plan.read,
    identities: identities(plan.read, name, source),
    seed: given ?? seed(planned(plan.read), name),
  })
  const after = operation(result.state, operationID).generations
  const created = after.find(
    (item) => !before.some((prior) => prior.freezeOwner === item.freezeOwner && prior.generation === item.generation),
  )
  if (!created) throw new Error("planning did not freeze a generation")
  return { state: result.state, read: plan.read, generation: created }
}

function verify(
  state: SessionClosureModel.State,
  instance: SessionClosureModel.InstanceID,
  operationID: SessionClosureModel.OperationID,
  total: number,
  name: string,
  index = 0,
): SessionClosureModel.State {
  if (index === total) return state
  const next = SessionClosureModel.step(state, { type: "writer.next", instance, operation: operationID })
  const candidate = command(next, "pair.candidate")
  const issued = SessionClosureModel.step(next.state, {
    type: "pair.issue",
    instance,
    candidate,
    permit: key("pair", `${name}:pair-${index}`),
  })
  const write = command(issued, "pair.write")
  const returned = SessionClosureModel.step(issued.state, {
    type: "pair.return",
    instance,
    write,
    message: "verified",
    part: "verified",
  })
  return verify(returned.state, instance, operationID, total, name, index + 1)
}

function facts(keys: Kit, root: SessionClosureModel.SessionID): readonly SessionClosureModel.FactInput[] {
  const edge = root === keys.rootA ? keys.edgeA : keys.edgeB
  const part = root === keys.rootA ? keys.partA : keys.partB
  return [
    { type: "self", subject: keys.shared, outcome: "cancelled", yielded: true },
    {
      type: "edge",
      subject: keys.shared,
      owner: root,
      child: keys.shared,
      edge,
      taskPart: part,
      outcome: "cancelled",
      yielded: true,
    },
    { type: "root", root },
  ]
}

function branch(
  keys: Kit,
  run: Run,
  root: SessionClosureModel.SessionID,
  active: SessionClosureModel.SessionID,
  edge: SessionClosureModel.EdgeID,
  signal: SessionClosureModel.EffectID,
  nodes: readonly SessionClosureModel.SessionID[],
  required: readonly SessionClosureModel.FactInput[],
) {
  const started = boot(initial(keys), keys.instance, root, run)
  const claimed = claim(started, keys.instance, run.operation, [connected(root, active, edge)], [signal])
  const signalled = settle(claimed)
  return require(signalled, keys.instance, run.operation, run.view, nodes, required)
}

function ordered(
  keys: Kit,
  first: Run,
  firstRoot: SessionClosureModel.SessionID,
  second: Run,
  secondRoot: SessionClosureModel.SessionID,
) {
  const startedFirst = boot(initial(keys), keys.instance, firstRoot, first)
  const claimedFirst = claim(
    startedFirst,
    keys.instance,
    first.operation,
    [connected(firstRoot, keys.shared, firstRoot === keys.rootA ? keys.edgeA : keys.edgeB)],
    [keys.signalA],
  )
  const settledFirst = settle(claimedFirst)
  const startedSecond = boot(settledFirst, keys.instance, secondRoot, second)
  const claimedSecond = claim(
    startedSecond,
    keys.instance,
    second.operation,
    [connected(secondRoot, secondRoot, firstRoot === keys.rootA ? keys.edgeB : keys.edgeA)],
    [keys.signalB],
  )
  const settledSecond = settle(claimedSecond)
  const creation = SessionClosureModel.view(settledSecond)
    .operations.toSorted((left, right) => Number(left.creationSequence - right.creationSequence))
    .map((item) => item.views[0]?.root)
  const linked = claim(
    settledSecond,
    keys.instance,
    second.operation,
    [connected(secondRoot, keys.shared, secondRoot === keys.rootA ? keys.edgeA : keys.edgeB)],
    [keys.signalC],
  )
  const merged = settle(linked)
  const firstRequired = require(merged, keys.instance, first.operation, first.view, [firstRoot, keys.shared], facts(
    keys,
    firstRoot,
  ))
  const secondRequired = require(firstRequired, keys.instance, first.operation, second.view, [
    secondRoot,
    keys.shared,
  ], facts(keys, secondRoot))
  return { state: secondRequired, owner: first.operation, loser: second.operation, creation }
}

function label(fact: SessionClosureModel.FactView, keys: Kit) {
  if (fact.type === "self") return "shared-self"
  if (fact.type === "edge" && fact.owner === keys.rootA) return "edge-a"
  if (fact.type === "edge" && fact.owner === keys.rootB) return "edge-b"
  if (fact.type === "root" && fact.root === keys.rootA) return "root-a"
  if (fact.type === "root" && fact.root === keys.rootB) return "root-b"
  throw new Error(`unexpected fact ${fact.id}`)
}

function fixedseed(
  operation: SessionClosureModel.OperationView,
  keys: Kit,
  name: string,
): SessionClosureModel.FreezeSeed {
  return {
    clockMillis: 4_000,
    highWaterMillis: 3_000,
    coordinates: operation.facts.map((fact) => {
      const namepart = label(fact, keys)
      return {
        fact: fact.id,
        message: key("message", `${name}:${namepart}:message`),
        part: key("part", `${name}:${namepart}:part`),
        messageEvent: key("event", `${name}:${namepart}:message-event`),
        partEvent: key("event", `${name}:${namepart}:part-event`),
      }
    }),
  }
}

function fixedfreeze(
  state: SessionClosureModel.State,
  operationID: SessionClosureModel.OperationID,
  keys: Kit,
  name: string,
) {
  const stable = prove(state, keys.instance, operationID)
  const plan = begin(stable, keys.instance, operationID)
  const result = SessionClosureModel.step(plan.state, {
    type: "planning.return",
    instance: keys.instance,
    read: plan.read,
    identities: identities(plan.read, name),
    seed: fixedseed(operation(plan.state, operationID), keys, name),
  })
  return { state: result.state, generation: generation(result.state, operationID, operationID, 1) }
}

function timed(keys: Kit, name: string, clockMillis: number, highWaterMillis: number) {
  const prepared = branch(
    keys,
    keys.a,
    keys.rootA,
    keys.shared,
    keys.edgeA,
    keys.signalA,
    [keys.rootA, keys.shared],
    facts(keys, keys.rootA),
  )
  const stable = prove(prepared, keys.instance, keys.a.operation)
  const before = SessionClosureModel.view(stable).sequences.freeze
  const input = seed(
    operation(stable, keys.a.operation).facts.map((fact) => fact.id),
    name,
    clockMillis,
    highWaterMillis,
  )
  const frozen = freeze(stable, keys.instance, keys.a.operation, name, "prior_user_message", input)
  return { frozen, before }
}

function stale(
  state: SessionClosureModel.State,
  keys: Kit,
  plan: Plan,
  operationID: SessionClosureModel.OperationID,
  generations: number,
  freezeSequence: bigint,
  name: string,
) {
  const result = SessionClosureModel.step(state, {
    type: "planning.return",
    instance: keys.instance,
    read: plan.read,
    identities: identities(plan.read, name),
    seed: seed(planned(plan.read), name),
  })
  expect(result.decision).toEqual({ type: "noop", reason: "stale" })
  expect(operation(result.state, operationID).phase).toEqual({ type: "quiescing" })
  expect(operation(result.state, operationID).generations).toHaveLength(generations)
  expect(SessionClosureModel.view(result.state).sequences.freeze).toBe(freezeSequence)
  return result.state
}

function predecessor(keys: Kit) {
  const startedA = boot(initial(keys), keys.instance, keys.rootA, keys.a)
  const claimedA = claim(
    startedA,
    keys.instance,
    keys.a.operation,
    [connected(keys.rootA, keys.shared, keys.edgeA)],
    [keys.signalA],
  )
  const settledA = settle(claimedA)
  const requiredA = require(settledA, keys.instance, keys.a.operation, keys.a.view, [keys.rootA, keys.shared], facts(
    keys,
    keys.rootA,
  ))
  const startedB = boot(requiredA, keys.instance, keys.rootB, keys.b)
  const claimedB = claim(
    startedB,
    keys.instance,
    keys.b.operation,
    [connected(keys.rootB, keys.rootB, keys.edgeB)],
    [keys.signalB],
  )
  const settledB = settle(claimedB)
  const requiredB = require(settledB, keys.instance, keys.b.operation, keys.b.view, [keys.rootB], [
    { type: "self", subject: keys.rootB, outcome: "completed", yielded: false },
    { type: "root", root: keys.rootB, direct: { outcome: "completed", yielded: false } },
  ])
  const stableB = prove(requiredB, keys.instance, keys.b.operation)
  const frozenB = freeze(stableB, keys.instance, keys.b.operation, `${keys.instance}:predecessor`)
  return { state: frozenB.state, predecessor: frozenB.generation }
}

function late(keys: Kit) {
  const prepared = predecessor(keys)
  const next = SessionClosureModel.step(prepared.state, {
    type: "writer.next",
    instance: keys.instance,
    operation: keys.b.operation,
  })
  return {
    state: next.state,
    candidate: command(next, "pair.candidate"),
    predecessor: prepared.predecessor,
  }
}

function complete(keys: Kit) {
  const prepared = predecessor(keys)
  const state = verify(
    prepared.state,
    keys.instance,
    keys.b.operation,
    prepared.predecessor.records.length,
    `${keys.instance}:predecessor`,
  )
  return { state, predecessor: generation(state, keys.b.operation, keys.b.operation, 1) }
}

function connect(state: SessionClosureModel.State, keys: Kit) {
  return claim(state, keys.instance, keys.b.operation, [connected(keys.rootB, keys.shared, keys.edgeB)], [keys.signalC])
}

function issued(
  state: SessionClosureModel.State,
  keys: Kit,
  operationID: SessionClosureModel.OperationID,
  permit: SessionClosureModel.PairID,
) {
  const next = SessionClosureModel.step(state, { type: "writer.next", instance: keys.instance, operation: operationID })
  const candidate = command(next, "pair.candidate")
  const result = SessionClosureModel.step(next.state, {
    type: "pair.issue",
    instance: keys.instance,
    candidate,
    permit,
  })
  return { state: result.state, candidate, write: command(result, "pair.write") }
}

describe("session closure record model", () => {
  // I-10 @ planning.begin; mutant: delete the quiescence-proof guard; red: a plan command or generation appears.
  test("I-10 rejects planning before proven quiescence at the planning boundary", () => {
    const keys = kit("i10")
    const claimed = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const quiescing = quiesce(claimed, keys.instance, keys.a.operation)
    const before = SessionClosureModel.view(quiescing)
    const result = SessionClosureModel.step(quiescing, {
      type: "planning.begin",
      instance: keys.instance,
      operation: keys.a.operation,
    })

    expect(result.decision.type).toBe("rejected")
    expect(result.commands).toHaveLength(0)
    expect(operation(result.state, keys.a.operation).generations).toHaveLength(0)
    expect(SessionClosureModel.view(result.state).sequences.freeze).toBe(before.sequences.freeze)
  })

  // I-10 @ pre-proof planning.return; mutant: accept a structurally exact read issued only on a proved sibling branch; red: the unproved branch freezes.
  test("I-10 rejects a planning return whose read was never issued by the pre-proof state", () => {
    const keys = kit("i10-return")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const quiescing = quiesce(prepared, keys.instance, keys.a.operation)
    const issued = begin(prove(quiescing, keys.instance, keys.a.operation), keys.instance, keys.a.operation)
    const before = SessionClosureModel.view(quiescing)
    expect(issued.read.type).toBe("plan.read")

    const result = SessionClosureModel.step(quiescing, {
      type: "planning.return",
      instance: keys.instance,
      read: issued.read,
      identities: identities(issued.read, "i10-return"),
      seed: seed(planned(issued.read), "i10-return"),
    })
    expect(result.decision.type).toBe("rejected")
    expect(result.commands).toHaveLength(0)
    expect(operation(result.state, keys.a.operation).phase).toEqual({ type: "quiescing" })
    expect(operation(result.state, keys.a.operation).generations).toHaveLength(0)
    expect(SessionClosureModel.view(result.state).sequences.freeze).toBe(before.sequences.freeze)
  })

  // I-11 @ operation.claim/freeze; mutant: manufacture cancelled truth from the signal request; red: a pre-observation fact appears or the frozen outcome is not completed.
  test("I-11 freezes authoritative race-winner truth rather than cancellation intent", () => {
    const keys = kit("i11")
    const started = boot(initial(keys), keys.instance, keys.rootA, keys.a)
    const requested = claim(
      started,
      keys.instance,
      keys.a.operation,
      [connected(keys.rootA, keys.rootA, keys.edgeA)],
      [keys.signalA],
    )
    expect(operation(requested.state, keys.a.operation).facts).toHaveLength(0)

    const signalled = settle(requested)
    const required = require(signalled, keys.instance, keys.a.operation, keys.a.view, [keys.rootA], [
      { type: "root", root: keys.rootA, direct: { outcome: "completed", yielded: false } },
    ])
    const frozen = freeze(prove(required, keys.instance, keys.a.operation), keys.instance, keys.a.operation, "i11")
    const record = frozen.generation.records.find((item) => item.fact.type === "root")
    if (!record || record.metadata.record_kind !== "root") throw new Error("missing root record")
    expect(record.metadata.terminal_outcome).toBe("completed")
  })

  // I-12 @ generation freeze; mutant: couple yielded state to terminal outcome; red: one outcome/yield pair changes or is omitted.
  test("I-12 preserves yielded state independently across every terminal outcome", () => {
    const keys = kit("i12")
    const outcomes = ["cancelled", "completed", "error", "unknown"] as const
    const subjects = outcomes.flatMap((outcome) =>
      [false, true].map((yielded) => ({
        session: key("session", `i12:${outcome}:${yielded}`),
        edge: key("edge", `i12:${outcome}:${yielded}`),
        signal: key("effect", `i12:${outcome}:${yielded}`),
        outcome,
        yielded,
      })),
    )
    const state = initial(
      keys,
      subjects.map((item) => item.session),
    )
    const started = boot(state, keys.instance, keys.rootA, keys.a)
    const claimed = claim(
      started,
      keys.instance,
      keys.a.operation,
      subjects.map((item) => connected(keys.rootA, item.session, item.edge)),
      subjects.map((item) => item.signal),
    )
    const signalled = settle(claimed)
    const required = require(signalled, keys.instance, keys.a.operation, keys.a.view, [
      keys.rootA,
      ...subjects.map((item) => item.session),
    ], [
      ...subjects.map((item) => ({
        type: "self" as const,
        subject: item.session,
        outcome: item.outcome,
        yielded: item.yielded,
      })),
      { type: "root", root: keys.rootA },
    ])
    const frozen = freeze(prove(required, keys.instance, keys.a.operation), keys.instance, keys.a.operation, "i12")

    for (const subject of subjects) {
      const record = frozen.generation.records.find(
        (item) => item.fact.type === "self" && item.fact.subject === subject.session,
      )
      if (!record || record.metadata.record_kind !== "self") throw new Error(`missing self record ${subject.session}`)
      expect(record.metadata.terminal_outcome).toBe(subject.outcome)
      expect(record.metadata.state_at_fence).toBe(subject.yielded ? "yielded_with_outstanding_work" : undefined)
    }
  })

  // I-15/I-17 @ planning.return freeze; mutant: use highWaterMillis + 1 unconditionally; red: the 2000/1900 clock-dominant tuple shifts to 1901.
  test("I-15 and I-17 freeze clock-dominant times plus exact sequence and revision", () => {
    const keys = kit("freeze-clock")
    const result = timed(keys, "freeze-clock", 2_000, 1_900)
    const records = result.frozen.generation.records
    expect(records).toHaveLength(3)
    expect(records.map((record) => record.messageTime)).toEqual([2_000, 2_002, 2_004])
    expect(records.map((record) => record.partTime)).toEqual([2_001, 2_003, 2_005])
    expect(result.frozen.generation.freezeSequence).toBe(result.before + 1n)
    expect(SessionClosureModel.view(result.frozen.state).sequences.freeze).toBe(result.before + 1n)
    expect(result.frozen.generation.freezeRevision).toBe(result.frozen.read.revision)
  })

  // I-15/I-17 @ planning.return freeze; mutant: collapse each Message/Part pair onto one time; red: the 1000/900 strict +2/+1 ordinal tuples differ.
  test("I-15 and I-17 apply strict ordinal spacing to the 1000/900 seed", () => {
    const keys = kit("freeze-ordinal")
    const result = timed(keys, "freeze-ordinal", 1_000, 900)
    const records = result.frozen.generation.records
    expect(records).toHaveLength(3)
    expect(records.map((record) => [record.messageTime, record.partTime])).toEqual([
      [1_000, 1_001],
      [1_002, 1_003],
      [1_004, 1_005],
    ])
  })

  // I-15/I-17 @ planning.return freeze; mutant: use clockMillis unconditionally; red: a high-water-dominant seed starts at 1000 instead of 1901.
  test("I-15 and I-17 use highWaterMillis plus one when it exceeds the clock", () => {
    const keys = kit("freeze-high-water")
    const result = timed(keys, "freeze-high-water", 1_000, 1_900)
    const records = result.frozen.generation.records
    expect(records).toHaveLength(3)
    expect(records.map((record) => record.messageTime)).toEqual([1_901, 1_903, 1_905])
    expect(records.map((record) => record.partTime)).toEqual([1_902, 1_904, 1_906])
  })

  // D / I-15 @ planning.return coordinate binding; mutant: bind coordinates by array index instead
  // of fact ID; red: reversed mint order swaps every coordinate and therefore both frozen byte blobs.
  test("I-15 binds coordinates by fact ID, so mint order cannot change frozen records", () => {
    const keys = kit("freeze-coordinate-order")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.shared,
      keys.edgeA,
      keys.signalA,
      [keys.rootA, keys.shared],
      facts(keys, keys.rootA),
    )
    const stable = prove(prepared, keys.instance, keys.a.operation)
    const canonicalSeed = seed(
      operation(stable, keys.a.operation).facts.map((fact) => fact.id),
      "freeze-coordinate-order",
      4_000,
      3_000,
    )
    expect(canonicalSeed.coordinates).toHaveLength(3)

    const canonical = freeze(
      stable,
      keys.instance,
      keys.a.operation,
      "freeze-coordinate-order",
      "prior_user_message",
      canonicalSeed,
    )
    const shuffledSeed = { ...canonicalSeed, coordinates: canonicalSeed.coordinates.toReversed() }
    // Positive precondition: this is genuinely a different mint order, not a one-record reversal.
    expect(shuffledSeed.coordinates.map((item) => item.fact)).not.toEqual(
      canonicalSeed.coordinates.map((item) => item.fact),
    )
    const shuffled = freeze(
      stable,
      keys.instance,
      keys.a.operation,
      "freeze-coordinate-order",
      "prior_user_message",
      shuffledSeed,
    )

    // Full frozen records, not a sorted projection: if coordinate order leaked into binding, the
    // Message/Part/Event IDs and their serialized bytes would differ in place.
    expect(shuffled.generation.records).toEqual(canonical.generation.records)
  })

  // I-39 @ generation freeze; mutant: clear synthetic on one frozen TextPart pair; red: the non-empty all-true projection fails.
  test("I-39 freezes every closure evidence pair as synthetic", () => {
    const keys = kit("i39-synthetic")
    const result = timed(keys, "i39-synthetic", 1_000, 900)
    expect(result.frozen.generation.records).toHaveLength(3)
    expect(result.frozen.generation.records.every((record) => record.synthetic === true)).toBe(true)
  })

  // I-39 @ generation freeze; mutant: omit version 1 from the reserved closure payload; red: exact metadata differs.
  test("I-39 freezes the complete reserved closure metadata payload", () => {
    const keys = kit("i39-metadata")
    const result = timed(keys, "i39-metadata", 1_000, 900)
    const records = result.frozen.generation.records
    expect(records).toHaveLength(3)

    for (const record of records) {
      expect(record.identity.source).toBe("prior_user_message")
      expect(record.identity.sourceMessage).toBeDefined()
      const common = {
        version: 1 as const,
        freeze_owner_operation_id: keys.a.operation,
        generation: 1,
        fact_key: record.fact.key,
        identity_source: "prior_user_message" as const,
        source_user_message_id: record.identity.sourceMessage,
      }
      if (record.fact.type === "self") {
        expect(record.metadata).toEqual({
          ...common,
          record_kind: "self",
          subject_session_id: keys.shared,
          terminal_outcome: "cancelled",
          state_at_fence: "yielded_with_outstanding_work",
        })
        continue
      }
      if (record.fact.type === "edge") {
        expect(record.metadata).toEqual({
          ...common,
          record_kind: "edge",
          subject_session_id: keys.shared,
          owner_session_id: keys.rootA,
          child_session_id: keys.shared,
          task_part_id: keys.partA,
          terminal_outcome: "cancelled",
          state_at_fence: "yielded_with_outstanding_work",
        })
        continue
      }
      expect(record.metadata).toEqual({
        ...common,
        record_kind: "root",
        requested_root_session_id: keys.rootA,
        subject_session_id: keys.rootA,
        branch_outcome: "quiesced",
      })
    }
  })

  // I-14/K74 @ pre-freeze merge and freeze; mutant: choose the newest merge participant; red: canonical alias or frozen owner names the wrong operation.
  test("I-14 and K74 keep the oldest operation as writer in both creation orders", () => {
    const keysA = kit("i14-a")
    const first = ordered(keysA, keysA.a, keysA.rootA, keysA.b, keysA.rootB)
    expect(first.creation).toEqual([keysA.rootA, keysA.rootB])
    expect(SessionClosureModel.view(first.state).aliases).toContainEqual({
      alias: keysA.b.operation,
      canonical: keysA.a.operation,
    })
    const frozenA = fixedfreeze(first.state, keysA.a.operation, keysA, "i14-a")
    expect(frozenA.generation.freezeOwner).toBe(keysA.a.operation)
    expect(
      frozenA.generation.records.every((item) => item.metadata.freeze_owner_operation_id === keysA.a.operation),
    ).toBe(true)

    const keysB = kit("i14-b")
    const second = ordered(keysB, keysB.b, keysB.rootB, keysB.a, keysB.rootA)
    expect(second.creation).toEqual([keysB.rootB, keysB.rootA])
    expect(SessionClosureModel.view(second.state).aliases).toContainEqual({
      alias: keysB.a.operation,
      canonical: keysB.b.operation,
    })
    const frozenB = fixedfreeze(second.state, keysB.b.operation, keysB, "i14-b")
    expect(frozenB.generation.freezeOwner).toBe(keysB.b.operation)
    expect(
      frozenB.generation.records.every((item) => item.metadata.freeze_owner_operation_id === keysB.b.operation),
    ).toBe(true)
  })

  // I-33/K72 @ planning.return revision check; mutant: delete captured revision comparison; red: the stale read freezes.
  test("I-33 and K72 discard a plan after its operation revision changes", () => {
    const keys = kit("k72-revision")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const plan = begin(prove(prepared, keys.instance, keys.a.operation), keys.instance, keys.a.operation)
    const before = operation(plan.state, keys.a.operation)
    const freezeSequence = SessionClosureModel.view(plan.state).sequences.freeze
    const changed = SessionClosureModel.step(plan.state, {
      type: "view.require",
      instance: keys.instance,
      operation: keys.a.operation,
      view: keys.a.view,
      nodes: [keys.rootA, keys.extra],
      facts: [],
    })
    expect(operation(changed.state, keys.a.operation).revision).toBe(before.revision + 1n)
    expect(operation(changed.state, keys.a.operation).facts).toEqual(before.facts)
    stale(changed.state, keys, plan, keys.a.operation, 0, freezeSequence, "k72-revision")
  })

  // I-33/K72 @ late claim; mutant: fail to advance the operation revision; red: the route revision is not +1 and its old plan can freeze.
  test("I-33 and K72 discard a plan after a late claim changes its captured claim set", () => {
    const keys = kit("k72-claim")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const plan = begin(prove(prepared, keys.instance, keys.a.operation), keys.instance, keys.a.operation)
    const revision = operation(plan.state, keys.a.operation).revision
    const freezeSequence = SessionClosureModel.view(plan.state).sequences.freeze
    const changed = claim(
      plan.state,
      keys.instance,
      keys.a.operation,
      [connected(keys.rootA, keys.extra, keys.edgeExtra)],
      [keys.signalB],
    )
    expect(operation(changed.state, keys.a.operation).claims).toContain(keys.extra)
    expect(operation(changed.state, keys.a.operation).revision).toBe(revision + 1n)
    expect(plan.read.capture.claims).not.toContain(keys.extra)
    stale(changed.state, keys, plan, keys.a.operation, 0, freezeSequence, "k72-claim")
  })

  // I-33/K72 @ participant.observe; mutant: fail to advance the operation revision; red: the newer participant route is not +1 and its old plan can freeze.
  test("I-33 and K72 discard a plan after a participant revision changes", () => {
    const keys = kit("k72-participant")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const plan = begin(prove(prepared, keys.instance, keys.a.operation), keys.instance, keys.a.operation)
    const revision = operation(plan.state, keys.a.operation).revision
    const freezeSequence = SessionClosureModel.view(plan.state).sequences.freeze
    const changed = SessionClosureModel.step(plan.state, {
      type: "participant.observe",
      instance: keys.instance,
      operation: keys.a.operation,
      participant: keys.participant,
      revision: 1n,
    })
    expect(operation(changed.state, keys.a.operation).participants).toContainEqual({
      id: keys.participant,
      revision: 1n,
    })
    expect(operation(changed.state, keys.a.operation).revision).toBe(revision + 1n)
    expect(plan.read.capture.participants).not.toContainEqual({ id: keys.participant, revision: 1n })
    stale(changed.state, keys, plan, keys.a.operation, 0, freezeSequence, "k72-participant")
  })

  // I-33/K72 @ lease.reserve; mutant: fail to advance the operation revision; red: the adopted-lease route is not +1 and its old plan can freeze.
  test("I-33 and K72 discard a plan after its lease set changes", () => {
    const keys = kit("k72-lease")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const plan = begin(prove(prepared, keys.instance, keys.a.operation), keys.instance, keys.a.operation)
    const revision = operation(plan.state, keys.a.operation).revision
    const freezeSequence = SessionClosureModel.view(plan.state).sequences.freeze
    const changed = SessionClosureModel.step(plan.state, {
      type: "lease.reserve",
      instance: keys.instance,
      lease: {
        id: keys.lease,
        session: keys.rootA,
        epoch: 0n,
        source: "explicit external admission",
        origin: "external",
        retry: "initial",
        kind: "ordinary",
        owner: { type: "scope", id: keys.scope },
      },
    })
    expect(operation(changed.state, keys.a.operation).executionLeases).toContain(keys.lease)
    expect(operation(changed.state, keys.a.operation).revision).toBe(revision + 1n)
    expect(plan.read.capture.leases).not.toContain(keys.lease)
    stale(changed.state, keys, plan, keys.a.operation, 0, freezeSequence, "k72-lease")
  })

  // I-33/K72 @ late-intersection aliasing; mutant: fail to advance the canonical operation revision; red: merge is not +1 and its old plan can freeze.
  test("I-33 and K72 discard a plan after a late intersection adds an alias", () => {
    const keys = kit("k72-alias")
    const startedA = boot(initial(keys), keys.instance, keys.rootA, keys.a)
    const claimedA = settle(
      claim(
        startedA,
        keys.instance,
        keys.a.operation,
        [connected(keys.rootA, keys.shared, keys.edgeA)],
        [keys.signalA],
      ),
    )
    const requiredA = require(claimedA, keys.instance, keys.a.operation, keys.a.view, [keys.rootA, keys.shared], facts(
      keys,
      keys.rootA,
    ))
    const stableA = prove(requiredA, keys.instance, keys.a.operation)
    const startedB = boot(stableA, keys.instance, keys.rootB, keys.b)
    const claimedB = settle(
      claim(startedB, keys.instance, keys.b.operation, [connected(keys.rootB, keys.rootB, keys.edgeB)], [keys.signalB]),
    )
    const plan = begin(claimedB, keys.instance, keys.a.operation)
    const revision = operation(plan.state, keys.a.operation).revision
    const freezeSequence = SessionClosureModel.view(plan.state).sequences.freeze
    const changed = claim(
      plan.state,
      keys.instance,
      keys.b.operation,
      [connected(keys.rootB, keys.shared, keys.edgeB)],
      [keys.signalC],
    )
    expect(SessionClosureModel.view(changed.state).aliases).toContainEqual({
      alias: keys.b.operation,
      canonical: keys.a.operation,
    })
    expect(operation(changed.state, keys.a.operation).revision).toBe(revision + 1n)
    expect(plan.read.capture.aliases).not.toContain(keys.b.operation)
    stale(changed.state, keys, plan, keys.a.operation, 0, freezeSequence, "k72-alias")
  })

  // I-33/K72 @ view.require fact addition; mutant: fail to advance the operation revision; red: the fact route is not +1 and its old plan can freeze.
  test("I-33 and K72 discard a plan after its required facts change", () => {
    const keys = kit("k72-fact")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const plan = begin(prove(prepared, keys.instance, keys.a.operation), keys.instance, keys.a.operation)
    const count = operation(plan.state, keys.a.operation).facts.length
    const revision = operation(plan.state, keys.a.operation).revision
    const freezeSequence = SessionClosureModel.view(plan.state).sequences.freeze
    const changed = SessionClosureModel.step(plan.state, {
      type: "view.require",
      instance: keys.instance,
      operation: keys.a.operation,
      view: keys.a.view,
      nodes: [keys.rootA, keys.extra],
      facts: [{ type: "self", subject: keys.extra, outcome: "unknown", yielded: false }],
    })
    expect(operation(changed.state, keys.a.operation).facts).toHaveLength(count + 1)
    expect(operation(changed.state, keys.a.operation).revision).toBe(revision + 1n)
    expect(plan.read.capture.facts).toHaveLength(count)
    stale(changed.state, keys, plan, keys.a.operation, 0, freezeSequence, "k72-fact")
  })

  // I-33/K72 @ successor fact addition; mutant: fail to advance the operation revision; red: the successor route is not +1 and its old plan can freeze.
  test("I-33 and K72 discard a successor plan after the successor set changes", () => {
    const keys = kit("k72-successor")
    const prepared = complete(keys)
    const linked = connect(prepared.state, keys)
    const merged = settle(linked)
    const stable = prove(merged, keys.instance, keys.a.operation)
    const plan = begin(stable, keys.instance, keys.a.operation)
    expect(plan.read.capture.successors.length).toBeGreaterThan(0)
    const count = plan.read.capture.successors.length
    const revision = operation(plan.state, keys.a.operation).revision
    const freezeSequence = SessionClosureModel.view(plan.state).sequences.freeze
    const changed = SessionClosureModel.step(plan.state, {
      type: "view.require",
      instance: keys.instance,
      operation: keys.a.operation,
      view: keys.a.view,
      nodes: [keys.rootA, keys.shared, keys.extra],
      facts: [{ type: "self", subject: keys.extra, outcome: "error", yielded: true }],
    })
    expect(operation(changed.state, keys.a.operation).successors.length).toBeGreaterThan(count)
    expect(operation(changed.state, keys.a.operation).revision).toBe(revision + 1n)
    stale(changed.state, keys, plan, keys.a.operation, 1, freezeSequence, "k72-successor")
  })

  // I-35 @ planning.return; mutant: synthesize default identity; red: a generation or coordinate is allocated without a validated source.
  test("I-35 fails before freeze when every identity source is absent", () => {
    const keys = kit("i35-missing")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const plan = begin(prove(prepared, keys.instance, keys.a.operation), keys.instance, keys.a.operation)
    const before = SessionClosureModel.view(plan.state).sequences.freeze
    const result = SessionClosureModel.step(plan.state, {
      type: "planning.return",
      instance: keys.instance,
      read: plan.read,
      identities: plan.read.targets.map((session) => ({ session })),
      seed: seed(planned(plan.read), "i35-missing"),
    })

    expect(result.decision).toEqual({ type: "rejected", reason: "missing_identity" })
    expect(operation(result.state, keys.a.operation).phase).toEqual({ type: "planning_failed_identity_missing" })
    expect(operation(result.state, keys.a.operation).generations).toHaveLength(0)
    expect(SessionClosureModel.view(result.state).sequences.freeze).toBe(before)
  })

  // I-35 @ planning.return; mutant: reject or default a valid resume identity; red: the generation lacks the exact resume identity and variant.
  test("I-35 freezes an explicit resume-admission identity without inventing a source message", () => {
    const keys = kit("i35-resume")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const frozen = freeze(
      prove(prepared, keys.instance, keys.a.operation),
      keys.instance,
      keys.a.operation,
      "i35-resume",
      "resume_admission",
    )
    expect(frozen.generation.records.length).toBeGreaterThan(0)
    for (const record of frozen.generation.records) {
      expect(record.identity).toEqual({
        source: "resume_admission",
        agent: "test-agent",
        model: {
          providerID: "test-provider",
          modelID: "test-model",
          variant: { present: true, value: "test-variant" },
        },
      })
      expect(record.metadata.identity_source).toBe("resume_admission")
      expect("source_user_message_id" in record.metadata).toBe(false)
    }
  })

  // I-34/K74 @ frozen normalization; mutant: include root insertion identity/order in shared facts; red: proven-divergent insertion orders produce different shared bytes.
  test("I-34 and K74 keep shared facts root-neutral across genuinely different root insertion orders", () => {
    const keysFirst = kit("k74-held")
    const first = ordered(keysFirst, keysFirst.a, keysFirst.rootA, keysFirst.b, keysFirst.rootB)
    expect(first.creation).toEqual([keysFirst.rootA, keysFirst.rootB])
    const frozenFirst = fixedfreeze(first.state, keysFirst.a.operation, keysFirst, "k74-held")

    const keysSecond = kit("k74-held")
    const second = ordered(keysSecond, keysSecond.a, keysSecond.rootB, keysSecond.b, keysSecond.rootA)
    expect(second.creation).toEqual([keysSecond.rootB, keysSecond.rootA])
    expect(second.creation).not.toEqual(first.creation)
    const frozenSecond = fixedfreeze(second.state, keysSecond.a.operation, keysSecond, "k74-held")

    const sharedFirst = frozenFirst.generation.records
      .filter((item) => item.metadata.record_kind !== "root")
      .map((item) => ({
        fact: item.fact,
        metadata: item.metadata,
        text: item.text,
        messageTime: item.messageTime,
        partTime: item.partTime,
        messageBytes: item.messageBytes,
        partBytes: item.partBytes,
      }))
    const sharedSecond = frozenSecond.generation.records
      .filter((item) => item.metadata.record_kind !== "root")
      .map((item) => ({
        fact: item.fact,
        metadata: item.metadata,
        text: item.text,
        messageTime: item.messageTime,
        partTime: item.partTime,
        messageBytes: item.messageBytes,
        partBytes: item.partBytes,
      }))
    expect(sharedFirst).toHaveLength(3)
    expect(sharedSecond).toEqual(sharedFirst)
    expect(sharedFirst.every((item) => !("requested_root_session_id" in item.metadata))).toBe(true)

    const roots = frozenFirst.generation.records.filter((item) => item.metadata.record_kind === "root")
    expect(roots).toHaveLength(2)
    expect(new Set(roots.map((item) => item.fact.id)).size).toBe(2)
    expect(new Set(roots.map((item) => item.fact.key)).size).toBe(2)
    expect(
      roots.map((item) => (item.metadata.record_kind === "root" ? item.metadata.requested_root_session_id : undefined)),
    ).toEqual([keysFirst.rootA, keysFirst.rootB])
  })

  // I-13/I-34/K43 | boundary: normalized facts and generation freeze | mutant: append each edge before walking its child; red: explicit depth-three postorder changes to preorder.
  test("K43 freezes multilevel branch facts in deterministic descendant-first postorder", () => {
    const keys = kit("k43-postorder")
    const child = keys.shared
    const grandchild = keys.extra
    const leaf = key("session", "k43-postorder:leaf")
    const state = initial(keys, [leaf])
    const started = boot(state, keys.instance, keys.rootA, keys.a)
    const claimed = claim(
      started,
      keys.instance,
      keys.a.operation,
      [
        {
          value: "proven_connected",
          root: keys.rootA,
          active: leaf,
          path: [keys.rootA, child, grandchild, leaf],
          edges: [
            { id: keys.edgeA, owner: keys.rootA, child },
            { id: keys.edgeB, owner: child, child: grandchild },
            { id: keys.edgeExtra, owner: grandchild, child: leaf },
          ],
        },
      ],
      [keys.signalA],
    )
    const signalled = settle(claimed)
    const required = require(signalled, keys.instance, keys.a.operation, keys.a.view, [
      keys.rootA,
      child,
      grandchild,
      leaf,
    ], [
      { type: "root", root: keys.rootA },
      { type: "self", subject: keys.rootA, outcome: "completed", yielded: false },
      {
        type: "edge",
        subject: child,
        owner: keys.rootA,
        child,
        edge: keys.edgeA,
        outcome: "completed",
        yielded: false,
      },
      { type: "self", subject: child, outcome: "completed", yielded: false },
      {
        type: "edge",
        subject: grandchild,
        owner: child,
        child: grandchild,
        edge: keys.edgeB,
        outcome: "completed",
        yielded: false,
      },
      { type: "self", subject: grandchild, outcome: "completed", yielded: false },
      {
        type: "edge",
        subject: leaf,
        owner: grandchild,
        child: leaf,
        edge: keys.edgeExtra,
        outcome: "completed",
        yielded: false,
      },
      { type: "self", subject: leaf, outcome: "completed", yielded: false },
    ])
    const label = (fact: SessionClosureModel.FactView) => {
      if (fact.type === "self") return `self:${fact.subject}`
      if (fact.type === "edge") return `edge:${fact.owner}->${fact.child}`
      return `root:${fact.root}`
    }
    const expected = [
      `self:${leaf}`,
      `edge:${grandchild}->${leaf}`,
      `self:${grandchild}`,
      `edge:${child}->${grandchild}`,
      `self:${child}`,
      `edge:${keys.rootA}->${child}`,
      `self:${keys.rootA}`,
      `root:${keys.rootA}`,
    ]
    const normalized = operation(required, keys.a.operation).facts
    expect(normalized).toHaveLength(8)
    expect(normalized.map(label)).toEqual(expected)

    const frozen = freeze(
      prove(required, keys.instance, keys.a.operation),
      keys.instance,
      keys.a.operation,
      "k43-postorder",
    )
    expect(frozen.generation.facts).toEqual(normalized.map((item) => item.id))
    expect(frozen.generation.records).toHaveLength(8)
    expect(frozen.generation.records.map((item) => label(item.fact))).toEqual(expected)
  })

  // C / K43 @ sortfacts -> record ordinal; mutant: reverse sibling child order; red: independently
  // stated postorder labels and their base+2i Message times both change.
  test("K43 assigns times by the stated multi-branch postorder, including stable Task-Part edge order", () => {
    const keys = kit("k43-order-times")
    const middle = keys.shared
    const childA = key("session", "k43-order-times:child-a")
    const childB = key("session", "k43-order-times:child-b")
    const edgeRoot = keys.edgeA
    const edgeA1 = keys.edgeB
    const edgeA2 = keys.edgeExtra
    const edgeB = key("edge", "k43-order-times:edge-b")
    const partRoot = key("part", "k43-order-times:part-root")
    const partA1 = key("part", "k43-order-times:part-a1")
    const partA2 = key("part", "k43-order-times:part-a2")
    const partB = key("part", "k43-order-times:part-b")

    const started = boot(initial(keys, [childA, childB]), keys.instance, keys.rootA, keys.a)
    const claimed = claim(
      started,
      keys.instance,
      keys.a.operation,
      [
        // Intentionally B before A. The expected order below comes from §10.2, not this input order.
        {
          value: "proven_connected",
          root: keys.rootA,
          active: childB,
          path: [keys.rootA, middle, childB],
          edges: [
            { id: edgeRoot, owner: keys.rootA, child: middle },
            { id: edgeB, owner: middle, child: childB },
          ],
        },
        {
          value: "proven_connected",
          root: keys.rootA,
          active: childA,
          path: [keys.rootA, middle, childA],
          edges: [
            { id: edgeRoot, owner: keys.rootA, child: middle },
            { id: edgeA2, owner: middle, child: childA },
          ],
        },
        // A second structural edge to the same child with a distinct Task Part. This pure-model
        // discriminator exercises §10.2's secondary key; it does not claim the current Task registry
        // can register concurrent jobs for one child.
        {
          value: "proven_connected",
          root: keys.rootA,
          active: childA,
          path: [keys.rootA, middle, childA],
          edges: [
            { id: edgeRoot, owner: keys.rootA, child: middle },
            { id: edgeA1, owner: middle, child: childA },
          ],
        },
      ],
      // Two ACTIVE Sessions, even though child A has two distinct Task edges.
      [keys.signalA, keys.signalB],
    )
    const signalled = settle(claimed)
    const required = require(signalled, keys.instance, keys.a.operation, keys.a.view, [
      keys.rootA,
      middle,
      childA,
      childB,
    ], [
      // Deliberately scrambled. `sortfacts`, not fixture accumulation, owns the freeze order.
      { type: "root", root: keys.rootA },
      { type: "self", subject: childB, outcome: "completed", yielded: false },
      {
        type: "edge",
        subject: middle,
        owner: middle,
        child: childB,
        edge: edgeB,
        taskPart: partB,
        outcome: "completed",
        yielded: false,
      },
      {
        type: "edge",
        subject: middle,
        owner: middle,
        child: childA,
        edge: edgeA2,
        taskPart: partA2,
        outcome: "completed",
        yielded: false,
      },
      { type: "self", subject: middle, outcome: "completed", yielded: false },
      {
        type: "edge",
        subject: keys.rootA,
        owner: keys.rootA,
        child: middle,
        edge: edgeRoot,
        taskPart: partRoot,
        outcome: "completed",
        yielded: false,
      },
      { type: "self", subject: childA, outcome: "completed", yielded: false },
      {
        type: "edge",
        subject: middle,
        owner: middle,
        child: childA,
        edge: edgeA1,
        taskPart: partA1,
        outcome: "completed",
        yielded: false,
      },
    ])
    const stable = prove(required, keys.instance, keys.a.operation)
    const frozen = freeze(
      stable,
      keys.instance,
      keys.a.operation,
      "k43-order-times",
      "prior_user_message",
      seed(
        operation(stable, keys.a.operation).facts.map((fact) => fact.id),
        "k43-order-times",
        10_000,
        0,
      ),
    )
    const label = (fact: SessionClosureModel.FactView) => {
      if (fact.type === "self") return `self:${fact.subject}`
      if (fact.type === "root") return `root:${fact.root}`
      return `edge:${fact.owner}->${fact.child}:${fact.taskPart ?? fact.edge}`
    }

    /**
     * Computed directly from §10.2's rule, not from `sortfacts` or a model projection:
     * descendant-first; sibling child A before child B; A's parallel edges by Task Part; every child
     * edge before its owner middle's self record; root edge after the whole middle subtree; root last.
     */
    const expectedPostorder = [
      `self:${childA}`,
      `edge:${middle}->${childA}:${partA1}`,
      `edge:${middle}->${childA}:${partA2}`,
      `self:${childB}`,
      `edge:${middle}->${childB}:${partB}`,
      `self:${middle}`,
      `edge:${keys.rootA}->${middle}:${partRoot}`,
      `root:${keys.rootA}`,
    ]
    expect(frozen.generation.records).toHaveLength(expectedPostorder.length)
    expect(frozen.generation.records.map((record) => label(record.fact))).toEqual(expectedPostorder)
    expectedPostorder.forEach((expected, index) => {
      const record = frozen.generation.records.find((item) => label(item.fact) === expected)
      if (!record) throw new Error(`missing expected postorder record ${expected}`)
      expect(record.messageTime).toBe(10_000 + 2 * index)
      expect(record.partTime).toBe(10_000 + 2 * index + 1)
    })
  })

  /**
   * §9.5 made executable, and the reason §10.2's two stated sibling keys are not a total order.
   *
   * When the authoritative Task Part ID is unavailable or weaker than the invocation it names, §9.5
   * REQUIRES two proven distinct Task invocations to stay distinct facts rather than merge on the
   * weaker coordinate. Such a pair differs in `edge` while agreeing on child AND on `taskPart` —
   * which are exactly §10.2's two stated keys. With no further key the comparator returns 0, the
   * stable sort preserves arrival order, and the frozen bytes I-17's exact retry reuses become a
   * property of how the facts happened to accumulate. That is failure mode 2 in a different guise.
   *
   * The two halves below are identical in every respect except the order the facts are handed to
   * `view.require`, and both run the same kit name so the operation — and therefore every fact ID —
   * is identical. An identical frozen order is therefore evidence about the comparator rather than
   * about the fixture.
   */
  test("I-17, K43 and §9.5 order edges tying on §10.2's stated keys by fact ID, not by arrival", () => {
    const name = "tiebreak-order"
    const keys = kit(name)
    const middle = keys.shared
    const child = key("session", `${name}:child`)
    const edgeRoot = keys.edgeA
    // Equal-length IDs, so the tie-break reduces to a plainly stated lexicographic comparison.
    const edgeOne = key("edge", `${name}:edge-1`)
    const edgeTwo = key("edge", `${name}:edge-2`)
    const partRoot = key("part", `${name}:part-root`)
    // ONE Part coordinate carried by BOTH invocations — §9.5's weaker-coordinate case.
    const partShared = key("part", `${name}:part-shared`)

    const tied = (edge: SessionClosureModel.EdgeID): SessionClosureModel.FactInput => ({
      type: "edge",
      subject: middle,
      owner: middle,
      child,
      edge,
      taskPart: partShared,
      outcome: "cancelled",
      yielded: false,
    })
    const rest: readonly SessionClosureModel.FactInput[] = [
      { type: "self", subject: child, outcome: "cancelled", yielded: false },
      { type: "self", subject: middle, outcome: "cancelled", yielded: false },
      {
        type: "edge",
        subject: keys.rootA,
        owner: keys.rootA,
        child: middle,
        edge: edgeRoot,
        taskPart: partRoot,
        outcome: "cancelled",
        yielded: false,
      },
      { type: "root", root: keys.rootA },
    ]
    const arm = (edge: SessionClosureModel.EdgeID): SessionClosureModel.ProofInput => ({
      value: "proven_connected",
      root: keys.rootA,
      active: child,
      path: [keys.rootA, middle, child],
      edges: [
        { id: edgeRoot, owner: keys.rootA, child: middle },
        { id: edge, owner: middle, child },
      ],
    })

    const run = (required: readonly SessionClosureModel.FactInput[]): Frozen => {
      const started = boot(initial(keys, [child]), keys.instance, keys.rootA, keys.a)
      const claimed = claim(started, keys.instance, keys.a.operation, [arm(edgeOne), arm(edgeTwo)], [keys.signalA])
      const asked = require(settle(claimed), keys.instance, keys.a.operation, keys.a.view, [
        keys.rootA,
        middle,
        child,
      ], required)
      return freeze(prove(asked, keys.instance, keys.a.operation), keys.instance, keys.a.operation, name)
    }

    const forward = run([tied(edgeOne), tied(edgeTwo), ...rest])
    const reverse = run([...[...rest].toReversed(), tied(edgeTwo), tied(edgeOne)])

    const label = (fact: SessionClosureModel.FactView) => {
      if (fact.type === "self") return `self:${fact.subject}`
      if (fact.type === "root") return `root:${fact.root}`
      return `edge:${fact.child}:${fact.taskPart}:${fact.edge}`
    }
    const siblings = (result: Frozen) =>
      result.generation.records
        .map((item) => item.fact)
        .filter(
          (item): item is Extract<SessionClosureModel.FactView, { readonly type: "edge" }> =>
            item.type === "edge" && item.child === child,
        )

    /**
     * Positive precondition. If the pair did not genuinely agree on both stated keys the comparator
     * would never fall through to the tie-break, and everything below would restate §10.2's ordinary
     * secondary-key behavior instead of the case that has no stated key at all.
     */
    const pair = siblings(forward)
    expect(pair).toHaveLength(2)
    expect(pair[0]!.child).toBe(pair[1]!.child)
    expect(pair[0]!.taskPart).toBe(pair[1]!.taskPart)
    expect(pair[0]!.edge).not.toBe(pair[1]!.edge)

    // The property: arrival order does not reach the frozen record order.
    expect(reverse.generation.records.map((item) => label(item.fact))).toEqual(
      forward.generation.records.map((item) => label(item.fact)),
    )
    // And the shared order is the stated one, so a later change that flips it is visible rather than merely different.
    expect(siblings(reverse).map((item) => item.edge)).toEqual([edgeOne, edgeTwo])
    expect(forward.generation.records.map((item) => label(item.fact))).toEqual([
      `self:${child}`,
      `edge:${child}:${partShared}:${edgeOne}`,
      `edge:${child}:${partShared}:${edgeTwo}`,
      `self:${middle}`,
      `edge:${middle}:${partRoot}:${edgeRoot}`,
      `root:${keys.rootA}`,
    ])
    // Frozen times follow the same order, which is what I-17's exact retry reuses.
    expect(forward.generation.records.map((item) => item.messageTime)).toEqual(
      reverse.generation.records.map((item) => item.messageTime),
    )
  })

  // I-15/K75 @ operation.claim in recording; mutant: reject claims through a generalized recording-phase guard; red: claim is invalid_transition and no alias installs.
  test("I-15 and K75 admit a late intersecting claim while the loser is recording", () => {
    const keys = kit("recording-claim")
    const prepared = complete(keys)
    expect(operation(prepared.state, keys.b.operation).phase).toEqual({ type: "recording", generation: 1 })

    const linked = connect(prepared.state, keys)
    expect(linked.decision).not.toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(["applied", "joined"]).toContain(linked.decision.type)
    expect(SessionClosureModel.view(linked.state).aliases).toContainEqual({
      alias: keys.b.operation,
      canonical: keys.a.operation,
    })
  })

  // I-16/K73(a) @ pair.issue; mutant: treat candidate eligibility as authority; red: a pre-merge loser candidate starts a pair after merge.
  test("I-16 and K73 reject a loser candidate whose permit was not issued before merge", () => {
    const keys = kit("k73-before")
    const prepared = late(keys)
    expect(prepared.predecessor.records.length).toBeGreaterThan(1)
    expect(prepared.candidate.fact).toBe(prepared.predecessor.facts[0])
    expect(SessionClosureModel.view(prepared.state).pairs).toHaveLength(0)

    const linked = connect(prepared.state, keys)
    expect(SessionClosureModel.view(linked.state).aliases).toContainEqual({
      alias: keys.b.operation,
      canonical: keys.a.operation,
    })
    const issued = SessionClosureModel.step(linked.state, {
      type: "pair.issue",
      instance: keys.instance,
      candidate: prepared.candidate,
      permit: keys.pairA,
    })
    expect(issued.decision.type).toBe("rejected")
    expect(issued.commands.some((item) => item.type === "pair.write")).toBe(false)
    expect(SessionClosureModel.view(issued.state).pairs).toHaveLength(0)
  })

  // I-16/K73(b) @ pair.return; mutant: revoke an already-issued losing permit during merge; red: the exact pair cannot finish/import.
  test("I-16 and K73 import the one losing pair permitted before merge", () => {
    const keys = kit("k73-import")
    const prepared = late(keys)
    const issued = SessionClosureModel.step(prepared.state, {
      type: "pair.issue",
      instance: keys.instance,
      candidate: prepared.candidate,
      permit: keys.pairA,
    })
    const write = command(issued, "pair.write")
    expect(SessionClosureModel.view(issued.state).pairs).toContainEqual(
      expect.objectContaining({ id: keys.pairA, state: "in_flight" }),
    )

    const linked = connect(issued.state, keys)
    const returned = SessionClosureModel.step(linked.state, {
      type: "pair.return",
      instance: keys.instance,
      write,
      message: "verified",
      part: "verified",
    })
    const imported = generation(returned.state, keys.a.operation, keys.b.operation, 1)
    expect(imported.committedPrefix).toBe(1)
    expect(imported.verified).toContain(prepared.candidate.fact)
    expect(SessionClosureModel.view(returned.state).pairs).toContainEqual(
      expect.objectContaining({ id: keys.pairA, state: "imported" }),
    )
  })

  // I-16/K73(b) @ loser writer.next; mutant: allow an imported loser pair to authorize another write; red: a second candidate is emitted.
  test("I-16 and K73 give an imported loser no follow-on writer authority", () => {
    const keys = kit("k73-follow-on")
    const prepared = late(keys)
    const issued = SessionClosureModel.step(prepared.state, {
      type: "pair.issue",
      instance: keys.instance,
      candidate: prepared.candidate,
      permit: keys.pairA,
    })
    const write = command(issued, "pair.write")
    const linked = connect(issued.state, keys)
    const returned = SessionClosureModel.step(linked.state, {
      type: "pair.return",
      instance: keys.instance,
      write,
      message: "verified",
      part: "verified",
    })
    const imported = generation(returned.state, keys.a.operation, keys.b.operation, 1)
    expect(imported.records.length).toBeGreaterThan(imported.committedPrefix)

    const next = SessionClosureModel.step(returned.state, {
      type: "writer.next",
      instance: keys.instance,
      operation: keys.b.operation,
    })
    expect(next.commands.some((item) => item.type === "pair.candidate")).toBe(false)
    expect(next.decision).toEqual({ type: "noop", reason: "stale" })
  })

  // I-18 @ pair.return; mutant: treat Message-only/Part-absent as complete; red: prefix or verified facts advance.
  test("I-18 retains record failure without prefix advance when the Part is absent", () => {
    const keys = kit("i18-absent")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const frozen = freeze(
      prove(prepared, keys.instance, keys.a.operation),
      keys.instance,
      keys.a.operation,
      "i18-absent",
    )
    const pair = issued(frozen.state, keys, keys.a.operation, keys.pairA)
    const returned = SessionClosureModel.step(pair.state, {
      type: "pair.return",
      instance: keys.instance,
      write: pair.write,
      message: "verified",
      part: "absent",
    })
    const failed = generation(returned.state, keys.a.operation, keys.a.operation, 1)
    expect(failed.committedPrefix).toBe(0)
    expect(failed.verified).toHaveLength(0)
    expect(failed.failure).toBe("record_failed")
    expect(operation(returned.state, keys.a.operation).phase).toEqual({ type: "record_failed" })
  })

  // I-18 @ pair.return; mutant: treat Message-only/Part-failed as complete; red: prefix or verified facts advance.
  test("I-18 retains record failure without prefix advance when the Part fails", () => {
    const keys = kit("i18-failed")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const frozen = freeze(
      prove(prepared, keys.instance, keys.a.operation),
      keys.instance,
      keys.a.operation,
      "i18-failed",
    )
    const pair = issued(frozen.state, keys, keys.a.operation, keys.pairA)
    const returned = SessionClosureModel.step(pair.state, {
      type: "pair.return",
      instance: keys.instance,
      write: pair.write,
      message: "verified",
      part: "failed",
    })
    const failed = generation(returned.state, keys.a.operation, keys.a.operation, 1)
    expect(failed.committedPrefix).toBe(0)
    expect(failed.verified).toHaveLength(0)
    expect(failed.failure).toBe("record_failed")
  })

  // I-18 @ pair.return; mutant: require only one verified half or advance by more than one; red: exact one-pair prefix/verification differs.
  test("I-18 advances exactly one prefix only after both Message and Part verify", () => {
    const keys = kit("i18-complete")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA }],
    )
    const frozen = freeze(
      prove(prepared, keys.instance, keys.a.operation),
      keys.instance,
      keys.a.operation,
      "i18-complete",
    )
    const pair = issued(frozen.state, keys, keys.a.operation, keys.pairA)
    const returned = SessionClosureModel.step(pair.state, {
      type: "pair.return",
      instance: keys.instance,
      write: pair.write,
      message: "verified",
      part: "verified",
    })
    const verified = generation(returned.state, keys.a.operation, keys.a.operation, 1)
    expect(verified.committedPrefix).toBe(1)
    expect(verified.verified).toEqual([pair.candidate.fact])
    expect(verified.failure).toBeUndefined()
  })

  // A / I-15/I-17 @ every reachable post-freeze transition; mutant: rewrite one frozen time while
  // issuing the first pair; red: the explicit immutable-record projection changes immediately.
  test("I-15 and I-17 keep every frozen coordinate, byte, time, text, and metadata field immutable", () => {
    const keys = kit("i17")
    const prepared = branch(
      keys,
      keys.a,
      keys.rootA,
      keys.rootA,
      keys.edgeA,
      keys.signalA,
      [keys.rootA],
      [{ type: "root", root: keys.rootA, direct: { outcome: "error", yielded: true } }],
    )
    const frozen = freeze(prove(prepared, keys.instance, keys.a.operation), keys.instance, keys.a.operation, "i17")
    // Captured IMMEDIATELY after freeze, before any writer transition. Progress fields are excluded
    // deliberately; they must evolve, while this payload never may.
    const snapshot = frozenRecords(frozen.generation)
    expect(snapshot).toHaveLength(1)

    const pair = issued(frozen.state, keys, keys.a.operation, keys.pairA)
    expect(frozenRecords(generation(pair.state, keys.a.operation, keys.a.operation, 1))).toEqual(snapshot)
    const failed = SessionClosureModel.step(pair.state, {
      type: "pair.return",
      instance: keys.instance,
      write: pair.write,
      message: "verified",
      part: "absent",
    })
    expect(frozenRecords(generation(failed.state, keys.a.operation, keys.a.operation, 1))).toEqual(snapshot)

    const repaired = boot(failed.state, keys.instance, keys.rootA, keys.retry)
    expect(operation(repaired, keys.a.operation).phase).toEqual({ type: "record_failed" })
    expect(frozenRecords(generation(repaired, keys.a.operation, keys.a.operation, 1))).toEqual(snapshot)
    const resumed = SessionClosureModel.step(repaired, {
      type: "operation.advance",
      instance: keys.instance,
      operation: keys.a.operation,
      to: { type: "recording", generation: 1 },
    })
    expect(resumed.decision).toEqual({ type: "applied" })
    expect(operation(resumed.state, keys.a.operation).phase).toEqual({ type: "recording", generation: 1 })
    const recording = resumed.state
    expect(frozenRecords(generation(recording, keys.a.operation, keys.a.operation, 1))).toEqual(snapshot)

    const next = SessionClosureModel.step(recording, {
      type: "writer.next",
      instance: keys.instance,
      operation: keys.a.operation,
    })
    const candidate = command(next, "pair.candidate")
    expect(candidate.fact).toBe(pair.candidate.fact)
    expect(candidate.expectedPrefix).toBe(pair.candidate.expectedPrefix)
    expect(frozenRecords(generation(next.state, keys.a.operation, keys.a.operation, 1))).toEqual(snapshot)
    const retry = SessionClosureModel.step(next.state, {
      type: "pair.issue",
      instance: keys.instance,
      candidate,
      permit: keys.pairB,
    })
    expect(command(retry, "pair.write").candidate.fact).toBe(pair.candidate.fact)
    expect(frozenRecords(generation(retry.state, keys.a.operation, keys.a.operation, 1))).toEqual(snapshot)
  })

  // I-15/K75 @ post-freeze intersection; mutant: rewrite imported predecessor owner/bytes during aliasing; red: immediate predecessor equality fails.
  test("I-15 and K75 preserve the frozen predecessor immediately after a real late intersection", () => {
    const keys = kit("k75-merge")
    const prepared = complete(keys)
    expect(prepared.predecessor.freezeOwner).toBe(keys.b.operation)
    expect(prepared.predecessor.records.length).toBeGreaterThan(0)
    const snapshot = structuredClone(prepared.predecessor)

    const linked = connect(prepared.state, keys)
    expect(SessionClosureModel.view(linked.state).aliases).toContainEqual({
      alias: keys.b.operation,
      canonical: keys.a.operation,
    })
    const imported = generation(linked.state, keys.a.operation, keys.b.operation, 1)
    expect(imported).toEqual(snapshot)
    expect(imported.freezeOwner).toBe(keys.b.operation)
    expect(operation(linked.state, keys.a.operation).successors.length).toBeGreaterThan(0)
  })

  // I-15/I-34/K75 @ successor freeze; mutant: rebuild predecessor facts in N+1; red: successor overlaps N or lacks its own lineage.
  test("I-15, I-34, and K75 freeze only missing facts under successor lineage", () => {
    const keys = kit("k75-successor")
    const prepared = complete(keys)
    const snapshot = structuredClone(prepared.predecessor)
    const linked = connect(prepared.state, keys)
    const merged = settle(linked)
    const imported = generation(merged, keys.a.operation, keys.b.operation, 1)
    expect(imported).toEqual(snapshot)
    const missing = operation(merged, keys.a.operation).successors
    expect(missing.length).toBeGreaterThan(0)

    const stable = prove(merged, keys.instance, keys.a.operation)
    const successor = freeze(stable, keys.instance, keys.a.operation, "k75-successor")
    expect(successor.generation.freezeOwner).toBe(keys.a.operation)
    expect(successor.generation.generation).toBe(2)
    expect(successor.generation.facts).toEqual(missing.map((item) => item.id))
    expect(successor.generation.facts.some((fact) => imported.facts.includes(fact))).toBe(false)
    expect(generation(successor.state, keys.a.operation, keys.b.operation, 1)).toEqual(snapshot)
  })
})

/**
 * CP-023 Gate 6 — §0.5's no-work release.
 *
 * "A missing Session or an idle request with no in-scope active work remains HTTP 200/`true` and
 * writes no record." An idle root proves quiescence with no active leaf beneath it, so `describe`
 * contributes no facts (`driver.ts:559` returns before root-fact construction).
 *
 * WHY THIS WAS UNREACHABLE UNTIL GATE 6. Every prior caller supplied facts by construction, and
 * until abort became a public fence producer nothing requested closure of a work-free session.
 *
 * WHAT MADE IT INVISIBLE. Every validation in `planningReturn` is a CORRESPONDENCE check —
 * `coordinates.length !== facts.length`, the set-size comparisons — and empty corresponds to empty,
 * so the empty case satisfies all of them and mints a generation with no referent.
 */
describe("session closure no-work release", () => {
  const nowork = () => {
    const keys = kit("no-work")
    const booted = boot(initial(keys), keys.instance, keys.rootA, keys.a)
    // The root proves itself in scope with NO edges beneath it: exactly what discovery reports for
    // an idle session, and what `describe` turns into zero facts.
    const claimed = settle(claim(booted, keys.instance, keys.a.operation, [connected(keys.rootA, keys.rootA, keys.edgeA)], []))
    const required = require(claimed, keys.instance, keys.a.operation, keys.a.view, [], [])
    const stable = prove(required, keys.instance, keys.a.operation)
    return { keys, plan: begin(stable, keys.instance, keys.a.operation) }
  }

  const returned = () => {
    const { keys, plan } = nowork()
    const result = SessionClosureModel.step(plan.state, {
      type: "planning.return",
      instance: keys.instance,
      read: plan.read,
      identities: identities(plan.read, "no-work"),
      seed: seed(planned(plan.read), "no-work"),
    })
    return { keys, result }
  }

  // §0.5/K29(a) @ planning.return with zero facts; mutant: mint a generation anyway; red: empty generation with no referent.
  test("§0.5 freezes no generation when the operation constructed no facts", () => {
    const { keys, result } = returned()
    expect(result.decision.type).toBe("applied")
    const current = operation(result.state, keys.a.operation)
    expect(current.facts).toEqual([])
    expect(current.generations).toEqual([])
  })

  // §0.5 @ the generation-free representation; mutant: fabricate generation 0; red: a phase carrying a number with nothing to point at.
  test("§0.5 records the no-work phase without a generation referent", () => {
    const { keys, result } = returned()
    const phase = operation(result.state, keys.a.operation).phase
    expect(phase.type).toBe("recording")
    expect((phase as { readonly generation?: number }).generation).toBeUndefined()
  })

  // §0.5 @ the normal release path; mutant: require a generation to release; red: release.prepare rejected, so an idle abort never releases its fence or advances the epoch.
  test("§0.5 releases a no-work operation through the ordinary release path", () => {
    const { keys, result } = returned()
    const prepared = SessionClosureModel.step(result.state, {
      type: "release.prepare",
      instance: keys.instance,
      operation: keys.a.operation,
    })
    expect(prepared.decision.type).toBe("applied")
  })

  // §0.5 @ writer.next with no generation; mutant: emit a pair candidate; red: an invalid_transition rejection instead of an honest settled no-op.
  test("§0.5 leaves the writer nothing to offer for a generation-free recording", () => {
    const { keys, result } = returned()
    const next = SessionClosureModel.step(result.state, {
      type: "writer.next",
      instance: keys.instance,
      operation: keys.a.operation,
    })
    expect(next.commands.some((item) => item.type === "pair.candidate")).toBe(false)
    expect(next.decision).toEqual({ type: "noop", reason: "settled" })
  })
})
