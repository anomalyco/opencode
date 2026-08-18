export * as MCPCodeModeExclusionPlugin from "./mcp-codemode-exclusion.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"

// These servers provide Code Mode, so expose them directly instead of nesting them inside OpenCode Code Mode.
const urls = [/^https:\/\/mcp\.cloudflare\.com\/mcp$/, /^https:\/\/executor\.sh\/[^/]+\/mcp$/]

export const Plugin = define({
  id: "opencode.mcp.codemode-exclusion",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.mcp.transform((draft) => {
      for (const [, server] of draft.list()) {
        if (server.codemode !== undefined) continue
        if (server.type === "local") {
          if (server.command[0] === "executor" && server.command[1] === "mcp") server.codemode = false
          continue
        }
        if (!URL.canParse(server.url)) continue
        const url = new URL(server.url)
        const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}`
        if (urls.some((pattern) => pattern.test(endpoint))) server.codemode = false
      }
    })
  }),
})
