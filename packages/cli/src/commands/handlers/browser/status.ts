import { EOL } from "os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { BrowserExtension } from "../../../services/browser-extension"

export default Runtime.handler(
  Commands.commands.browser.commands.status,
  Effect.fn("cli.browser.status")(function* () {
    const registered = yield* BrowserExtension.registered()
    const connected = yield* BrowserExtension.lastConnected()
    const control = yield* BrowserExtension.browserControlConfigured()
    process.stdout.write(
      [
        registered.length
          ? `Helper:           registered for ${registered.map((browser) => browser.name).join(", ")}`
          : "Helper:           not registered. Run `opencode browser install`.",
        connected
          ? `Extension:        last connected ${new Date(connected).toLocaleString()}`
          : "Extension:        has not connected yet",
        control ? `Browser Control:  MCP server "${control}" configured` : "Browser Control:  MCP server not configured",
      ].join(EOL) + EOL,
    )
  }),
)
