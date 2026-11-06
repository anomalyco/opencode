import { initYoga } from "@textjs/core"
import { createHostInput } from "@textjs/app/experimental"
import { renderToConsole } from "@textjs/react"
import { EmbeddedOpenCode } from "../.upstream/opencode-console/embed"
import { createDemoClient } from "../.upstream/opencode-console/lib/demo"

// opencode.try(): OpenCode Lite, the OpenCode TUI built with Text.js, in sandbox mode. Its
// in-memory backend scripts the agent, so nothing runs and nothing is installed. The source comes
// from anomalyco/textjs (apps/opencode-console) at the commit script/build.ts pins. The site also
// starts it on its own when a visitor opens DevTools (src/lib/console-api.ts).

// Text.js 1.6 fetches Yoga's WebAssembly instead of carrying it inline. The build names the file
// after its contents (script/build.ts), and Bun doesn't resolve the loader's default
// `new URL("@textjs/core/yoga.wasm", import.meta.url)`, so load it from next to the chunks.
declare const __TEXTJS_YOGA__: string

export async function start(options: { away?: () => boolean; onExit?: () => void } = {}) {
  await initYoga({ wasm: new URL(__TEXTJS_YOGA__, import.meta.url) })
  // Text.js 1.6 counts a press as the click back from DevTools only within 300 ms of the window's
  // focus event, so it misses a visitor who came back while Lite loaded: their clicks on the page,
  // which already has focus, never reached Lite. Replay that focus for their next press, until
  // Text.js ships createHostInput({ away }), which does this itself. Registered first, so it runs
  // before createHostInput's own listener.
  const replay = (e: MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey) return
    document.removeEventListener("mousedown", replay, true)
    window.dispatchEvent(new FocusEvent("focus"))
  }
  if (options.away?.() && document.hasFocus()) document.addEventListener("mousedown", replay, true)
  // Keys reach the app only once the visitor clicks the page to come back from DevTools, and never
  // while they type in one of its fields, so the site's own shortcuts keep working until then.
  const input = createHostInput()
  const stop = () => {
    root.unmount()
    input.dispose()
    document.removeEventListener("mousedown", replay, true)
  }
  const exit = () => {
    stop()
    options.onExit?.()
  }
  // The app sets its own theme (OpenCode dark), like the native TUI.
  const root = await renderToConsole(<EmbeddedOpenCode client={createDemoClient()} onExit={exit} />, {
    responsive: true,
    input: input.engine,
  })
  return { stop }
}
