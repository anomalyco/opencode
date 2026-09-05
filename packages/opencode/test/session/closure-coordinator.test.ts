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

const runState: Ports.RunStateCapability = {
  assertNotBusy: () => Effect.void,
  cancel: () => Effect.void,
}

const driver = (runs: Queue.Queue<{ readonly input: Ports.DriverRun; readonly release: Deferred.Deferred<void> }>) =>
  ({
    run: (input: Ports.DriverRun) =>
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>()
        yield* Queue.offer(runs, { input, release })
        yield* Deferred.await(release)
      }),
    command: () => Effect.void,
  }) satisfies Ports.Driver

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
  }).pipe(Effect.provide(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)))

describe("SessionClosure coordinator", () => {
  it.live("publishes a directory runtime only after its supervisor owns the queue", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          supervisorReady: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const fiber = yield* closure.identity.pipe(
            Effect.ensuring(Deferred.succeed(completed, undefined)),
            Effect.forkScoped,
          )

          yield* Deferred.await(entered)
          expect(yield* Deferred.isDone(completed)).toBe(false)
          yield* Deferred.succeed(release, undefined)
          const identity = yield* Fiber.join(fiber)
          expect(identity.directory.length).toBeGreaterThan(0)
          expect(yield* Deferred.isDone(completed)).toBe(true)
        }),
      )
    }),
  )

  it.live("exposes startup supervisor failure only as terminal unavailability", () =>
    Effect.gen(function* () {
      const attempted = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          supervisorReady: () =>
            Deferred.succeed(attempted, undefined).pipe(
              Effect.andThen(Effect.die(new Error("supervisor failed before readiness"))),
            ),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const identity = yield* closure.identity
          expect(yield* Deferred.isDone(attempted)).toBe(true)
          expect(identity.directory.length).toBeGreaterThan(0)
          const beforeRequest = yield* closure.view
          expect(beforeRequest.supervisor.state).toBe("failed")

          const failure = yield* closure
            .request({ root: SessionID.make("ses_gate2_startup_supervisor_fail"), runState })
            .pipe(Effect.flip)
          expect(failure._tag).toBe("SessionClosureError")
          if (failure._tag !== "SessionClosureError") return yield* Effect.die(failure)
          expect(failure.kind).toBe("closure_unavailable")
          expect(yield* Queue.size(runs)).toBe(0)
        }),
      )
    }),
  )

  it.live("interruption before the queue offer clears provisional authority", () =>
    Effect.gen(function* () {
      const offerEntered = yield* Deferred.make<void>()
      const offerRelease = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          offerTicket: (_input, offer) =>
            Deferred.succeed(offerEntered, undefined).pipe(
              Effect.andThen(Deferred.await(offerRelease)),
              Effect.andThen(offer),
            ),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const request = yield* closure
            .request({ root: SessionID.make("ses_gate2_preoffer"), runState })
            .pipe(Effect.forkScoped)

          yield* Deferred.await(offerEntered)
          yield* Fiber.interrupt(request)

          const view = yield* closure.view
          expect(view.supervisor.state).toBe("running")
          expect(view.operations).toHaveLength(0)
          expect(view.tickets).toHaveLength(1)
          expect(view.tickets[0]?.state).toBe("cleared")
          expect(yield* Queue.size(runs)).toBe(0)
        }),
      )
    }),
  )

  it.live("a physically received ticket still waits for locked acceptance", () =>
    Effect.gen(function* () {
      const received = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          offerTicket: (_input, offer) =>
            Effect.gen(function* () {
              const result = yield* offer
              yield* Deferred.succeed(received, undefined)
              yield* Deferred.await(release)
              return result
            }),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const request = yield* closure
            .request({ root: SessionID.make("ses_gate2_received"), runState })
            .pipe(Effect.forkScoped)

          yield* Deferred.await(received)
          const reserved = yield* closure.view
          expect(reserved.operations).toHaveLength(1)
          expect(reserved.tickets[0]?.acceptance).toBe("pending")
          expect(reserved.tickets[0]?.state).toBe("reserved")

          yield* Fiber.interrupt(request)
          const cleared = yield* closure.view
          expect(cleared.operations).toHaveLength(0)
          expect(cleared.tickets[0]?.acceptance).toBe("failed")
          expect(yield* Queue.size(runs)).toBe(0)
        }),
      )
    }),
  )

  it.live("interrupting a provisional joiner preserves the shared ticket", () =>
    Effect.gen(function* () {
      const offerEntered = yield* Deferred.make<void>()
      const offerRelease = yield* Deferred.make<void>()
      const requests = yield* Queue.unbounded<{
        readonly waiter: Model.WaiterID
      }>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          afterRequest: (input) => Queue.offer(requests, { waiter: input.waiter }).pipe(Effect.asVoid),
          offerTicket: (_input, offer) =>
            Deferred.succeed(offerEntered, undefined).pipe(
              Effect.andThen(Deferred.await(offerRelease)),
              Effect.andThen(offer),
            ),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_gate2_provisional_joiner")
          const owner = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const ownerRequest = yield* Queue.take(requests)
          yield* Deferred.await(offerEntered)
          const joiner = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const joinerRequest = yield* Queue.take(requests)
          const shared = yield* closure.view
          expect(shared.operations[0]?.waiters.map((waiter) => waiter.state)).toEqual(["provisional", "provisional"])
          expect(shared.tickets[0]?.acceptance).toBe("pending")

          yield* Fiber.interrupt(joiner)
          const detached = yield* closure.view
          expect(detached.operations[0]?.waiters.find((waiter) => waiter.id === joinerRequest.waiter)?.state).toBe(
            "detached",
          )
          expect(detached.operations[0]?.waiters.find((waiter) => waiter.id === ownerRequest.waiter)?.state).toBe(
            "provisional",
          )
          expect(detached.tickets[0]?.acceptance).toBe("pending")

          yield* Deferred.succeed(offerRelease, undefined)
          const run = yield* Queue.take(runs)
          const accepted = yield* closure.view
          expect(accepted.operations[0]?.waiters.find((waiter) => waiter.id === ownerRequest.waiter)?.state).toBe(
            "attached",
          )
          expect(accepted.operations[0]?.driver.state).toBe("running")

          yield* Deferred.succeed(run.release, undefined)
          yield* Fiber.join(owner).pipe(Effect.flip)
        }),
      )
    }),
  )

  it.live("an interrupted offer fiber completes the shared ticket for its surviving waiter", () =>
    Effect.gen(function* () {
      const offerRelease = yield* Deferred.make<void>()
      const attempts = yield* Queue.unbounded<number>()
      const requests = yield* Queue.unbounded<{
        readonly waiter: Model.WaiterID
      }>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const count = { value: 0 }
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          afterRequest: (input) => Queue.offer(requests, { waiter: input.waiter }).pipe(Effect.asVoid),
          offerTicket: (_input, offer) =>
            Effect.sync(() => {
              count.value += 1
              return count.value
            }).pipe(
              Effect.tap((attempt) => Queue.offer(attempts, attempt)),
              Effect.andThen(Deferred.await(offerRelease)),
              Effect.andThen(offer),
            ),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_gate2_provisional_offer_owner")
          const owner = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const ownerRequest = yield* Queue.take(requests)
          expect(yield* Queue.take(attempts)).toBe(1)
          const joiner = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const joinerRequest = yield* Queue.take(requests)
          const shared = yield* closure.view
          expect(shared.operations[0]?.waiters.map((waiter) => waiter.state)).toEqual(["provisional", "provisional"])

          const interrupted = yield* Fiber.interrupt(owner).pipe(Effect.forkScoped)
          expect(yield* Queue.take(attempts)).toBe(2)
          const retained = yield* closure.view
          expect(retained.operations[0]?.waiters.find((waiter) => waiter.id === ownerRequest.waiter)?.state).toBe(
            "detached",
          )
          expect(retained.operations[0]?.waiters.find((waiter) => waiter.id === joinerRequest.waiter)?.state).toBe(
            "provisional",
          )
          expect(retained.tickets[0]?.state).toBe("reserved")

          yield* Deferred.succeed(offerRelease, undefined)
          const run = yield* Queue.take(runs)
          yield* Fiber.join(interrupted)
          const accepted = yield* closure.view
          expect(accepted.operations[0]?.waiters.find((waiter) => waiter.id === joinerRequest.waiter)?.state).toBe(
            "attached",
          )
          expect(accepted.operations[0]?.driver.state).toBe("running")

          yield* Deferred.succeed(run.release, undefined)
          yield* Fiber.join(joiner).pipe(Effect.flip)
        }),
      )
    }),
  )

  it.live("opens the one-shot worker gate only after locked promotion", () =>
    Effect.gen(function* () {
      const beforeOpen = yield* Deferred.make<void>()
      const allowOpen = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          beforeWorkerOpen: () =>
            Deferred.succeed(beforeOpen, undefined).pipe(Effect.andThen(Deferred.await(allowOpen))),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const request = yield* closure
            .request({ root: SessionID.make("ses_gate2_start_gate"), runState })
            .pipe(Effect.forkScoped)

          yield* Deferred.await(beforeOpen)
          const pending = yield* closure.view
          expect(pending.operations[0]?.driver.state).toBe("running")
          expect(pending.operations[0]?.driver.state === "running" && pending.operations[0].driver.gate).toBe("pending")
          expect(yield* Queue.size(runs)).toBe(0)

          yield* Deferred.succeed(allowOpen, undefined)
          const started = yield* Queue.take(runs)
          const opened = yield* closure.view
          expect(opened.operations[0]?.driver.state === "running" && opened.operations[0].driver.gate).toBe("opened")

          yield* Deferred.succeed(started.release, undefined)
          const failure = yield* Fiber.join(request).pipe(Effect.flip)
          expect(failure._tag).toBe("SessionClosureError")
          if (failure._tag !== "SessionClosureError") return yield* Effect.die(failure)
          expect(failure.kind).toBe("closure_unavailable")
        }),
      )
    }),
  )

  it.live("interruption after acceptance detaches only that waiter", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = { driver: driver(runs), participants: [], hooks: {} }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const request = yield* closure
            .request({ root: SessionID.make("ses_gate2_accepted"), runState })
            .pipe(Effect.forkScoped)
          const started = yield* Queue.take(runs)

          yield* Fiber.interrupt(request)
          const detached = yield* closure.view
          expect(detached.operations).toHaveLength(1)
          expect(detached.operations[0]?.driver.state).toBe("running")
          expect(detached.operations[0]?.waiters[0]?.state).toBe("detached")

          yield* Deferred.succeed(started.release, undefined)
          const failed = yield* closure.view
          expect(failed.operations[0]?.driver.state).toBe("failed")
          expect(failed.operations[0]?.failure?.kind).toBe("closure_unavailable")
        }),
      )
    }),
  )

  it.live("queue offer failure retains typed failure and starts no driver", () =>
    Effect.gen(function* () {
      const attempted = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          offerTicket: () => Deferred.succeed(attempted, undefined).pipe(Effect.as(false)),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const failure = yield* closure
            .request({ root: SessionID.make("ses_gate2_offer_fail"), runState })
            .pipe(Effect.flip)

          expect(yield* Deferred.isDone(attempted)).toBe(true)
          expect(failure._tag).toBe("SessionClosureError")
          if (failure._tag !== "SessionClosureError") return yield* Effect.die(failure)
          expect(failure.kind).toBe("closure_unavailable")
          expect(yield* Queue.size(runs)).toBe(0)
          const view = yield* closure.view
          expect(view.supervisor.state).toBe("running")
          expect(view.operations[0]?.driver.state).toBe("failed")
          expect(view.operations[0]?.waiters[0]?.state).toBe("settled")
          expect(view.effects).toEqual([])
        }),
      )
    }),
  )

  it.live("registration failure retains typed failure and runs zero driver effects", () =>
    Effect.gen(function* () {
      const accepted = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          afterTicketAccept: () => Deferred.succeed(accepted, undefined).pipe(Effect.asVoid),
          beforeWorkerRegister: () => Effect.die(new Error("registration failed")),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const request = yield* closure
            .request({ root: SessionID.make("ses_gate2_register_fail"), runState })
            .pipe(Effect.forkScoped)

          yield* Deferred.await(accepted)
          const failure = yield* Fiber.join(request).pipe(Effect.flip)
          expect(failure._tag).toBe("SessionClosureError")
          if (failure._tag !== "SessionClosureError") return yield* Effect.die(failure)
          expect(failure.kind).toBe("closure_unavailable")
          expect(yield* Queue.size(runs)).toBe(0)
          const view = yield* closure.view
          expect(view.operations[0]?.driver.state).toBe("failed")
          expect(view.supervisor.state).toBe("running")
        }),
      )
    }),
  )

  it.live("supervisor death fails queued acceptance and makes future starts unavailable", () =>
    Effect.gen(function* () {
      const accepted = yield* Deferred.make<void>()
      const defect = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          afterTicketAccept: () => Deferred.succeed(accepted, undefined).pipe(Effect.asVoid),
          beforeSupervisorTake: () =>
            Deferred.await(defect).pipe(Effect.andThen(Effect.die(new Error("supervisor receive defect")))),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const first = yield* closure
            .request({ root: SessionID.make("ses_gate2_supervisor_first"), runState })
            .pipe(Effect.forkScoped)
          yield* Deferred.await(accepted)
          const queued = yield* closure.view
          expect(queued.supervisor.state).toBe("running")
          expect(queued.tickets[0]?.acceptance).toBe("accepted")
          expect(queued.operations[0]?.driver.state).toBe("starting")

          yield* Deferred.succeed(defect, undefined)
          const firstFailure = yield* Fiber.join(first).pipe(Effect.flip)
          expect(firstFailure._tag).toBe("SessionClosureError")
          const failed = yield* closure.view
          expect(failed.supervisor.state).toBe("failed")
          expect(failed.operations[0]?.driver.state).toBe("failed")
          expect(yield* Queue.size(runs)).toBe(0)

          const secondFailure = yield* closure
            .request({ root: SessionID.make("ses_gate2_supervisor_second"), runState })
            .pipe(Effect.flip)
          expect(secondFailure._tag).toBe("SessionClosureError")
          if (secondFailure._tag !== "SessionClosureError") return yield* Effect.die(secondFailure)
          expect(secondFailure.kind).toBe("closure_unavailable")
          expect(yield* Queue.size(runs)).toBe(0)
        }),
      )
    }),
  )

  it.live("a supervisor defect after promotion fails the unopened gate", () =>
    Effect.gen(function* () {
      const promoted = yield* Deferred.make<void>()
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          beforeWorkerOpen: () =>
            Deferred.succeed(promoted, undefined).pipe(
              Effect.andThen(Effect.die(new Error("supervisor failed before opening worker"))),
            ),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const request = yield* closure
            .request({ root: SessionID.make("ses_gate2_promote_fail"), runState })
            .pipe(Effect.forkScoped)

          yield* Deferred.await(promoted)
          const failure = yield* Fiber.join(request).pipe(Effect.flip)
          expect(failure._tag).toBe("SessionClosureError")
          if (failure._tag !== "SessionClosureError") return yield* Effect.die(failure)
          expect(failure.kind).toBe("closure_unavailable")
          expect(yield* Queue.size(runs)).toBe(0)
          const view = yield* closure.view
          expect(view.supervisor.state).toBe("failed")
          expect(view.operations[0]?.driver.state).toBe("failed")
        }),
      )
    }),
  )

  it.live("settles current waiters once and elects one repair worker", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const requests = yield* Queue.unbounded<{
        readonly root: Model.SessionID
        readonly operation: Model.OperationID
        readonly waiter: Model.WaiterID
        readonly decision: Model.Decision
      }>()
      const ports: Ports.RuntimePorts = {
        driver: driver(runs),
        participants: [],
        hooks: {
          afterRequest: (input) => Queue.offer(requests, input).pipe(Effect.asVoid),
        },
      }

      yield* withClosure(ports, () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_gate2_repair")
          const first = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          yield* Queue.take(requests)
          const initial = yield* Queue.take(runs)
          const second = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const third = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          yield* Queue.take(requests)
          yield* Queue.take(requests)

          const attached = yield* closure.view
          expect(attached.operations).toHaveLength(1)
          expect(attached.operations[0]?.waiters.map((item) => item.state)).toEqual([
            "attached",
            "attached",
            "attached",
          ])

          yield* Deferred.succeed(initial.release, undefined)
          const failures = yield* Effect.all(
            [first, second, third].map((fiber) => Fiber.join(fiber).pipe(Effect.flip)),
            { concurrency: "unbounded" },
          )
          expect(failures.map((failure) => failure._tag)).toEqual([
            "SessionClosureError",
            "SessionClosureError",
            "SessionClosureError",
          ])
          const retained = yield* closure.view
          expect(retained.operations[0]?.driver.state).toBe("failed")
          expect(retained.operations[0]?.waiters.every((item) => item.state === "settled")).toBe(true)

          const repairA = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const repairB = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          yield* Queue.take(requests)
          yield* Queue.take(requests)
          const repair = yield* Queue.take(runs)
          expect(yield* Queue.size(runs)).toBe(0)
          const elected = yield* closure.view
          expect(elected.operations).toHaveLength(1)
          expect(elected.tickets).toHaveLength(2)
          expect(elected.operations[0]?.driver.state).toBe("running")
          expect(elected.operations[0]?.waiters.filter((item) => item.state === "attached")).toHaveLength(2)

          yield* Deferred.succeed(repair.release, undefined)
          yield* Effect.all(
            [repairA, repairB].map((fiber) => Fiber.join(fiber).pipe(Effect.flip)),
            { concurrency: "unbounded", discard: true },
          )
        }),
      )
    }),
  )

  it.live("a stale old worker finalizer cannot demote its running repair", () =>
    Effect.gen(function* () {
      const runs = yield* Queue.unbounded<{
        readonly input: Ports.DriverRun
        readonly release: Deferred.Deferred<void>
      }>()
      const ports: Ports.RuntimePorts = { driver: driver(runs), participants: [], hooks: {} }

      yield* withClosure(ports, (directory) =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const root = SessionID.make("ses_gate2_stale_finalizer")
          const firstRequest = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const first = yield* Queue.take(runs)
          yield* first.input.control
            .issue({
              operation: first.input.command.operation,
              effect: "signal",
              run: Effect.succeed("failure"),
            })
            .pipe(provideInstanceEffect(directory))
          const firstFailure = yield* Fiber.join(firstRequest).pipe(Effect.flip)
          expect(firstFailure._tag).toBe("SessionClosureError")

          const repairRequest = yield* closure.request({ root, runState }).pipe(Effect.forkScoped)
          const repair = yield* Queue.take(runs)
          const beforeOldExit = yield* closure.view
          expect(beforeOldExit.operations[0]?.driver.state).toBe("running")
          expect(
            beforeOldExit.operations[0]?.driver.state === "running" && beforeOldExit.operations[0].driver.worker,
          ).toBe(repair.input.command.worker)

          yield* Deferred.succeed(first.release, undefined)
          const afterOldExit = yield* closure.view
          expect(afterOldExit.operations[0]?.driver.state).toBe("running")
          expect(
            afterOldExit.operations[0]?.driver.state === "running" && afterOldExit.operations[0].driver.worker,
          ).toBe(repair.input.command.worker)
          expect(afterOldExit.operations[0]?.failure).toEqual(beforeOldExit.operations[0]?.failure)

          yield* Deferred.succeed(repair.release, undefined)
          yield* Fiber.join(repairRequest).pipe(Effect.flip)
        }),
      )
    }),
  )
})
