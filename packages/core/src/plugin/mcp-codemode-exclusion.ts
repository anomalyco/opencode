export * as McpCodeModeExclusionPlugin from "./mcp-codemode-exclusion.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

// These servers provide Code Mode, so expose them directly instead of nesting them inside OpenCode Code Mode.
const urls = [/^https:\/\/executor\.sh\/[^/]+\/mcp$/]

// PostHog wraps its tools in its own Code Mode tool unless the client pins "tools" mode with this header
// or `?mode=`. The header wins over the query parameter and leaves the URL, and credentials keyed by it, alone.
const posthog = /^mcp(?:-eu|\.us|\.eu)?\.posthog\.com$/
const mode = "x-posthog-mcp-mode"

export const Plugin = define({
  id: "opencode.mcp.codemode.exclusion",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.mcp.transform((editor) => {
      for (const [, server] of editor.list()) {
        if (server.type === "local") {
          if (server.codemode === undefined && server.command[0] === "executor" && server.command[1] === "mcp")
            server.codemode = false
          continue
        }
        if (!URL.canParse(server.url)) continue
        const url = new URL(server.url)
        const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}`
        if (server.codemode === undefined && urls.some((pattern) => pattern.test(endpoint))) server.codemode = false
        if (
          server.codemode !== false &&
          posthog.test(url.hostname) &&
          !url.searchParams.has("mode") &&
          !Object.keys(server.headers ?? {}).some((key) => key.toLowerCase() === mode)
        )
          server.headers = { ...server.headers, [mode]: "tools" }
      }
    })
  }),
})
