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

export async function start(options: { onExit?: () => void } = {}) {
  await initYoga({ wasm: new URL(__TEXTJS_YOGA__, import.meta.url) })
  // Keys reach the app only once the visitor clicks the page to come back from DevTools, and never
  // while they type in one of its fields, so the site's own shortcuts keep working until then.
  const input = createHostInput()
  const stop = () => {
    root.unmount()
    input.dispose()
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
