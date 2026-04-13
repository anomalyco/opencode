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
  yield* Effect.all(
    [
      Plugin.Service.use((svc) => svc.init()),
      LSP.Service.use((svc) => svc.init()),
      ShareNext.Service.use((svc) => svc.init()),
      Format.Service.use((svc) => svc.init()),
      File.Service.use((svc) => svc.init()),
      FileWatcher.Service.use((svc) => svc.init()),
      Vcs.Service.use((svc) => svc.init()),
      Snapshot.Service.use((svc) => svc.init()),
    ].map((e) => Effect.forkDetach(e)),
    { concurrency: "unbounded" },
  )

  yield* Bus.Service.use((svc) =>
    svc.subscribeCallback(Command.Event.Executed, async (payload) => {
      if (payload.properties.name === Command.Default.INIT) {
        Project.setInitialized(Instance.project.id)
      }
    }),
  )
}).pipe(Effect.withSpan("InstanceBootstrap"))
