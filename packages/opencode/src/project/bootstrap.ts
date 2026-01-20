import { Plugin } from "../plugin"
import { Share } from "../share/share"
import { Format } from "../format"
import { LSP } from "../lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"

const log = Log.create({ service: "bootstrap" })

export async function InstanceBootstrap() {
  log.info("bootstrapping", { directory: Instance.directory })

  // Run sync inits immediately (no await needed)
  Share.init()
  ShareNext.init()
  Format.init()
  FileWatcher.init()
  File.init()
  Vcs.init()

  // Run async inits in parallel
  const start = performance.now()
  await Promise.all([Plugin.init(), LSP.init()])
  log.info("async init complete", { duration: `${(performance.now() - start).toFixed(0)}ms` })

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
