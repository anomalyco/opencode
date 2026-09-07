import { expect } from "bun:test"
import { NodeServices, NodeSocketServer } from "@effect/platform-node"
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { testEffect } from "../../../../core/test/lib/effect"
import { createSshController } from "./controller"
import { quote } from "./command"

const it = testEffect(Layer.merge(NodeServices.layer, FetchHttpClient.layer))

it.live(
  "saved hosts do not connect until requested and forgetting never starts SSH",
  Effect.gen(function* () {
    const saves: unknown[] = []
    const config = { id: "fixture", target: "unreachable.invalid", name: "Fixture" }
    const controller = yield* createSshController({
      configs: [config],
      binary: "unused",
      version: "2.0.0",
      save: (configs) =>
        Effect.sync(() => {
          saves.push(configs)
        }),
    })
    expect(yield* controller.resolve(config.id)).toBeNull()
    yield* controller.disconnect(config.id)
    expect((yield* controller.state()).servers[0]?.stage).toBe("disconnected")
    yield* controller.forget(config.id)
    expect((yield* controller.state()).servers).toEqual([])
    expect(saves).toEqual([[]])
  }),
)

it.live(
  "invalid commands fail without persisting an incomplete connection",
  Effect.gen(function* () {
    const controller = yield* createSshController({
      configs: [],
      binary: "unused",
      version: "2.0.0",
      save: () => Effect.die("must not save"),
    })
    const settled = yield* controller.changes().pipe(
      Stream.filter((state) => state.servers[0]?.stage === "failed"),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* controller.start({ id: "fixture", target: "ssh host whoami", name: "" }, 1)
    yield* Fiber.join(settled)
    const state = yield* controller.state()
    expect(state.servers[0]?.error).toBe("input")
    expect(state.servers[0]?.saved).toBe(false)
  }),
)

it.live(
  "a failed edit does not replace the saved connection",
  Effect.gen(function* () {
    const config = { id: "fixture", target: "devbox", name: "Original" }
    const saves: unknown[] = []
    const controller = yield* createSshController({
      configs: [config],
      binary: "unused",
      version: "2.0.0",
      save: (configs) =>
        Effect.sync(() => {
          saves.push(configs)
        }),
    })
    const settled = yield* controller.changes().pipe(
      Stream.filter((state) => state.servers[0]?.stage === "failed"),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* controller.start({ ...config, target: "ssh devbox whoami", name: "Invalid edit" }, 1)
    yield* Fiber.join(settled)
    expect((yield* controller.state()).servers[0]?.config).toEqual(config)
    yield* controller.forget("missing")
    expect(saves).toEqual([[config]])
  }),
)

it.live(
  "disconnect interrupts a live SSH handshake and releases endpoint waiters",
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const config = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "ssh-handshake-test-" }), "config")
    yield* fs.writeFileString(config, "")
    const connected = yield* Deferred.make<void>()
    const closed = yield* Deferred.make<void>()
    const server = yield* NodeSocketServer.make({ host: "127.0.0.1", port: 0 })
    if (server.address._tag !== "TcpAddress") return yield* Effect.die("missing port")
    yield* server
      .run((socket) =>
        socket
          .run(() => Effect.void, { onOpen: Deferred.succeed(connected, undefined).pipe(Effect.asVoid) })
          .pipe(Effect.ensuring(Deferred.succeed(closed, undefined)), Effect.ignore),
      )
      .pipe(Effect.forkScoped({ startImmediately: true }))
    const controller = yield* createSshController({
      configs: [],
      binary: "unused",
      version: "2.0.0",
      save: () => Effect.die("must not save"),
    })
    yield* controller.start(
      { id: "fixture", target: `ssh -F ${quote(config)} -p ${server.address.port} 127.0.0.1`, name: "" },
      1,
    )
    yield* Deferred.await(connected)
    const waiting = yield* controller.resolve("fixture").pipe(Effect.forkScoped)
    yield* controller.disconnect("fixture")
    yield* Deferred.await(closed)
    expect(yield* Fiber.join(waiting)).toBeNull()
    expect((yield* controller.state()).servers[0]?.stage).toBe("disconnected")
    return undefined
  }).pipe(Effect.timeout("10 seconds")),
)
