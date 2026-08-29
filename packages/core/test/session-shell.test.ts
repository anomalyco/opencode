import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { eq } from "drizzle-orm"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schedule, Stream } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Shell } from "@opencode-ai/core/shell"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

class ExecutionControl extends Context.Service<
  ExecutionControl,
  {
    started: Deferred.Deferred<void>
    release: Deferred.Deferred<void>
    wakes: Session.ID[]
    drains: Session.ID[]
  }
>()("test/SessionShell/ExecutionControl") {}

const controlLayer = Layer.effect(
  ExecutionControl,
  Effect.gen(function* () {
    return { started: yield* Deferred.make<void>(), release: yield* Deferred.make<void>(), wakes: [], drains: [] }
  }),
)

const executionLayer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const control = yield* ExecutionControl
    const coordinator = yield* SessionRunCoordinator.make<Session.ID, never>({
      drain: (sessionID) =>
        Effect.sync(() => control.drains.push(sessionID)).pipe(
          Effect.andThen(Deferred.succeed(control.started, undefined)),
          Effect.andThen(Deferred.await(control.release)),
        ),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      interrupt: (sessionID) => coordinator.interrupt(sessionID),
      awaitIdle: coordinator.awaitIdle,
      wake: (sessionID) =>
        Effect.sync(() => control.wakes.push(sessionID)).pipe(Effect.andThen(coordinator.wake(sessionID))),
    })
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      SessionExecution.node,
      LocationServiceMap.node,
    ]),
    [
      [Bus.node, Bus.configured({ persist: true })],
      [SessionExecution.node, executionLayer],
    ],
  ).pipe(Layer.provideMerge(controlLayer)),
)

const setup = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped()
  const session = yield* Session.Service
  const created = yield* session.create({ location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }) })
  const locations = yield* LocationServiceMap.Service
  const shell = yield* Shell.Service.pipe(Effect.provide(locations.get(created.location)))
  const control = yield* ExecutionControl
  const execution = yield* SessionExecution.Service
  return { tmp, session, created, shell, control, execution }
})

// File gates prove the child process is running without relying on elapsed-time assertions.
const gate = Effect.fn(function* (directory: string, name: string) {
  const release = Effect.promise(() => Bun.write(path.join(directory, `${name}.release`), "")).pipe(Effect.asVoid)
  yield* Effect.addFinalizer(() => release)
  return {
    command:
      process.platform === "win32"
        ? `Write-Output '${name} started'; New-Item '${name}.started' -ItemType File | Out-Null; while (!(Test-Path '${name}.release') -and (Test-Path $PWD)) { Start-Sleep -Milliseconds 10 }; Write-Output '${name} finished'`
        : `printf '${name} started\\n'; touch ${name}.started; while [ ! -f ${name}.release ] && [ -d "$PWD" ]; do sleep 0.01; done; printf '${name} finished\\n'`,
    started: Effect.promise(() => Bun.file(path.join(directory, `${name}.started`)).exists()).pipe(
      Effect.repeat({ until: (exists) => exists, schedule: Schedule.spaced("10 millis") }),
      Effect.timeout("5 seconds"),
    ),
    release,
  }
})

const log = (session: Session.Interface, sessionID: Session.ID, follow = false) =>
  session.log({ sessionID, follow }).pipe(Stream.filter((event) => !Bus.isSynced(event)))

const started = (session: Session.Interface, sessionID: Session.ID, command: string) =>
  log(session, sessionID, true).pipe(
    Stream.filter((event): event is SessionEvent.Shell.Started => event.type === "session.shell.started"),
    Stream.filter((event) => event.data.shell.command === command),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
    Effect.timeout("5 seconds"),
  )

describe("Session.shell", () => {
  it.live("starts and completes while model execution remains active", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const model = yield* fixture.execution.resume(fixture.created.id).pipe(Effect.forkScoped)
      yield* Deferred.await(fixture.control.started)
      const command = yield* gate(fixture.tmp.path, "busy")
      const caller = yield* fixture.session
        .shell({ sessionID: fixture.created.id, command: command.command })
        .pipe(Effect.forkScoped)

      yield* command.started
      yield* started(fixture.session, fixture.created.id, command.command)
      expect(yield* fixture.execution.active).toContain(fixture.created.id)
      yield* command.release
      yield* Fiber.join(caller).pipe(Effect.timeout("5 seconds"))

      expect(yield* fixture.execution.active).toContain(fixture.created.id)
      expect(fixture.control.drains).toEqual([fixture.created.id])
      expect(fixture.control.wakes).toEqual([])
      expect(yield* fixture.session.inbox(fixture.created.id)).toMatchObject([
        { type: "synthetic", payload: { metadata: { source: "shell", state: "completed" } } },
      ])
      yield* Deferred.succeed(fixture.control.release, undefined)
      yield* Fiber.join(model)
    }),
  )

  it.live("runs multiple shell calls concurrently and keeps each caller waiting for its own completion", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const first = yield* gate(fixture.tmp.path, "first")
      const second = yield* gate(fixture.tmp.path, "second")
      const firstCaller = yield* fixture.session
        .shell({ sessionID: fixture.created.id, command: first.command })
        .pipe(Effect.forkScoped)
      yield* first.started
      const firstEvent = yield* started(fixture.session, fixture.created.id, first.command)
      const secondCaller = yield* fixture.session
        .shell({ sessionID: fixture.created.id, command: second.command })
        .pipe(Effect.forkScoped)
      yield* second.started
      const secondEvent = yield* started(fixture.session, fixture.created.id, second.command)

      expect(firstCaller.pollUnsafe()).toBeUndefined()
      expect(secondCaller.pollUnsafe()).toBeUndefined()
      expect(yield* fixture.session.messages({ sessionID: fixture.created.id, order: "asc" })).toMatchObject([
        { type: "shell", shellID: firstEvent.data.shell.id, status: "running", metadata: { background: true } },
        { type: "shell", shellID: secondEvent.data.shell.id, status: "running", metadata: { background: true } },
      ])

      yield* second.release
      yield* Fiber.join(secondCaller).pipe(Effect.timeout("5 seconds"))
      expect(firstCaller.pollUnsafe()).toBeUndefined()
      expect(yield* fixture.session.inbox(fixture.created.id)).toMatchObject([
        {
          payload: {
            metadata: { shellID: secondEvent.data.shell.id },
            text: expect.stringContaining("second finished"),
          },
        },
      ])
      yield* first.release
      yield* Fiber.join(firstCaller).pipe(Effect.timeout("5 seconds"))
      expect(
        (yield* fixture.session.inbox(fixture.created.id))
          .filter((item) => item.type === "synthetic")
          .map((item) => item.payload.metadata?.shellID),
      ).toEqual([secondEvent.data.shell.id, firstEvent.data.shell.id])
      expect(fixture.control.wakes).toEqual([])
      expect(fixture.control.drains).toEqual([])
    }),
  )

  it.live("routes shell completion to the moved Session while retaining output from its original Location", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const destination = Location.Ref.make({ directory: AbsolutePath.make((yield* tmpdirScoped()).path) })
      const command = yield* gate(fixture.tmp.path, "moved")
      const caller = yield* fixture.session
        .shell({ sessionID: fixture.created.id, command: command.command })
        .pipe(Effect.forkScoped)
      yield* command.started
      const event = yield* started(fixture.session, fixture.created.id, command.command)

      const bus = yield* Bus.Service
      const Done = Bus.ephemeral({ type: "test.shell.move.done", schema: {} })
      const readers = yield* Effect.forEach([fixture.created.location, destination], (ref) =>
        bus.subscribe([SessionEvent.Shell.Ended, SessionEvent.InboxEnqueued, Done]).pipe(
          Stream.takeUntil((event) => event.type === Done.type),
          Stream.runCollect,
          Effect.provideService(Location.Service, location(ref)),
          Effect.forkScoped({ startImmediately: true }),
        ),
      )
      // This fixture's runner does not drain move requests; project the actual move event instead.
      yield* bus.publish(SessionEvent.Moved, {
        sessionID: fixture.created.id,
        location: destination,
        projectID: fixture.created.projectID,
      })
      expect((yield* fixture.session.get(fixture.created.id)).location).toEqual(destination)
      yield* command.release
      yield* Fiber.join(caller).pipe(Effect.timeout("5 seconds"))
      yield* bus.publish(Done, {})

      const events = yield* Effect.forEach(readers, (reader) => Fiber.join(reader).pipe(Effect.timeout("5 seconds")))
      expect(events.map((items) => items.map((event) => event.type))).toEqual([
        [Done.type],
        ["session.shell.ended", "session.inbox.enqueued", Done.type],
      ])
      expect(events[1][0]).toMatchObject({
        data: { output: { output: expect.stringContaining("moved finished") } },
      })
      expect(
        (yield* fixture.session.messages({ sessionID: fixture.created.id })).find((message) => message.type === "shell"),
      ).toMatchObject({
        shellID: event.data.shell.id,
        status: "exited",
        exit: 0,
        output: { output: expect.stringContaining("moved finished") },
      })
      const inbox = yield* fixture.session.inbox(fixture.created.id)
      expect(inbox).toHaveLength(1)
      expect(inbox[0]).toMatchObject({
        type: "synthetic",
        payload: {
          text: expect.stringContaining("moved finished"),
          metadata: { shellID: event.data.shell.id, state: "completed" },
        },
      })
      expect(inbox[0]).not.toHaveProperty("payload.description")
      expect(fixture.control.wakes).toEqual([])
    }),
  )

  it.live("does not suppress a normal prompt wake while a shell is running or wake again when it completes", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const command = yield* gate(fixture.tmp.path, "prompt")
      const caller = yield* fixture.session
        .shell({ sessionID: fixture.created.id, command: command.command })
        .pipe(Effect.forkScoped)
      yield* command.started
      yield* started(fixture.session, fixture.created.id, command.command)

      const prompt = yield* fixture.session.prompt({ sessionID: fixture.created.id, text: "Continue while this runs" })
      yield* Deferred.await(fixture.control.started).pipe(Effect.timeout("5 seconds"))
      expect(fixture.control.wakes).toEqual([fixture.created.id])
      expect(caller.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(fixture.control.release, undefined)
      yield* fixture.execution.awaitIdle(fixture.created.id)
      expect(fixture.control.drains).toEqual([fixture.created.id])

      yield* command.release
      yield* Fiber.join(caller).pipe(Effect.timeout("5 seconds"))
      expect(fixture.control.wakes).toEqual([fixture.created.id])
      expect(yield* fixture.execution.active).toEqual(new Set())
      expect(yield* fixture.session.inbox(fixture.created.id)).toMatchObject([
        { id: prompt.id, type: "user" },
        { type: "synthetic", payload: { metadata: { source: "shell" } } },
      ])
    }),
  )

  for (const exit of [0, 7]) {
    it.live(`records output and admits one completion without waking the model after exit ${exit}`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup
        const command =
          process.platform === "win32"
            ? `Write-Output 'user output'; [Console]::Error.WriteLine('user error'); exit ${exit}`
            : `printf 'user output\\n'; printf 'user error\\n' >&2; exit ${exit}`
        yield* fixture.session.shell({ sessionID: fixture.created.id, command })

        const events = yield* log(fixture.session, fixture.created.id).pipe(Stream.runCollect)
        expect(events.map((event) => event.type)).toEqual([
          "session.created",
          "session.shell.started",
          "session.shell.ended",
          "session.inbox.enqueued",
        ])
        expect(events[1]).toMatchObject({ data: { shell: { metadata: { background: true } } } })
        const messages = yield* fixture.session.messages({ sessionID: fixture.created.id })
        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({
          type: "shell",
          command,
          status: "exited",
          exit,
          metadata: { background: true },
        })
        const message = messages[0]
        if (message?.type !== "shell") return yield* Effect.die("Missing shell projection")
        expect(message.time.completed).toBeDefined()
        expect(message.output?.output).toContain("user output")
        expect(message.output?.output).toContain("user error")
        expect(message.output?.truncated).toBe(false)

        const inbox = yield* fixture.session.inbox(fixture.created.id)
        expect(inbox).toHaveLength(1)
        expect(inbox[0]).toMatchObject({
          type: "synthetic",
          delivery: "steer",
          payload: {
            metadata: { source: "shell", shellID: message.shellID, state: "completed", exit, truncated: false },
          },
        })
        const completion = inbox[0]
        if (completion?.type !== "synthetic") return yield* Effect.die("Missing shell completion")
        expect(completion.payload.description).toBeUndefined()
        expect(completion.payload.text).toContain(command)
        expect(completion.payload.text).toContain("user output")
        expect(completion.payload.text).toContain("user error")
        expect(completion.payload.text).toContain(`exited with code ${exit}`)
        expect(fixture.control.wakes).toEqual([])
        expect(fixture.control.drains).toEqual([])

        const database = yield* Database.Service
        const bus = yield* Bus.Service
        yield* SessionInbox.promote(database.db, bus, fixture.created.id, "steer")
        expect(yield* fixture.session.inbox(fixture.created.id)).toEqual([])
        expect(yield* fixture.session.messages({ sessionID: fixture.created.id, order: "asc" })).toMatchObject([
          { type: "shell", status: "exited" },
          { type: "synthetic", text: completion.payload.text, metadata: completion.payload.metadata },
        ])

        // Rebuild the pre-delivery checkpoint from stored events, without live envelope metadata.
        yield* bus.remove(fixture.created.id)
        yield* database.db.delete(SessionTable).where(eq(SessionTable.id, fixture.created.id)).run().pipe(Effect.orDie)
        yield* Effect.forEach(events, (event) =>
          bus.replay({
            id: event.id,
            created: event.created,
            aggregateID: event.durable.aggregateID,
            seq: event.durable.seq,
            type: Bus.versionedType(event.type, event.durable.version),
            data: event.data,
          }),
        )
        expect(yield* fixture.session.messages({ sessionID: fixture.created.id })).toEqual(messages)
        expect(yield* fixture.session.inbox(fixture.created.id)).toEqual(inbox)
      }),
    )
  }

  it.live("records cancellation and admits its completion when a running shell is removed", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const command = yield* gate(fixture.tmp.path, "cancelled")
      const caller = yield* fixture.session
        .shell({ sessionID: fixture.created.id, command: command.command })
        .pipe(Effect.forkScoped)
      yield* command.started
      const event = yield* started(fixture.session, fixture.created.id, command.command)

      yield* fixture.shell.remove(event.data.shell.id)
      yield* Fiber.join(caller).pipe(Effect.timeout("5 seconds"))
      expect(yield* fixture.session.messages({ sessionID: fixture.created.id })).toMatchObject([
        { type: "shell", shellID: event.data.shell.id, status: "killed", time: { completed: expect.anything() } },
      ])
      const inbox = yield* fixture.session.inbox(fixture.created.id)
      expect(inbox).toMatchObject([
        {
          type: "synthetic",
          payload: {
            text: expect.stringContaining("Command cancelled"),
            metadata: { source: "shell", shellID: event.data.shell.id, state: "cancelled" },
          },
        },
      ])
      expect(inbox).toHaveLength(1)
      expect(fixture.control.wakes).toEqual([])
    }),
  )

  it.live("records a timed-out shell and admits its captured output without waking the model", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const command = yield* gate(fixture.tmp.path, "timeout")
      const caller = yield* fixture.session
        .shell({ sessionID: fixture.created.id, command: command.command })
        .pipe(Effect.forkScoped)
      yield* command.started
      const event = yield* started(fixture.session, fixture.created.id, command.command)

      yield* fixture.shell.timeout(event.data.shell.id, 1)
      yield* Fiber.join(caller).pipe(Effect.timeout("5 seconds"))
      expect(yield* fixture.session.messages({ sessionID: fixture.created.id })).toMatchObject([
        {
          type: "shell",
          shellID: event.data.shell.id,
          status: "timeout",
          output: { output: expect.stringContaining("timeout started") },
        },
      ])
      expect(yield* fixture.session.inbox(fixture.created.id)).toMatchObject([
        {
          type: "synthetic",
          payload: {
            text: expect.stringContaining("Command timed out"),
            metadata: { source: "shell", shellID: event.data.shell.id, state: "completed" },
          },
        },
      ])
      expect(fixture.control.wakes).toEqual([])
    }),
  )

  it.live("admits a spawn failure without waking the model before failing the caller", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      // Keep the Location initialized, but invalidate the real child's working directory.
      yield* Effect.promise(() => fs.rm(fixture.tmp.path, { recursive: true, force: true }))
      const command = "echo should-not-start"
      const exit = yield* fixture.session.shell({ sessionID: fixture.created.id, command }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* fixture.session.messages({ sessionID: fixture.created.id })).toEqual([])
      const inbox = yield* fixture.session.inbox(fixture.created.id)
      expect(inbox).toHaveLength(1)
      expect(inbox[0]).toMatchObject({
        type: "synthetic",
        payload: { text: expect.stringContaining(command), metadata: { source: "shell", state: "error" } },
      })
      expect(fixture.control.wakes).toEqual([])
      expect(fixture.control.drains).toEqual([])
    }),
  )

  it.live("keeps the shell and completion alive when the waiting caller is interrupted", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const command = yield* gate(fixture.tmp.path, "detached")
      const caller = yield* fixture.session
        .shell({ sessionID: fixture.created.id, command: command.command })
        .pipe(Effect.scoped, Effect.forkScoped)
      yield* command.started
      const event = yield* started(fixture.session, fixture.created.id, command.command)

      yield* Fiber.interrupt(caller).pipe(Effect.timeout("5 seconds"))
      const exit = yield* Fiber.await(caller)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(yield* fixture.shell.get(event.data.shell.id)).toMatchObject({ status: "running" })
      expect(yield* fixture.session.inbox(fixture.created.id)).toEqual([])

      yield* command.release
      yield* log(fixture.session, fixture.created.id, true).pipe(
        Stream.filter((event) => event.type === "session.inbox.enqueued"),
        Stream.runHead,
        Effect.timeout("5 seconds"),
      )
      expect(yield* fixture.session.messages({ sessionID: fixture.created.id })).toMatchObject([
        {
          type: "shell",
          shellID: event.data.shell.id,
          status: "exited",
          exit: 0,
          output: { output: expect.stringContaining("detached finished") },
        },
      ])
      expect(yield* fixture.session.inbox(fixture.created.id)).toMatchObject([
        {
          type: "synthetic",
          payload: {
            text: expect.stringContaining("detached finished"),
            metadata: { shellID: event.data.shell.id, state: "completed" },
          },
        },
      ])
      expect(fixture.control.wakes).toEqual([])
      expect(fixture.control.drains).toEqual([])
    }),
  )
})
