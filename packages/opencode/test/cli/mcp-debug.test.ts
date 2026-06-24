import { describe, expect } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { cliIt } from "../lib/cli-process"

describe("opencode mcp debug", () => {
  cliIt.concurrent(
    "does not disclose access token bytes",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const data = path.join(home, ".local", "share", "opencode")
        yield* Effect.promise(() => fs.mkdir(data, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(data, "mcp-auth.json"),
            JSON.stringify({
              github: {
                tokens: {
                  accessToken: "secret-access-token-prefix-and-remainder",
                  refreshToken: "refresh-token",
                  expiresAt: 4_102_444_800,
                },
                clientInfo: { clientId: "test-client" },
              },
            }),
          ),
        )

        const result = yield* opencode.spawn(["mcp", "debug", "github"], {
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              mcp: { github: { type: "remote", url: llm.url } },
            }),
          },
        })
        opencode.expectExit(result, 0)

        const output = result.stdout + result.stderr
        expect(output).toContain("Access token: ••••")
        expect(output).not.toContain("secret-access-token-prefix")
        expect(output).toContain("Expires: 2100-01-01T00:00:00.000Z")
        expect(output).toContain("Refresh token: present")
        expect(output).toContain("Client ID: test-client")
      }),
    60_000,
  )
})
