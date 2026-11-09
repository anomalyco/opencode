import { renderToConsole } from "@textjs/react"
import { EmbeddedOpenCode } from "../.upstream/opencode-console/embed"
import { createDemoClient } from "../.upstream/opencode-console/lib/demo"

// opencode.try(): OpenCode Lite, the OpenCode TUI built with Text.js, in sandbox mode. Its
// in-memory backend scripts the agent, so nothing runs and nothing is installed. The source comes
// from anomalyco/textjs (apps/opencode-console) at the commit script/build.ts pins.

export async function start() {
  // The app sets its own theme (OpenCode dark), like the native TUI.
  const root = await renderToConsole(<EmbeddedOpenCode client={createDemoClient()} onExit={() => root.unmount()} />, {
    responsive: true,
  })
  return root
}
