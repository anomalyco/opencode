import { expect } from "bun:test"
import { McpCodeModeDefaultsPlugin } from "@opencode/core/plugin/mcp-codemode-defaults"
import type { Mcp } from "@opencode/schema/mcp"
import { Effect, type Types } from "effect"
import { it } from "../lib/effect"
import { host } from "./host"

it.effect("applies Code Mode defaults for known MCP servers unless codemode is configured", () =>
  Effect.gen(function* () {
    const cases: Array<{
      name: string
      server: Types.DeepMutable<Mcp.ServerConfig>
      codemode: boolean | undefined
      headers?: Record<string, string>
    }> = [
      {
        name: "executor remote",
        server: { type: "remote", url: "https://executor.sh/example/mcp?source=opencode" },
        codemode: false,
      },
      { name: "executor local", server: { type: "local", command: ["executor", "mcp"] }, codemode: false },
      {
        name: "cloudflare code mode",
        server: { type: "remote", url: "https://mcp.cloudflare.com/mcp/" },
        codemode: undefined,
      },
      {
        name: "cloudflare raw tools",
        server: { type: "remote", url: "https://mcp.cloudflare.com/mcp?codemode=false" },
        codemode: undefined,
      },
      {
        name: "cloudflare docs",
        server: { type: "remote", url: "https://docs.mcp.cloudflare.com/mcp" },
        codemode: undefined,
      },
      {
        name: "explicit true",
        server: { type: "remote", url: "https://mcp.cloudflare.com/mcp", codemode: true },
        codemode: true,
      },
      {
        name: "explicit false",
        server: { type: "remote", url: "https://executor.sh/example/mcp", codemode: false },
        codemode: false,
      },
      { name: "exa", server: { type: "remote", url: "https://mcp.exa.ai/mcp" }, codemode: undefined },
      { name: "unrelated", server: { type: "remote", url: "https://example.com/mcp" }, codemode: undefined },
      {
        name: "posthog",
        server: { type: "remote", url: "https://mcp.posthog.com/mcp" },
        codemode: undefined,
        headers: { "x-posthog-mcp-mode": "tools" },
      },
      {
        name: "posthog eu with auth",
        server: {
          type: "remote",
          url: "https://mcp-eu.posthog.com/mcp",
          headers: { Authorization: "Bearer phx_test" },
        },
        codemode: undefined,
        headers: { Authorization: "Bearer phx_test", "x-posthog-mcp-mode": "tools" },
      },
      {
        name: "posthog explicit code mode",
        server: { type: "remote", url: "https://mcp.us.posthog.com/mcp", codemode: true },
        codemode: true,
      },
      {
        name: "posthog mode in url",
        server: { type: "remote", url: "https://mcp.posthog.com/mcp?mode=cli" },
        codemode: undefined,
      },
      {
        name: "posthog mode header",
        server: { type: "remote", url: "https://mcp.posthog.com/mcp", headers: { "X-PostHog-MCP-Mode": "cli" } },
        codemode: undefined,
        headers: { "X-PostHog-MCP-Mode": "cli" },
      },
      {
        name: "posthog without code mode",
        server: { type: "remote", url: "https://mcp.posthog.com/mcp", codemode: false },
        codemode: false,
      },
    ]
    const servers: Record<string, Types.DeepMutable<Mcp.ServerConfig>> = Object.fromEntries(
      cases.map((test) => [test.name, test.server]),
    )
    const base = host()

    yield* McpCodeModeDefaultsPlugin.Plugin.effect(
      host({
        mcp: {
          ...base.mcp,
          transform: (transform) =>
            Effect.sync(() => {
              transform({
                list: () => Object.entries(servers),
                get: (name) => servers[name],
                set: () => {
                  throw new Error("unused")
                },
                update: (name, update) => {
                  const server = servers[name]
                  if (server) update(server)
                },
                remove: (name) => {
                  delete servers[name]
                },
              })
              return { dispose: Effect.void }
            }),
        },
      }),
    )

    cases.forEach((test) => {
      const server = servers[test.name]
      expect(server?.codemode).toBe(test.codemode)
      expect(server?.type === "remote" ? server.headers : undefined).toEqual(test.headers)
    })
  }),
)
