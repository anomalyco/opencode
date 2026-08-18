import { expect } from "bun:test"
import { MCPCodeModeExclusionPlugin } from "@opencode-ai/core/plugin/mcp-codemode-exclusion"
import type { Mcp } from "@opencode-ai/schema/mcp"
import { Effect, type Types } from "effect"
import { it } from "../lib/effect"
import { host } from "./host"

it.effect("defaults only known Code Mode MCP servers to direct tools", () =>
  Effect.gen(function* () {
    const servers: Record<string, Types.DeepMutable<Mcp.ServerConfig>> = {
      executor: { type: "remote", url: "https://executor.sh/example/mcp?source=opencode" },
      "executor-local": { type: "local", command: ["executor", "mcp"] },
      cloudflare: { type: "remote", url: "https://mcp.cloudflare.com/mcp/" },
      "cloudflare-docs": { type: "remote", url: "https://docs.mcp.cloudflare.com/mcp" },
      explicit: { type: "remote", url: "https://mcp.cloudflare.com/mcp", codemode: true },
      "explicit-false": { type: "remote", url: "https://executor.sh/example/mcp", codemode: false },
      exa: { type: "remote", url: "https://mcp.exa.ai/mcp" },
      unrelated: { type: "remote", url: "https://example.com/mcp" },
    }
    const base = host()

    yield* MCPCodeModeExclusionPlugin.Plugin.effect(
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

    expect(servers.executor?.codemode).toBe(false)
    expect(servers["executor-local"]?.codemode).toBe(false)
    expect(servers.cloudflare?.codemode).toBe(false)
    expect(servers["cloudflare-docs"]?.codemode).toBeUndefined()
    expect(servers.explicit?.codemode).toBe(true)
    expect(servers["explicit-false"]?.codemode).toBe(false)
    expect(servers.exa?.codemode).toBeUndefined()
    expect(servers.unrelated?.codemode).toBeUndefined()
  }),
)
