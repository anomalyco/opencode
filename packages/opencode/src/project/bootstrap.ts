import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "@/lsp/lsp"
import { File } from "../file"
import { Snapshot } from "../snapshot"
import * as Project from "./project"
import * as Vcs from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { InstanceState } from "@/effect/instance-state"
import { FileWatcher } from "@/file/watcher"
import { ShareNext } from "@/share/share-next"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { Service } from "./bootstrap-service"

export { Service } from "./bootstrap-service"
export type { Interface } from "./bootstrap-service"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // Yield each bootstrap dep at layer init so `run` itself has R = never.
    // InstanceStore imports only the lightweight tag from bootstrap-service.ts,
    // so it can depend on bootstrap without importing this implementation graph.
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const file = yield* File.Service
    const fileWatcher = yield* FileWatcher.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const plugin = yield* Plugin.Service
    const shareNext = yield* ShareNext.Service
    const snapshot = yield* Snapshot.Service
    const vcs = yield* Vcs.Service

    const run = Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* Effect.logInfo("bootstrapping", { directory: ctx.directory })
      // everything depends on config so eager load it for nice traces
      yield* config.get()
      // Plugin can mutate config so it has to be initialized before anything else.
      yield* plugin.init()
      yield* Effect.all(
        [lsp, shareNext, format, file, fileWatcher, vcs, snapshot].map((s) => Effect.forkDetach(s.init())),
      ).pipe(Effect.withSpan("InstanceBootstrap.init"))

      const projectID = ctx.project.id
      yield* bus.subscribeCallback(Command.Event.Executed, async (payload) => {
        if (payload.properties.name === Command.Default.INIT) {
          Project.setInitialized(projectID)
        }
      })
    }).pipe(Effect.withSpan("InstanceBootstrap"))

    return Service.of({ run })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide([
    Bus.layer,
    Config.defaultLayer,
    File.defaultLayer,
    FileWatcher.defaultLayer,
    Format.defaultLayer,
    LSP.defaultLayer,
    Plugin.defaultLayer,
    Project.defaultLayer,
    ShareNext.defaultLayer,
    Snapshot.defaultLayer,
    Vcs.defaultLayer,
  ]),
)

export * as InstanceBootstrap from "./bootstrap"
