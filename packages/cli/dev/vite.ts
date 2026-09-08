import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin"

ensureSolidTransformPlugin()
if (process.argv[2] !== "serve") {
  process.env.OPENCODE_TUI_ENTRY = new URL("./tui.ts", import.meta.url).href
  // Vite must initialize before the CLI installs its process/error handling on Bun.
  await import("./tui")
}
await import("../src/index")
