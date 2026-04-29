import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "@/lsp/lsp"
import { File } from "../file"
import { Snapshot } from "../snapshot"
import * as Project from "./project"
import * as Vcs from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import * as Log from "@opencode-ai/core/util/log"
import { FileWatcher } from "@/file/watcher"
import { ShareNext } from "@/share/share-next"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import { Config } from "@/config/config"

const log = Log.create({ service: "bootstrap" })

export const InstanceBootstrap = Effect.gen(function* () {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  // everything depends on config so eager load it for nice traces
  yield* Config.Service.use((svc) => svc.get())
  // Plugin can mutate config so it has to be initialized before anything else.
  yield* Plugin.Service.use((svc) => svc.init())
  yield* Effect.all(
    [
      LSP.Service,
      ShareNext.Service,
      Format.Service,
      File.Service,
      FileWatcher.Service,
      Vcs.Service,
      Snapshot.Service,
    ].map((s) =>
      s
        .use((i) => i.init())
        .pipe(
          Effect.catchCause((cause) => {
            log.error("service init failed", { service: s, cause: Cause.pretty(cause) })
            return Effect.void
          }),
          Effect.fork,
        ),
    ),
  ).pipe(Effect.withSpan("InstanceBootstrap.init"))

  yield* Bus.Service.use((svc) =>
    svc.subscribeCallback(Command.Event.Executed, async (payload) => {
      if (payload.properties.name === Command.Default.INIT) {
        Project.setInitialized(Instance.project.id)
      }
    }),
  )
}).pipe(Effect.withSpan("InstanceBootstrap"))
