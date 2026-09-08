/// <reference types="vite/client" />
import { host } from "@opencode-ai/cli/vite-host"
import { resetErrorBoundaries } from "solid-js"

if (import.meta.hot) {
  // Replacing a component does not clear an error already caught by its parent boundary.
  import.meta.hot.on("vite:afterUpdate", resetErrorBoundaries)
  import.meta.hot.on("vite:beforeFullReload", async () => {
    await host.stop?.()
    host.reset?.()
  })
}

const { run } = await import("../../tui/src/index")
await host.mount?.(run)
