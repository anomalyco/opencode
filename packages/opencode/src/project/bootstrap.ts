import { Plugin } from "../plugin"
import { Share } from "../share/share"
import { Format } from "../format"
import { LSP } from "../lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Flag } from "../flag/flag"

export async function InstanceBootstrap() {
  if (Flag.OPENCODE_EXPERIMENTAL_NO_BOOTSTRAP) return
  await Plugin.init()
  Share.init()
  Format.init()
  LSP.init()
  FileWatcher.init()
  File.init()
}
