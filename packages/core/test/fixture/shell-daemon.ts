import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { AbsolutePath } from "@opencode/core/schema"
import { Shell } from "@opencode/core/shell"
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
  const shellLayer = (directory: string) =>
    AppNodeBuilder.build(Shell.node, [
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
  // Runs `body` against the Location's Shell, then closes it as a restart or an eviction would.
  // A Location's Shell that stays open for the rest of the test.
  const openShell = (directory: string) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(shellLayer(directory))
      return Context.get(context, Shell.Service)
    })
  const withShell = <A, E>(directory: string, body: (shell: Shell.Interface) => Effect.Effect<A, E>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const shell = yield* Shell.Service
        return yield* body(shell)
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
    spawned: () => spawned,
    created: () => daemon.requests.filter((request) => request.op === "create_pipe"),
    signals: (id: number) =>
      daemon.requests.flatMap((request) => (request.op === "signal" && request.id === id ? [request.signal] : [])),
  }
})
