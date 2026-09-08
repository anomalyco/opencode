/// <reference types="vite/client" />
import { host } from "@opencode-ai/cli/vite-host"

if (import.meta.hot) {
  import.meta.hot.on("vite:beforeFullReload", async () => {
    await host.stop?.()
    host.reset?.()
  })
}

const { run } = await import("../../tui/src/index")
await host.mount?.(run)
