import { App } from "../app/app"
import { ConfigHooks } from "../config/hooks"
import { Format } from "../format"
import { Share } from "../share/share"

export async function bootstrap<T>(
  input: App.Input,
  cb: (app: App.Info) => Promise<T>,
) {
  return App.provide(input, async (app) => {
    Share.init()
    Format.init()
    ConfigHooks.init()

    return cb(app)
  })
}
