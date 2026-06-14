import { describe, expect } from "bun:test"
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

describe("opencode mcp debug", () => {
  cliIt.live("uses the SDK protocol version in the initialize request", ({ opencode }) =>
    Effect.gen(function* () {
      const requests: unknown[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            async fetch(request) {
              requests.push(await request.json())
              return Response.json({})
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )

      const result = yield* opencode.spawn(["mcp", "debug", "test"], {
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            mcp: {
              test: {
                type: "remote",
                url: server.url.toString(),
                enabled: false,
              },
            },
          }),
        },
      })

      opencode.expectExit(result, 0)
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
        },
      })
    }),
  )
})
