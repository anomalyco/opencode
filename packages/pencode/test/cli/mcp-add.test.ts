import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { cliIt } from "../lib/cli-process"

describe("pencode mcp add (non-interactive subprocess)", () => {
  cliIt.concurrent(
    "adds a remote server with HTTP headers",
    ({ home, pencode }) =>
      Effect.gen(function* () {
        const result = yield* pencode.spawn([
          "mcp",
          "add",
          "github",
          "--url",
          "https://example.com/mcp",
          "--header",
          "Authorization=Bearer {env:GITHUB_TOKEN}",
          "--header",
          "X-Option=one=two",
        ])
        pencode.expectExit(result, 0)

        const config = yield* Effect.promise(() =>
          Bun.file(path.join(home, ".config", "pencode", "pencode.json")).json(),
        )
        expect(config.mcp.github).toEqual({
          type: "remote",
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Bearer {env:GITHUB_TOKEN}",
            "X-Option": "one=two",
          },
        })
      }),
    60_000,
  )

  cliIt.concurrent(
    "adds a local server while preserving argv and environment values",
    ({ home, pencode }) =>
      Effect.gen(function* () {
        const result = yield* pencode.spawn([
          "mcp",
          "add",
          "local",
          "--env",
          "API_KEY=secret",
          "--env",
          "VALUE=one=two",
          "--",
          "npx",
          "-y",
          "@example/server",
          "--label",
          "two words",
        ])
        pencode.expectExit(result, 0)

        const config = yield* Effect.promise(() =>
          Bun.file(path.join(home, ".config", "pencode", "pencode.json")).json(),
        )
        expect(config.mcp.local).toEqual({
          type: "local",
          command: ["npx", "-y", "@example/server", "--label", "two words"],
          environment: {
            API_KEY: "secret",
            VALUE: "one=two",
          },
        })
      }),
    60_000,
  )
})
