export * as McpCodeModeDefaultsPlugin from "./mcp-codemode-defaults.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

// Defaults that make known MCP servers work well with OpenCode Code Mode, so a server's own Code Mode never ends up
// nested inside OpenCode's. A server with `codemode` set in config is left exactly as configured.

// These servers are Code Mode themselves, so OpenCode Code Mode is turned off for them (`codemode: false`).
const urls = [/^https:\/\/executor\.sh\/[^/]+\/mcp$/]

// PostHog wraps all of its tools in one server-side Code Mode tool unless the client asks for "tools" mode, so OpenCode
// Code Mode stays on and PostHog's is turned off. PostHog also reads `?mode=`, but the header wins over it and leaves
// the URL, which stored credentials are keyed by, unchanged.
const posthog = /^mcp(?:-eu|\.us|\.eu)?\.posthog\.com$/
const mode = "x-posthog-mcp-mode"

export const Plugin = define({
  id: "opencode.mcp.codemode.defaults",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.mcp.transform((editor) => {
      for (const [, server] of editor.list()) {
        if (server.codemode !== undefined) continue
        if (server.type === "local") {
          if (server.command[0] === "executor" && server.command[1] === "mcp") server.codemode = false
          continue
        }
        if (!URL.canParse(server.url)) continue
        const url = new URL(server.url)
        const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}`
        if (urls.some((pattern) => pattern.test(endpoint))) server.codemode = false
        if (
          posthog.test(url.hostname) &&
          !url.searchParams.has("mode") &&
          !Object.keys(server.headers ?? {}).some((key) => key.toLowerCase() === mode)
        )
          server.headers = { ...server.headers, [mode]: "tools" }
      }
    })
  }),
})
