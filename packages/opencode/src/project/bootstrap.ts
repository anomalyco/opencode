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
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"
import { Rpc } from "@/util/rpc"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  Rpc.progress("Initializing plugins...")
  await Plugin.init()
  Rpc.progress("Initializing share...")
  Share.init()
  ShareNext.init()
  Rpc.progress("Initializing formatter...")
  Format.init()
  Rpc.progress("Initializing LSP servers...")
  await LSP.init()
  Rpc.progress("Initializing file watcher...")
  FileWatcher.init()
  File.init()
  Rpc.progress("Initializing VCS...")
  Vcs.init()
  Snapshot.init()
  Truncate.init()
  Rpc.progress("Bootstrap complete")

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
