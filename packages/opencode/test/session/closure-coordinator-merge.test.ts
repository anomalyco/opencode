import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Deferred, Effect, Fiber, Layer, Queue } from "effect"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionID } from "@/session/schema"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { itBounded as it } from "../lib/effect"

type HeldRun = { readonly input: Ports.DriverRun; readonly release: Deferred.Deferred<void> }
type PairControl = { hold: boolean; readonly writes: Queue.Queue<Ports.DriverCommand> }
type Started = {
  readonly root: SessionID
  readonly session: Model.SessionID
  readonly operation: Model.OperationID
  readonly view: Model.ViewID
  readonly request: Fiber.Fiber<SessionClosure.Outcome, SessionClosure.Failure | Ports.LocationError>
  readonly run: HeldRun
}

const runState: Ports.RunStateCapability = {
  assertNotBusy: () => Effect.void,
  cancel: () => Effect.void,
}

const driver = (runs: Queue.Queue<HeldRun>, pair?: PairControl): Ports.Driver => ({
  run: (input) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      yield* Queue.offer(runs, { input, release })
      yield* Deferred.await(release)
    }),
  command: (input) => {
    if (input.command.type !== "pair.write") return Effect.void
    if (pair?.hold) return Queue.offer(pair.writes, input).pipe(Effect.asVoid)
    return input.control
      .transition({ type: "pair.return", write: input.command, message: "verified", part: "verified" })
      .pipe(Effect.orDie, Effect.asVoid)
  },
})

const defectingDriver = (runs: Queue.Queue<HeldRun>): Ports.Driver => ({
  run: (input) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      yield* Queue.offer(runs, { input, release })
      yield* Deferred.await(release)
      return yield* Effect.die(new Error("injected Gate 2 worker defect"))
    }),
  command: () => Effect.void,
})

const services = Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)

const withClosure = <A, E, R>(
  ports: Ports.RuntimePorts,
  body: (directory: string) => Effect.Effect<A, E, R | SessionClosure.Service>,
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const layer = SessionClosure.layer.pipe(
      Layer.provide(SessionToolPartPermit.layer),
      Layer.provide(Ports.makeLayer(() => Effect.succeed(ports))),
    )
    return yield* body(directory).pipe(Effect.provide(layer), provideInstanceEffect(directory))
  }).pipe(Effect.provide(services))

const command = <T extends Model.Command["type"]>(step: Model.Step, type: T) => {
  const found = step.commands.find((item): item is Extract<Model.Command, { readonly type: T }> => item.type === type)
  if (!found) throw new Error(`Missing SessionClosure command: ${type}`)
  return found
}

const operation = (view: Model.View, operationID: Model.OperationID) => {
  const current = view.operations.find((item) => item.id === operationID)
  if (!current) throw new Error(`Missing SessionClosure operation: ${operationID}`)
  return current
}

const identity = (label: string): Model.Identity => ({
  source: "session_identity",
  agent: `gate2-${label}`,
  model: { providerID: "gate2", modelID: "fake", variant: { present: false } },
})

const start = (closure: SessionClosure.Interface, runs: Queue.Queue<HeldRun>, root: SessionID) =>
  Effect.gen(function* () {
    const pending = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
    const run = yield* Queue.take(runs)
    const currentView = yield* closure.view
    const current = operation(currentView, run.input.command.operation)
    const rootView = current.views.find((item) => item.root === Model.id("session", root))
    expect(current.driver.state).toBe("running")
    expect(current.driver.state === "running" && current.driver.gate).toBe("opened")
    if (!rootView) return yield* Effect.die(`Missing root view for ${root}`)
    return {
      root,
      session: Model.id("session", root),
      operation: current.id,
      view: rootView.id,
      request: pending,
      run,
    } satisfies Started
  })

const selfClaim = (started: Started) =>
  started.run.input.control.claim({
    operation: started.operation,
    proofs: [
      {
        value: "proven_connected",
        root: started.session,
        active: started.session,
        path: [started.session],
        edges: [],
      },
    ],
    signals: [Effect.succeed("success" as const)],
  })

const connect = (newer: Started, older: Started, label: string) =>
  newer.run.input.control.claim({
    operation: newer.operation,
    proofs: [
      {
        value: "proven_connected",
        root: newer.session,
        active: older.session,
        path: [newer.session, older.session],
        edges: [
          {
            id: Model.id("edge", `edge_${label}`),
            owner: newer.session,
            child: older.session,
          },
        ],
      },
    ],
    signals: [Effect.succeed("success" as const)],
  })

const requireRoot = (control: Ports.Control, started: Started) =>
  control.transition({
    type: "view.require",
    operation: started.operation,
    view: started.view,
    nodes: [started.session],
    facts: [{ type: "root", root: started.session, direct: { outcome: "cancelled", yielded: false } }],
  })

const freeze = (
  closure: SessionClosure.Interface,
  control: Ports.Control,
  operationID: Model.OperationID,
  label: string,
) =>
  Effect.gen(function* () {
    yield* control.transition({ type: "operation.advance", operation: operationID, to: { type: "fencing" } })
    yield* control.transition({ type: "operation.advance", operation: operationID, to: { type: "quiescing" } })
    const prior = yield* control.scan(operationID)
    const current = yield* control.scan(operationID)
    yield* control.transition({ type: "quiescence.prove", operation: operationID, prior, current })
    const begun = yield* control.transition({ type: "planning.begin", operation: operationID })
    const read = command(begun, "plan.read")
    const planned = operation(yield* closure.view, operationID)
    const seed: Model.FreezeSeed = {
      clockMillis: 1_000,
      highWaterMillis: 900,
      coordinates: planned.facts.map((fact, index) => ({
        fact: fact.id,
        message: Model.id("message", `msg_${label}_${index}`),
        part: Model.id("part", `prt_${label}_${index}`),
        messageEvent: Model.id("event", `evt_${label}_${index}_message`),
        partEvent: Model.id("event", `evt_${label}_${index}_part`),
      })),
    }
    const returned = yield* control.transition({
      type: "planning.return",
      read,
      identities: read.targets.map((session) => ({ session, identity: identity(label) })),
      seed,
    })
    expect(returned.decision.type).toBe("applied")
    const frozen = operation(yield* closure.view, operationID)
    expect(frozen.phase.type).toBe("recording")
    expect(frozen.generations.length).toBeGreaterThan(0)
    return frozen.generations[frozen.generations.length - 1] as Model.GenerationView
  })

const writeAll = (control: Ports.Control, operationID: Model.OperationID): Effect.Effect<void, Ports.LocationError> =>
  Effect.gen(function* () {
    const next = yield* control.transition({ type: "writer.next", operation: operationID })
    const candidate = next.commands.find(
      (item): item is Extract<Model.Command, { readonly type: "pair.candidate" }> => item.type === "pair.candidate",
    )
    if (!candidate) return
    yield* writeAll(control, operationID)
  })

const release = (control: Ports.Control, operationID: Model.OperationID) =>
  Effect.gen(function* () {
    const prepared = yield* control.transition({ type: "release.prepare", operation: operationID })
    const check = command(prepared, "release.verify")
    const committed = yield* control.transition({ type: "release.commit", check })
    expect(committed.decision.type).toBe("applied")
  })

const complete = (
  closure: SessionClosure.Interface,
  control: Ports.Control,
  operationID: Model.OperationID,
  label: string,
) =>
  Effect.gen(function* () {
    const generation = yield* freeze(closure, control, operationID, label)
    yield* writeAll(control, operationID)
    yield* release(control, operationID)
    return generation
  })

const stop = (started: Started) => Deferred.succeed(started.run.release, undefined).pipe(Effect.asVoid)

describe("SessionClosure merge and lineage coordinator", () => {
  it.live("K31 K32 and K74 keep the oldest writer in both creation orders and settle both exact views", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        [
          { label: "a_first", first: SessionID.make("ses_gate2_k31_a"), second: SessionID.make("ses_gate2_k31_b") },
          { label: "b_first", first: SessionID.make("ses_gate2_k32_b"), second: SessionID.make("ses_gate2_k32_a") },
        ],
        (fixture) =>
          Effect.gen(function* () {
            const runs = yield* Queue.unbounded<HeldRun>()
            const ports: Ports.RuntimePorts = { driver: driver(runs), participants: [], hooks: {} }
            yield* withClosure(ports, () =>
              Effect.gen(function* () {
                const closure = yield* SessionClosure.Service
                const first = yield* start(closure, runs, fixture.first)
                yield* selfClaim(first)
                const second = yield* start(closure, runs, fixture.second)
                yield* selfClaim(second)
                const before = yield* closure.view
                expect(operation(before, first.operation).creationSequence).toBeLessThan(
                  operation(before, second.operation).creationSequence,
                )

                yield* connect(second, first, fixture.label)
                const merged = yield* closure.view
                expect(merged.operations).toHaveLength(1)
                expect(merged.operations[0]?.id).toBe(first.operation)
                expect(merged.aliases).toContainEqual({ alias: second.operation, canonical: first.operation })
                expect(merged.operations[0]?.views.map((view) => view.id)).toEqual(
                  expect.arrayContaining([first.view, second.view]),
                )
                expect(merged.operations[0]?.waiters.map((waiter) => waiter.view)).toEqual(
                  expect.arrayContaining([first.view, second.view]),
                )

                yield* requireRoot(first.run.input.control, first)
                yield* requireRoot(first.run.input.control, { ...second, operation: first.operation })
                const generation = yield* complete(closure, first.run.input.control, first.operation, fixture.label)
                expect(generation.freezeOwner).toBe(first.operation)
                expect(
                  generation.records.every((record) => record.metadata.freeze_owner_operation_id === first.operation),
                ).toBe(true)

                const firstOutcome = yield* Fiber.join(first.request)
                const secondOutcome = yield* Fiber.join(second.request)
                expect(firstOutcome).toEqual({ operation: first.operation, view: first.view })
                expect(secondOutcome).toEqual({ operation: first.operation, view: second.view })
                yield* stop(first)
                yield* stop(second)
              }),
            )
          }),
        { concurrency: 1, discard: true },
      )
    }),
  )

  it.live("K33 transfers a bound pre-fence lease into the oldest canonical operation", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = { driver: driver(runs), participants: [], hooks: {} }
      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const first = yield* start(closure, runs, SessionID.make("ses_gate2_k33_old"))
          const second = yield* start(closure, runs, SessionID.make("ses_gate2_k33_new"))
          yield* selfClaim(first)
          yield* selfClaim(second)
          const lease = Model.id("lease", "lease_gate2_k33")
          const owner = { type: "scope", id: Model.id("scope", "scope_gate2_k33") } as const
          yield* second.run.input.control.transition({
            type: "lease.reserve",
            lease: {
              id: lease,
              session: second.session,
              epoch: 0n,
              source: "gate2-k33",
              origin: "internal",
              retry: "initial",
              kind: "pre_bind",
              owner,
            },
          })
          yield* second.run.input.control.transition({ type: "lease.bind", lease, owner })
          expect((yield* closure.view).leases.find((item) => item.id === lease)?.operation).toBe(second.operation)

          yield* connect(second, first, "k33")
          const merged = yield* closure.view
          expect(merged.aliases).toContainEqual({ alias: second.operation, canonical: first.operation })
          expect(merged.leases.find((item) => item.id === lease)?.operation).toBe(first.operation)
          const staleWriter = yield* second.run.input.control.transition({
            type: "writer.next",
            operation: second.operation,
          })
          expect(staleWriter.decision).toEqual({ type: "noop", reason: "stale" })
          expect(staleWriter.commands.some((item) => item.type === "pair.candidate")).toBe(false)

          yield* first.run.input.control.transition({ type: "lease.finish", lease, state: "retired" })
          yield* requireRoot(first.run.input.control, first)
          yield* requireRoot(first.run.input.control, { ...second, operation: first.operation })
          yield* complete(closure, first.run.input.control, first.operation, "k33")
          expect((yield* Fiber.join(first.request)).operation).toBe(first.operation)
          expect((yield* Fiber.join(second.request)).operation).toBe(first.operation)
          yield* stop(first)
          yield* stop(second)
        }),
      )
    }),
  )

  it.live("K34 K73 and K75 import one already-permitted losing pair without mutating its predecessor", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const writes = yield* Queue.unbounded<Ports.DriverCommand>()
      const pair: PairControl = { hold: false, writes }
      const ports: Ports.RuntimePorts = { driver: driver(runs, pair), participants: [], hooks: {} }
      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const first = yield* start(closure, runs, SessionID.make("ses_gate2_k34_old"))
          yield* selfClaim(first)
          yield* requireRoot(first.run.input.control, first)
          yield* freeze(closure, first.run.input.control, first.operation, "k34_old")
          yield* writeAll(first.run.input.control, first.operation)
          const predecessor = operation(yield* closure.view, first.operation).generations[0]
          expect(predecessor?.committedPrefix).toBe(predecessor?.records.length)

          const second = yield* start(closure, runs, SessionID.make("ses_gate2_k34_new"))
          yield* selfClaim(second)
          yield* requireRoot(second.run.input.control, second)
          yield* freeze(closure, second.run.input.control, second.operation, "k34_new")
          pair.hold = true
          const next = yield* second.run.input.control.transition({
            type: "writer.next",
            operation: second.operation,
          })
          const candidate = command(next, "pair.candidate")
          const dispatched = yield* Queue.take(writes)
          if (dispatched.command.type !== "pair.write") return yield* Effect.die("missing K34 pair write")
          const physical = dispatched.command
          expect(physical.candidate.fact).toBe(candidate.fact)
          expect((yield* closure.view).pairs.find((pair) => pair.id === physical.permit)?.state).toBe("in_flight")

          yield* connect(second, first, "k34")
          const linked = yield* closure.view
          expect(linked.aliases).toContainEqual({ alias: second.operation, canonical: first.operation })
          expect(
            operation(linked, first.operation).generations.find(
              (generation) => generation.freezeOwner === first.operation,
            ),
          ).toEqual(predecessor)
          const returned = yield* second.run.input.control.transition({
            type: "pair.return",
            write: physical,
            message: "verified",
            part: "verified",
          })
          expect(returned.decision.type).toBe("applied")
          const imported = yield* closure.view
          expect(imported.pairs.find((pair) => pair.id === physical.permit)?.state).toBe("imported")
          expect(
            operation(imported, first.operation).generations.find(
              (generation) => generation.freezeOwner === first.operation,
            ),
          ).toEqual(predecessor)
          const losingGeneration = operation(imported, first.operation).generations.find(
            (generation) => generation.freezeOwner === second.operation,
          )
          expect(losingGeneration?.committedPrefix).toBe(1)
          expect(losingGeneration?.verified).toContain(candidate.fact)
          const staleNext = yield* second.run.input.control.transition({
            type: "writer.next",
            operation: second.operation,
          })
          expect(staleNext.decision).toEqual({ type: "noop", reason: "stale" })
          expect(staleNext.commands.some((item) => item.type === "pair.candidate")).toBe(false)

          yield* Fiber.interrupt(first.request)
          yield* Fiber.interrupt(second.request)
          yield* stop(first)
          yield* stop(second)
        }),
      )
    }),
  )

  it.live("K35 disjoint recording operations overlap and retain failure locally", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const writes = yield* Queue.unbounded<Ports.DriverCommand>()
      const pair: PairControl = { hold: true, writes }
      const ports: Ports.RuntimePorts = { driver: driver(runs, pair), participants: [], hooks: {} }
      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const first = yield* start(closure, runs, SessionID.make("ses_gate2_k35_a"))
          const second = yield* start(closure, runs, SessionID.make("ses_gate2_k35_b"))
          yield* selfClaim(first)
          yield* selfClaim(second)
          yield* requireRoot(first.run.input.control, first)
          yield* requireRoot(second.run.input.control, second)
          yield* Effect.all(
            [
              freeze(closure, first.run.input.control, first.operation, "k35_a"),
              freeze(closure, second.run.input.control, second.operation, "k35_b"),
            ],
            { concurrency: "unbounded" },
          )
          const firstNext = yield* first.run.input.control.transition({
            type: "writer.next",
            operation: first.operation,
          })
          const secondNext = yield* second.run.input.control.transition({
            type: "writer.next",
            operation: second.operation,
          })
          const firstCandidate = command(firstNext, "pair.candidate")
          const secondCandidate = command(secondNext, "pair.candidate")
          const dispatched = [yield* Queue.take(writes), yield* Queue.take(writes)]
          const firstWrite = dispatched.find(
            (input) => input.command.type === "pair.write" && input.command.candidate.operation === first.operation,
          )?.command
          const secondWrite = dispatched.find(
            (input) => input.command.type === "pair.write" && input.command.candidate.operation === second.operation,
          )?.command
          if (firstWrite?.type !== "pair.write" || secondWrite?.type !== "pair.write")
            return yield* Effect.die("missing K35 pair writes")
          expect(firstWrite.candidate.fact).toBe(firstCandidate.fact)
          expect(secondWrite.candidate.fact).toBe(secondCandidate.fact)
          const overlapped = yield* closure.view
          expect(overlapped.pairs.filter((pair) => pair.state === "in_flight")).toHaveLength(2)

          yield* second.run.input.control.transition({
            type: "pair.return",
            write: secondWrite,
            message: "verified",
            part: "absent",
          })
          const secondFailure = yield* Fiber.join(second.request).pipe(Effect.flip)
          expect(secondFailure._tag).toBe("SessionClosureError")
          if (secondFailure._tag !== "SessionClosureError") return yield* Effect.die(secondFailure)
          expect(secondFailure.kind).toBe("record_failed")

          yield* first.run.input.control.transition({
            type: "pair.return",
            write: firstWrite,
            message: "verified",
            part: "verified",
          })
          pair.hold = false
          yield* writeAll(first.run.input.control, first.operation)
          yield* release(first.run.input.control, first.operation)
          expect((yield* Fiber.join(first.request)).operation).toBe(first.operation)
          const after = yield* closure.view
          expect(after.aliases).toEqual([])
          expect(after.operations).toHaveLength(1)
          expect(after.operations[0]?.id).toBe(second.operation)
          expect(after.operations[0]?.failure?.kind).toBe("record_failed")
          expect(after.fences.every((fence) => fence.operation === second.operation)).toBe(true)
          expect(after.claims.every((claim) => claim.operation === second.operation)).toBe(true)
          yield* stop(first)
          yield* stop(second)
        }),
      )
    }),
  )

  it.live("K81 root-anchored incomplete evidence fails only its disjoint view", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = { driver: driver(runs), participants: [], hooks: {} }
      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const affected = yield* start(closure, runs, SessionID.make("ses_gate2_k81_bad"))
          const healthy = yield* start(closure, runs, SessionID.make("ses_gate2_k81_good"))
          yield* selfClaim(affected)
          yield* selfClaim(healthy)
          const incomplete = yield* affected.run.input.control.claim({
            operation: affected.operation,
            proofs: [
              { value: "root_anchored_incomplete", root: affected.session, path: [affected.session], edges: [] },
            ],
            signals: [],
          })
          expect(incomplete.decision.type).toBe("applied")
          const advanced = yield* affected.run.input.control.transition({
            type: "operation.advance",
            operation: affected.operation,
            to: { type: "fencing" },
          })
          expect(advanced.decision.type).toBe("applied")
          const failedView = operation(yield* closure.view, affected.operation)
          expect(failedView.views[0]?.result).toBe("failure")
          expect(failedView.driver.state).toBe("running")
          if (failedView.driver.state !== "running") return yield* Effect.die("missing affected driver")
          yield* affected.run.input.control.transition({
            type: "operation.fail",
            operation: affected.operation,
            repair: failedView.driver.repair,
            revision: failedView.revision,
            failure: "scope_incomplete",
          })
          const affectedFailure = yield* Fiber.join(affected.request).pipe(Effect.flip)
          expect(affectedFailure._tag).toBe("SessionClosureError")
          if (affectedFailure._tag !== "SessionClosureError") return yield* Effect.die(affectedFailure)
          expect(affectedFailure.kind).toBe("scope_incomplete")

          const isolated = yield* closure.view
          expect(isolated.aliases).toEqual([])
          expect(operation(isolated, affected.operation).views[0]?.result).toBe("failure")
          expect(operation(isolated, healthy.operation).views[0]?.result).toBe("pending")
          expect(operation(isolated, healthy.operation).failure).toBeUndefined()
          yield* requireRoot(healthy.run.input.control, healthy)
          yield* complete(closure, healthy.run.input.control, healthy.operation, "k81_good")
          expect((yield* Fiber.join(healthy.request)).view).toBe(healthy.view)
          yield* stop(affected)
          yield* stop(healthy)
        }),
      )
    }),
  )

  it.live("K82 unanchored evidence grants no authority or effect and independent progress remains", () =>
    Effect.gen(function* () {
      const invoked = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = { driver: driver(runs), participants: [], hooks: {} }
      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const started = yield* start(closure, runs, SessionID.make("ses_gate2_k82"))
          const before = operation(yield* closure.view, started.operation)
          const unknown = yield* started.run.input.control.claim({
            operation: started.operation,
            proofs: [{ value: "unanchored_unknown", root: started.session }],
            signals: [Deferred.succeed(invoked, undefined).pipe(Effect.as("success" as const))],
          })
          expect(unknown.decision).toEqual({ type: "noop", reason: "disjoint" })
          expect(yield* Deferred.isDone(invoked)).toBe(false)
          const afterUnknown = yield* closure.view
          expect(operation(afterUnknown, started.operation)).toEqual(before)
          expect(afterUnknown.claims).toEqual([])
          expect(afterUnknown.fences).toEqual([])
          expect(afterUnknown.effects).toEqual([])

          yield* selfClaim(started)
          yield* requireRoot(started.run.input.control, started)
          yield* complete(closure, started.run.input.control, started.operation, "k82")
          expect((yield* Fiber.join(started.request)).view).toBe(started.view)
          yield* stop(started)
        }),
      )
    }),
  )

  it.live("K59 one accepted waiter detaches while its peer receives successful closure", () =>
    Effect.gen(function* () {
      const admissions = yield* Queue.unbounded<{
        readonly root: Model.SessionID
        readonly operation: Model.OperationID
        readonly waiter: Model.WaiterID
        readonly decision: Model.Decision
      }>()
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: { afterRequest: (input) => Queue.offer(admissions, input).pipe(Effect.asVoid) },
      }
      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_gate2_k59")
          const firstRequest = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const firstAdmission = yield* Queue.take(admissions)
          const held = yield* Queue.take(runs)
          const firstView = operation(yield* closure.view, firstAdmission.operation)
          const rootView = firstView.views[0]
          if (!rootView) return yield* Effect.die("missing K59 root view")
          const first: Started = {
            root,
            session: Model.id("session", root),
            operation: firstAdmission.operation,
            view: rootView.id,
            request: firstRequest,
            run: held,
          }
          yield* selfClaim(first)

          const secondRequest = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const secondAdmission = yield* Queue.take(admissions)
          expect(secondAdmission.decision.type).toBe("joined")
          const attached = operation(yield* closure.view, first.operation)
          expect(attached.waiters).toHaveLength(2)
          expect(attached.waiters.every((waiter) => waiter.state === "attached")).toBe(true)

          yield* Fiber.interrupt(firstRequest)
          const detached = operation(yield* closure.view, first.operation)
          expect(detached.waiters.find((waiter) => waiter.id === firstAdmission.waiter)?.state).toBe("detached")
          expect(detached.waiters.find((waiter) => waiter.id === secondAdmission.waiter)?.state).toBe("attached")
          expect(detached.driver.state).toBe("running")

          yield* requireRoot(first.run.input.control, first)
          yield* complete(closure, first.run.input.control, first.operation, "k59")
          const outcome = yield* Fiber.join(secondRequest)
          expect(outcome).toEqual({ operation: first.operation, view: first.view })
          yield* stop(first)
        }),
      )
    }),
  )

  it.live("K62 empty successful delivery performs exact cleanup after the only waiter detaches", () =>
    Effect.gen(function* () {
      const delivery = yield* Queue.unbounded<Extract<Model.Command, { readonly type: "waiter.deliver" }>>()
      const allowDelivery = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          beforeWaiterDelivery: (command) =>
            Queue.offer(delivery, command).pipe(Effect.andThen(Deferred.await(allowDelivery))),
        },
      }
      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const started = yield* start(closure, runs, SessionID.make("ses_gate2_k62_empty"))
          yield* selfClaim(started)
          yield* requireRoot(started.run.input.control, started)
          yield* Fiber.interrupt(started.request)
          const detached = operation(yield* closure.view, started.operation)
          expect(detached.waiters[0]?.state).toBe("detached")
          expect(detached.driver.state).toBe("running")

          const completing = yield* complete(closure, started.run.input.control, started.operation, "k62_empty").pipe(
            Effect.forkScoped,
          )
          const batch = yield* Queue.take(delivery)
          expect(batch.operation).toBe(started.operation)
          expect(batch.waiters).toEqual([])
          const pendingCleanup = operation(yield* closure.view, started.operation)
          expect(pendingCleanup.phase.type).toBe("released_pending_delivery")
          expect(pendingCleanup.delivery).toEqual({ revision: batch.revision, waiters: [] })

          yield* Deferred.succeed(allowDelivery, undefined)
          yield* Fiber.join(completing)
          expect((yield* closure.view).operations.some((item) => item.id === started.operation)).toBe(false)
          yield* stop(started)
        }),
      )
    }),
  )

  it.live("K60 K61 retained failure elects one repair worker and settles both retry waiters once", () =>
    Effect.gen(function* () {
      const admissions = yield* Queue.unbounded<{
        readonly root: Model.SessionID
        readonly operation: Model.OperationID
        readonly waiter: Model.WaiterID
        readonly decision: Model.Decision
      }>()
      const runs = yield* Queue.unbounded<HeldRun>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: { afterRequest: (input) => Queue.offer(admissions, input).pipe(Effect.asVoid) },
      }
      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_gate2_k61_repair_success")
          const initial = yield* start(closure, runs, root)
          yield* Queue.take(admissions)
          yield* selfClaim(initial)
          yield* requireRoot(initial.run.input.control, initial)
          yield* stop(initial)
          const initialFailure = yield* Fiber.join(initial.request).pipe(Effect.flip)
          expect(initialFailure._tag).toBe("SessionClosureError")
          const failed = operation(yield* closure.view, initial.operation)
          expect(failed.driver.state).toBe("failed")
          expect(failed.waiters.every((waiter) => waiter.state === "settled")).toBe(true)

          const firstRepair = yield* start(closure, runs, root)
          const firstAdmission = yield* Queue.take(admissions)
          expect(firstAdmission.decision.type).toBe("joined")
          expect(firstRepair.operation).toBe(initial.operation)
          const secondRepairRequest = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const secondAdmission = yield* Queue.take(admissions)
          expect(secondAdmission.decision.type).toBe("joined")
          expect(yield* Queue.size(runs)).toBe(0)
          const elected = operation(yield* closure.view, initial.operation)
          expect(elected.driver.state).toBe("running")
          expect(elected.waiters.filter((waiter) => waiter.state === "attached")).toHaveLength(2)

          yield* requireRoot(firstRepair.run.input.control, firstRepair)
          yield* complete(closure, firstRepair.run.input.control, firstRepair.operation, "k61_repair")
          const outcomes = yield* Effect.all(
            [firstRepair.request, secondRepairRequest].map((fiber) => Fiber.join(fiber)),
            { concurrency: "unbounded" },
          )
          expect(outcomes).toEqual([
            { operation: initial.operation, view: firstRepair.view },
            { operation: initial.operation, view: firstRepair.view },
          ])
          yield* stop(firstRepair)
        }),
      )
    }),
  )

  it.live("K112 worker finalizers retain claiming quiescing and recording payloads for two waiters", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        ["claiming", "quiescing", "recording"] as const,
        (phase) =>
          Effect.gen(function* () {
            const admissions = yield* Queue.unbounded<{
              readonly root: Model.SessionID
              readonly operation: Model.OperationID
              readonly waiter: Model.WaiterID
              readonly decision: Model.Decision
            }>()
            const exitReached = yield* Deferred.make<void>()
            const allowExit = yield* Deferred.make<void>()
            const runs = yield* Queue.unbounded<HeldRun>()
            const ports: Ports.RuntimePorts = {
              driver: defectingDriver(runs),
              participants: [],
              hooks: {
                afterRequest: (input) => Queue.offer(admissions, input).pipe(Effect.asVoid),
                beforeWorkerExit: () =>
                  Deferred.succeed(exitReached, undefined).pipe(Effect.andThen(Deferred.await(allowExit))),
              },
            }
            yield* withClosure(ports, () =>
              Effect.gen(function* () {
                const closure = yield* SessionClosure.Service
                const root = SessionID.make(`ses_gate2_k112_${phase}`)
                const first = yield* start(closure, runs, root)
                yield* Queue.take(admissions)
                yield* selfClaim(first)
                const secondRequest = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
                yield* Queue.take(admissions)
                expect(operation(yield* closure.view, first.operation).waiters).toHaveLength(2)

                if (phase === "quiescing") {
                  yield* first.run.input.control.transition({
                    type: "operation.advance",
                    operation: first.operation,
                    to: { type: "fencing" },
                  })
                  yield* first.run.input.control.transition({
                    type: "operation.advance",
                    operation: first.operation,
                    to: { type: "quiescing" },
                  })
                }
                if (phase === "recording") {
                  yield* requireRoot(first.run.input.control, first)
                  yield* freeze(closure, first.run.input.control, first.operation, `k112_${phase}`)
                }
                const before = operation(yield* closure.view, first.operation)
                expect(before.phase.type).toBe(phase)
                if (phase === "recording") expect(before.generations.length).toBeGreaterThan(0)

                yield* Deferred.succeed(first.run.release, undefined)
                yield* Deferred.await(exitReached)
                const beforeFinalizer = operation(yield* closure.view, first.operation)
                expect(beforeFinalizer.phase).toEqual(before.phase)
                expect(beforeFinalizer.generations).toEqual(before.generations)
                yield* Deferred.succeed(allowExit, undefined)

                const failures = yield* Effect.all(
                  [first.request, secondRequest].map((fiber) => Fiber.join(fiber).pipe(Effect.flip)),
                  { concurrency: "unbounded" },
                )
                expect(failures.every((failure) => failure._tag === "SessionClosureError")).toBe(true)
                const retained = operation(yield* closure.view, first.operation)
                expect(retained.driver.state).toBe("failed")
                expect(retained.waiters.every((waiter) => waiter.state === "settled")).toBe(true)
                expect(retained.generations).toEqual(before.generations)
                expect(retained.failure?.kind).toBe("closure_unavailable")
              }),
            )
          }),
        { concurrency: 1, discard: true },
      )
    }),
  )
})
