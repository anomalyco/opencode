import { Plugin } from "../plugin"
import { Share } from "../share/share"
import { Format } from "../format"
import { LSP } from "../lsp"
import { Snapshot } from "../snapshot"
import { FileWatcher } from "../file/watcher"

export async function InstanceBootstrap() {
  await Plugin.init()
  Share.init()
  Format.init()
  LSP.init()
  Snapshot.init()
  FileWatcher.init()
}
