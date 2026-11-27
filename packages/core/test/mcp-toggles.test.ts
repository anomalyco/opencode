import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { McpToggles } from "@opencode/core/mcp/toggles"
import { AbsolutePath } from "@opencode/core/schema"
import { tmpdirScoped } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { Database } from "../src/database/database"
import { Bus } from "../src/bus"

// The application graph a server builds: McpToggles lives beside the Location map, not inside a Location.
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, LocationServiceMap.node, McpToggles.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

const config = (port: number, disabled: boolean) =>
  JSON.stringify({
    mcp: { servers: { remote: { type: "remote", url: `http://127.0.0.1:${port}/mcp`, oauth: false, disabled } } },
  })

describe("MCP toggles", () => {
  for (const operation of ["disconnect", "connect"] as const) {
    // A server that cannot be reached fails instead of connecting, which is enough to tell it from a disabled one.
    const toggled = operation === "disconnect"
    it.live(`keep a runtime ${operation} when the Location is evicted and rebuilt`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const file = path.join(dir.path, "opencode.json")
        yield* Effect.promise(() => fs.writeFile(file, config(1, !toggled)))
        const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
        const locations = yield* LocationServiceMap.Service
        const status = Mcp.Service.use((service) =>
          Effect.gen(function* () {
            const status = (yield* service.servers()).find((server) => server.name === "remote")?.status
            // Config plugins register servers after boot, so wait for the server to appear and settle.
            if (!status || status.status === "pending") return yield* Effect.fail(new Error("not settled"))
            return status.status
          }).pipe(Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") })),
        ).pipe(Effect.provide(locations.get(ref)), Effect.scoped)
        const after = toggled ? "disabled" : "failed"

        expect(yield* status).toBe(toggled ? "failed" : "disabled")
        yield* Mcp.Service.use((service) => service[operation]("remote")).pipe(
          Effect.provide(locations.get(ref)),
          Effect.scoped,
        )
        expect(yield* status).toBe(after)

        yield* locations.invalidate(ref)
        expect(yield* status).toBe(after)

        // Config edited while the Location is evicted wins over the toggle made against the old config.
        yield* Effect.promise(() => fs.writeFile(file, config(2, !toggled)))
        yield* locations.invalidate(ref)
        expect(yield* status).toBe(toggled ? "failed" : "disabled")
      }),
    )
  }
})
