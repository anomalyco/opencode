import { MainPlugin } from "@opencode/plugin/desktop/main"
import { BrowserDesktop } from "./rpc"
import { createBrowserPane } from "./connection"

export default MainPlugin.define({
  id: "opencode.browser",
  rpc: BrowserDesktop.Definition,
  setup(ctx) {
    const browser = createBrowserPane(ctx)
    ctx.lifecycle.own(() => {
      void browser.dispose().catch(console.error)
    })
    return {
      async register(input, call) {
        await browser.register(input.bindingID, input, call.signal)
        return null
      },
      async command(input, call) {
        await browser.command(input.bindingID, input.action, call.signal)
        return null
      },
      async close(input) {
        await browser.close(input.bindingID)
        return null
      },
    }
  },
})
