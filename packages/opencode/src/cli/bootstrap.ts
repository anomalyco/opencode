import { App } from "../app/app"
import { ConfigHooks } from "../config/hooks"
import { Format } from "../format"
import { LSP } from "../lsp"
import { Plugin } from "../plugin"
import { Share } from "../share/share"
import { Snapshot } from "../snapshot"
import { MCP } from "../mcp"

export async function bootstrap<T>(input: App.Input, cb: (app: App.Info) => Promise<T>) {
  return App.provide(input, async (app) => {
    Share.init()
    Format.init()
    Plugin.init()
    ConfigHooks.init()
    LSP.init()
    Snapshot.init()

    // Initialize MCP servers early so tools are available immediately
    MCP.clients().catch(() => {
      // Ignore errors during startup - MCP servers will be retried when needed
    })

    return cb(app)
  })
}
