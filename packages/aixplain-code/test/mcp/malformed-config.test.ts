import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { MCP } from "@/mcp/index"
import type { MCP as MCPNS } from "../../src/mcp/index"
import { Config } from "@/config/config"
import { McpAuth } from "@/mcp/auth"
import { Bus } from "@/bus"
import { AppFileSystem } from "@aixplain/core/filesystem"
import { CrossSpawnSpawner } from "@aixplain/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

// #198: an entry with no usable `type` used to be dropped from both the connect
// loop and the status projection, so `/mcps`, `/status` and `mcp list` showed
// nothing at all. `dialog-mcp.tsx` renders `failed` rows perfectly well — the
// empty state is the one result users read as "this feature does not exist", so
// a config we cannot start must still occupy a row.

const it = testEffect(MCP.defaultLayer)

// Config loading now rejects a typeless entry outright, so the only way to
// reach the runtime backstop is to hand MCP a config that never went through
// the parser — which is exactly the case it exists for: a merged remote/global
// fragment, a stale cached config, a later schema change.
const withConfig = (info: object) =>
  MCP.layer.pipe(
    Layer.provide(McpAuth.layer),
    Layer.provide(Bus.layer),
    Layer.provide(Layer.mock(Config.Service)({ get: () => Effect.succeed(info as Config.Info) })),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  )

testEffect(withConfig({ mcp: { github: { command: ["npx"], enabled: true } } })).instance(
  "reports an entry with no type as failed rather than omitting it",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const status = yield* mcp.status()

        expect(Object.keys(status)).toContain("github")
        const github = status["github"]
        expect(github?.status).toBe("failed")
        // The row has to carry the fix, not just the fact of failure.
        expect(github?.status === "failed" && github.error).toContain("command")
      }),
    ),
)

it.instance(
  "reports the legacy `{ enabled: false }` shorthand as disabled, not failed",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const status = yield* mcp.status()

        expect(status["legacy"]?.status).toBe("disabled")
      }),
    ),
  { config: { mcp: { legacy: { enabled: false } } } },
)
