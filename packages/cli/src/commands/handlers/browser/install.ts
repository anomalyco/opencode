import { intro, log, outro, spinner } from "@clack/prompts"
import { Effect } from "effect"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { BrowserExtension } from "../../../services/browser-extension"
import { ServiceConfig } from "../../../services/service-config"
import { handlePromptErrors } from "../../../ui/prompt"

// How long install waits for the extension's first connection before leaving it to `status`.
const WAIT_MS = 3 * 60_000

export default Runtime.handler(
  Commands.commands.browser.commands.install,
  Effect.fn("cli.browser.install")(
    function* () {
      intro("OpenCode Browser")
      const started = Date.now()
      const installed = yield* BrowserExtension.install()
      if (!installed.length) {
        log.warn("No supported browser found. Install Chrome, Edge, Brave, Opera, Vivaldi, Arc, or Helium, then run this again.")
        outro("Nothing to set up")
        return
      }
      log.success(`Helper registered for ${installed.map((browser) => browser.name).join(", ")}`)

      const control = yield* BrowserExtension.configureBrowserControl()
      log.success(
        control.status === "added"
          ? `Browser Control MCP added to ${control.file}`
          : control.status === "updated"
            ? `Browser Control MCP "${control.name}" now accepts OpenCode Browser`
            : `Browser Control MCP already configured ("${control.name}")`,
      )

      yield* Service.ensure(yield* ServiceConfig.options())
      log.success("opencode background service is running")

      const opened = yield* BrowserExtension.openStore(installed)
      if (opened) log.step(`Opened OpenCode Browser in ${opened}. Click "Add to Chrome", then open it from the toolbar.`)
      if (!opened)
        log.step(
          "Add the extension: load packages/browser-extension/dist unpacked from your browser's extensions page (Developer mode), then click its toolbar icon.",
        )

      if (!process.stdout.isTTY) {
        outro("Run `opencode browser status` to check the connection")
        return
      }
      const progress = spinner()
      progress.start("Waiting for OpenCode Browser to connect (open its side panel)")
      const connected = yield* Effect.gen(function* () {
        while (Date.now() - started < WAIT_MS) {
          const time = yield* BrowserExtension.lastConnected()
          if (time && time >= started) return true
          yield* Effect.sleep("1 second")
        }
        return false
      })
      progress.stop(connected ? "OpenCode Browser connected" : "Still waiting. Check later with `opencode browser status`", connected ? 0 : 1)
      outro(connected ? "You're set. Press ⌘⇧. (Ctrl+Shift+.) in your browser to open the side panel." : "Setup complete")
    },
    (effect) => handlePromptErrors(effect),
  ),
)
