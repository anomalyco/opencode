import { Plugin } from "../plugin"
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
import { Filesystem } from "@/util/filesystem"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { workspace: Instance.workspace })
  await Plugin.init()
  ShareNext.init()
  Format.init()
  if (await Filesystem.exists(Instance.workspace)) {
    await LSP.init()
    FileWatcher.init()
    File.init()
    Vcs.init()
  }
  Snapshot.init()
  Truncate.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
