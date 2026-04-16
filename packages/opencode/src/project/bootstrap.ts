import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { Snapshot } from "../snapshot"
import * as Project from "./project"
import * as Vcs from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Plugin } from "../plugin"
import { Log } from "@/util"
import { FileWatcher } from "@/file/watcher"
import { ShareNext } from "@/share"
import * as Effect from "effect/Effect"
import { Config } from "@/config"

export const InstanceBootstrap = Effect.gen(function* () {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  yield* Effect.all(
    [
      Config.Service.use((i) => i.get()),
      ...[
        Plugin.Service,
        LSP.Service,
        ShareNext.Service,
        Format.Service,
        File.Service,
        FileWatcher.Service,
        Vcs.Service,
        Snapshot.Service,
      ].map((s) => s.use((i) => i.init())),
    ].map((e) => Effect.forkDetach(e)),
  ).pipe(Effect.withSpan("InstanceBootstrap.init"))

  yield* Bus.Service.use((svc) =>
    svc.subscribeCallback(Command.Event.Executed, async (payload) => {
      if (payload.properties.name === Command.Default.INIT) {
        Project.setInitialized(Instance.project.id)
      }
    }),
  )
}).pipe(Effect.withSpan("InstanceBootstrap"))
