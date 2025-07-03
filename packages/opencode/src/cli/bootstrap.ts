import { App } from "../app/app"
import { ConfigHooks } from "../config/hooks"
import { FileWatcher } from "../file/watch"
import { Format } from "../format"
import { LSP } from "../lsp"
import { Share } from "../share/share"

export async function bootstrap<T>(
  input: App.Input,
  cb: (app: App.Info) => Promise<T>,
) {
  return App.provide(input, async (app) => {
    Share.init()
    Format.init()
    ConfigHooks.init()
    LSP.init()
    FileWatcher.init()

    return cb(app)
  })
}
