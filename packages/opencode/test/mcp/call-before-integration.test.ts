import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"
import { McpCallContext, makeMcpFetch } from "../../src/mcp/index"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const file = path.join(test.directory, "plugin.ts")
    yield* Effect.all(
      [
        Effect.promise(() => Bun.write(file, source)),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
            JSON.stringify(
              {
                $schema: "https://opencode.ai/config.json",
                plugin: [pathToFileURL(file).href],
              },
              null,
              2,
            ),
          ),
        ),
      ],
      { discard: true, concurrency: 2 },
    )
    return yield* self
  })
}

const stubFetch = (calls: Array<RequestInit | undefined>) => async (_url: string | URL, init?: RequestInit) => {
  calls.push(init)
  return new Response("ok")
}

describe("mcp.call.before integration", () => {
  it.instance("plugin-supplied headers reach the transport fetch wrapper", () =>
    withProject(
      [
        "export default async () => ({",
        '  "mcp.call.before": async (input, output) => {',
        '    output.headers["x-session-id"] = input.sessionID',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service

        // Static config-style starting headers (already lowercased)
        const output = { headers: { authorization: "Bearer T" } as Record<string, string> }

        yield* plugin.trigger(
          "mcp.call.before",
          { server: "metrics", tool: "query", sessionID: "sess-1", callID: "call-1" },
          output,
        )

        expect(output.headers["authorization"]).toBe("Bearer T")
        expect(output.headers["x-session-id"]).toBe("sess-1")

        // Drive the resolved headers through makeMcpFetch, like the prompt loop does
        const fetchCalls: Array<RequestInit | undefined> = []
        const wrapped = makeMcpFetch(stubFetch(fetchCalls) as never)

        yield* Effect.promise(() =>
          McpCallContext.run(
            { server: "metrics", tool: "query", sessionID: "sess-1", callID: "call-1", headers: output.headers },
            () => wrapped("https://example.com/", { headers: { "x-static-header": "preset" } }),
          ),
        )

        expect(fetchCalls.length).toBe(1)
        expect(fetchCalls[0]?.headers).toEqual({
          authorization: "Bearer T",
          "x-session-id": "sess-1",
          "x-static-header": "preset",
        })
      }),
    ),
  )

  it.instance("headers mutated before a plugin throw still reach the transport fetch wrapper", () =>
    withProject(
      [
        "export default async () => ({",
        '  "mcp.call.before": async (_input, output) => {',
        '    output.headers["x-from-plugin"] = "before-throw"',
        '    throw new Error("boom")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service

        const output = { headers: { authorization: "Bearer T" } as Record<string, string> }

        // catchCause so a throwing plugin doesn't abort the tool call
        yield* plugin
          .trigger("mcp.call.before", { server: "metrics", tool: "query", sessionID: "s", callID: "c" }, output)
          .pipe(Effect.catchCause(() => Effect.succeed(output)))

        // Whatever the plugin wrote before throwing must still be present
        expect(output.headers["x-from-plugin"]).toBe("before-throw")

        const fetchCalls: Array<RequestInit | undefined> = []
        const wrapped = makeMcpFetch(stubFetch(fetchCalls) as never)

        yield* Effect.promise(() =>
          McpCallContext.run(
            { server: "metrics", tool: "query", sessionID: "s", callID: "c", headers: output.headers },
            () => wrapped("https://example.com/", { headers: { "x-static": "yes" } }),
          ),
        )

        expect(fetchCalls.length).toBe(1)
        expect(fetchCalls[0]?.headers).toEqual({
          authorization: "Bearer T",
          "x-from-plugin": "before-throw",
          "x-static": "yes",
        })
      }),
    ),
  )
})
