import path from "node:path"
import { Context, Effect, Exit, Layer, Scope } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { AbsolutePath } from "@opencode/core/schema"
import { Shell } from "@opencode/core/shell"
import { Detaching } from "@opencode/core/detaching"
import { Bus } from "@opencode/core/bus"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { LocationLifecycle } from "@opencode/core/location-lifecycle"
import { Global } from "@opencode/util/global"
import { hostEnvironmentLayer } from "./environment"
import { location } from "./location"
import { fakeDaemon } from "./persistent-pty-daemon"
import { tmpdirScoped } from "./tmpdir"

// One fake daemon and data directory shared by every Location (and server) a test builds.
export const daemonShells = Effect.fn(function* () {
  const daemon = yield* fakeDaemon()
  const data = (yield* tmpdirScoped()).path
  const global = Global.layerWith({ data, state: path.join(data, "state") })
  const context = yield* Layer.build(
    AppNodeBuilder.build(PersistentPty.configured(daemon.options), [Global.node.replace(global)]),
  )
  const pty = Context.get(context, PersistentPty.Service)
  let spawned = 0
  const environment = Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const host = yield* Environment.Service
      return Environment.Service.of({
        ...host,
        spawner: ChildProcessSpawner.make(() =>
          Effect.sync(() => spawned++).pipe(Effect.andThen(Effect.die("the spawner must not be used"))),
        ),
      })
    }),
  ).pipe(Layer.provide(hostEnvironmentLayer))
  // `server` shares one server's daemon commands between Locations; without it the Location gets a server of its own.
  const shellLayer = (directory: string, server?: Shell.DaemonInterface) =>
    AppNodeBuilder.build(LayerNode.group([Shell.node, LocationLifecycle.node, Bus.node, Detaching.node]), [
      ...(server ? [Shell.daemonNode.replace(Layer.succeed(Shell.Daemon, server))] : []),
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of(location(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
        ),
      ),
      Global.node.replace(global),
      Config.node.replace(Config.testLayer()),
      Environment.node.replace(environment),
      PersistentPty.node.replace(Layer.succeed(PersistentPty.Service, pty)),
    ])
  // The server that `openLocation` Locations share, as long as the test runs.
  const serverContext = yield* Layer.build(
    AppNodeBuilder.build(LayerNode.group([Shell.daemonNode, Bus.node]), [
      Global.node.replace(global),
      PersistentPty.node.replace(Layer.succeed(PersistentPty.Service, pty)),
    ]),
  )
  const server = Context.get(serverContext, Shell.Daemon)
  // A Location's Shell, on a server of its own, that stays open for the rest of the test.
  const openShell = (directory: string) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(shellLayer(directory))
      return Context.get(context, Shell.Service)
    })
  // A Location's Shell and its services, closed by `close` as a reload or an eviction does while the server runs.
  const openLocation = (directory: string) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(shellLayer(directory, server), scope)
      return {
        shell: Context.get(context, Shell.Service),
        bus: Context.get(context, Bus.Service),
        close: Context.get(context, LocationLifecycle.Service).shutdown.pipe(
          Effect.andThen(Scope.close(scope, Exit.void)),
        ),
      }
    })
  // Runs `body` against the Location's Shell, then closes it as the server shutting down for a restart does.
  const withShell = <A, E>(
    directory: string,
    body: (shell: Shell.Interface) => Effect.Effect<A, E, LocationLifecycle.Service | Bus.Service>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const shell = yield* Shell.Service
        const detaching = yield* Detaching.Service
        const result = yield* body(shell)
        yield* detaching.begin
        return result
      }).pipe(Effect.provide(shellLayer(directory))),
    )
  const directory = (yield* tmpdirScoped()).path
  return {
    daemon,
    data,
    directory,
    global,
    pty,
    withShell,
    openShell,
    openLocation,
    // Where the server's daemon commands report.
    serverBus: Context.get(serverContext, Bus.Service),
    spawned: () => spawned,
    created: () => daemon.requests.filter((request) => request.op === "create_pipe"),
    signals: (id: number) =>
      daemon.requests.flatMap((request) => (request.op === "signal" && request.id === id ? [request.signal] : [])),
  }
})

// Polls in real time until `check` holds: the fake daemon answers over a socket, which the test clock does not drive.
export const until = (check: (() => boolean) | Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 2_000; attempt++) {
      if (typeof check === "function" ? check() : yield* check) return
      yield* Effect.promise(() => Bun.sleep(2))
    }
    return yield* Effect.die(new Error("condition never held"))
  })
