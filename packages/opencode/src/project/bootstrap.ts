import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { Snapshot } from "../snapshot"
import * as Project from "./project"
import * as Vcs from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util"
import { FileWatcher } from "@/file/watcher"
import { ShareNext } from "@/share"
import * as Effect from "effect/Effect"
import { Cause } from "effect"
import { Config } from "@/config"

export const InstanceBootstrap = Effect.gen(function* () {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  // everything depends on config so eager load it for nice traces
  yield* Config.Service.use((svc) => svc.get())
  // Plugin can mutate config so it has to be initialized before anything else.
  yield* Plugin.Service.use((svc) => svc.init())
  const fastGroup = [LSP.Service, ShareNext.Service, Format.Service, File.Service, Snapshot.Service]
  const deferredGroup = [FileWatcher.Service, Vcs.Service]

  // Fast group: await completion so downstream handlers can read these services safely.
  yield* Effect.all(
    fastGroup.map((s) => s.use((i) => i.init())),
    { concurrency: "unbounded" },
  ).pipe(Effect.withSpan("InstanceBootstrap.fast"))

  // Deferred group: init() forks expensive work (subscribe, git branch) into instance scope.
  // These calls return quickly; we fork with forkDaemon so failures don't kill the instance.
  for (const s of deferredGroup) {
    yield* Effect.forkDaemon(
      s.use((i) => i.init()).pipe(
        Effect.catchAllCause((cause) => Effect.sync(() => Log.Default.error("deferred service init failed", { cause: Cause.pretty(cause) })))
      ),
    )
  }

  yield* Bus.Service.use((svc) =>
    svc.subscribeCallback(Command.Event.Executed, async (payload) => {
      if (payload.properties.name === Command.Default.INIT) {
        Project.setInitialized(Instance.project.id)
      }
    }),
  )
}).pipe(Effect.withSpan("InstanceBootstrap"))
