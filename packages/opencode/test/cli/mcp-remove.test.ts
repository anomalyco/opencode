import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { parse } from "jsonc-parser"
import path from "path"
import { cliIt } from "../lib/cli-process"

const globalConfigPath = (home: string) => path.join(home, ".config", "opencode", "opencode.json")

describe("opencode mcp remove (non-interactive subprocess)", () => {
  cliIt.concurrent(
    "removes a server added in the same home",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const added = yield* opencode.spawn(["mcp", "add", "github", "--url", "https://example.com/mcp"])
        opencode.expectExit(added, 0)

        const removed = yield* opencode.spawn(["mcp", "remove", "github"])
        opencode.expectExit(removed, 0)

        const config = yield* Effect.promise(() => Bun.file(globalConfigPath(home)).json())
        expect(config.mcp.github).toBeUndefined()
      }),
    60_000,
  )

  cliIt.concurrent(
    "keeps sibling servers and comments intact",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const configWithComments = `{
  // provider hints live here
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    // github remote
    "github": { "type": "remote", "url": "https://example.com/mcp" },
    "local-one": { "type": "local", "command": ["npx"] }
  }
}`
        yield* Effect.promise(() =>
          Bun.write(globalConfigPath(home), configWithComments),
        )

        const removed = yield* opencode.spawn(["mcp", "remove", "github"])
        opencode.expectExit(removed, 0)

        const text = yield* Effect.promise(() => Bun.file(globalConfigPath(home)).text())
        expect(text).toContain("// provider hints live here")
        expect(text).toContain('"$schema"')
        const config = parse(text) as { mcp: Record<string, unknown> }
        expect(config.mcp.github).toBeUndefined()
        expect(config.mcp["local-one"]).toEqual({ type: "local", command: ["npx"] })
      }),
    60_000,
  )

  cliIt.concurrent(
    "fails when the server does not exist",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn(["mcp", "remove", "missing-server"])
        opencode.expectExit(result, 1)
      }),
    60_000,
  )
})
