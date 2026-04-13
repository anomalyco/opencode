import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { FileWatcher } from "@/file/watcher"
import { ShareNext } from "@/share/share-next"
import * as Effect from "effect/Effect"

export const InstanceBootstrap = Effect.gen(function* () {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  yield* Plugin.Service.use((svc) => svc.init())
  yield* ShareNext.Service.use((svc) => svc.init()).pipe(Effect.forkDetach)
  yield* Format.Service.use((svc) => svc.init()).pipe(Effect.forkDetach)
  yield* LSP.Service.use((svc) => svc.init())
  yield* File.Service.use((svc) => svc.init()).pipe(Effect.forkDetach)
  yield* FileWatcher.Service.use((svc) => svc.init()).pipe(Effect.forkDetach)
  yield* Vcs.Service.use((svc) => svc.init()).pipe(Effect.forkDetach)
  yield* Snapshot.Service.use((svc) => svc.init()).pipe(Effect.forkDetach)

  yield* Bus.Service.use((svc) =>
    svc.subscribeCallback(Command.Event.Executed, async (payload) => {
      if (payload.properties.name === Command.Default.INIT) {
        Project.setInitialized(Instance.project.id)
      }
    }),
  )
}).pipe(Effect.withSpan("InstanceBootstrap"))
