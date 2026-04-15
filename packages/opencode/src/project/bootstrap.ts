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
  // #region motel debug
  yield* Effect.logInfo("bootstrap plugin init start", {
    "debug.session": "instance-bootstrap",
    "debug.hypothesis": "D",
    "debug.step": "before-plugin-init",
    "debug.label": "InstanceBootstrap awaiting Plugin.init",
  })
  // #endregion motel debug
  yield* Plugin.Service.use((svc) => svc.init())
  // #region motel debug
  yield* Effect.logInfo("bootstrap plugin init done", {
    "debug.session": "instance-bootstrap",
    "debug.hypothesis": "D",
    "debug.step": "after-plugin-init",
    "debug.label": "InstanceBootstrap finished Plugin.init",
  })
  // #endregion motel debug
  yield* Effect.all(
    [
      LSP.Service,
      ShareNext.Service,
      Format.Service,
      File.Service,
      FileWatcher.Service,
      Vcs.Service,
      Snapshot.Service,
    ].map((s) => Effect.forkDetach(s.use((i) => i.init()))),
  )

  yield* Bus.Service.use((svc) =>
    svc.subscribeCallback(Command.Event.Executed, async (payload) => {
      if (payload.properties.name === Command.Default.INIT) {
        Project.setInitialized(Instance.project.id)
      }
    }),
  )
}).pipe(Effect.withSpan("InstanceBootstrap"))
