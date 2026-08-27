import { expect } from "bun:test"
import { MCPCodeModeExclusionPlugin } from "@opencode-ai/core/plugin/mcp-codemode-exclusion"
import type { Mcp } from "@opencode-ai/schema/mcp"
import { Effect, type Types } from "effect"
import { it } from "../lib/effect"
import { host } from "./host"

it.effect("defaults only known Code Mode MCP servers to direct tools", () =>
  Effect.gen(function* () {
    const cases: Array<{
      name: string
      server: Types.DeepMutable<Mcp.ServerConfig>
      codemode: boolean | undefined
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
    ]
    const servers: Record<string, Types.DeepMutable<Mcp.ServerConfig>> = Object.fromEntries(
      cases.map((test) => [test.name, test.server]),
    )
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

    cases.forEach((test) => expect(servers[test.name]?.codemode).toBe(test.codemode))
  }),
)
