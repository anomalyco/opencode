import path from "node:path"
import { expect } from "bun:test"
import type { Instance } from "@opencode-ai/core/instance"
import { InstanceMap } from "@opencode-ai/core/instance-map"
import { Entry, fromMap } from "@opencode-ai/core/instance-map/internal"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Workspace } from "@opencode-ai/core/workspace"
import { Global } from "@opencode-ai/util/global"
import { Duration, Effect, Layer, LayerMap } from "effect"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { location } from "../../core/test/fixture/location"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("lists retained locations and evicts through query and header refs without booting", () =>
  Effect.gen(function* () {
    const built: Location.Ref[] = []
    const map = fromMap(
      yield* LayerMap.make(
        (entry: Entry) =>
          Layer.effect(
            Location.Service,
            Effect.sync(() => {
              built.push(entry.location)
              return location(entry.location)
            }),
            // The HTTP debug routes need no other instance services.
          ) as unknown as Layer.Layer<Instance.Services, Instance.Error>,
        { idleTimeToLive: Duration.infinity },
      ),
    )
    const handler = yield* ServerFetch.make(
      { database: { path: ":memory:" }, fs: { filewatcher: false } },
      {
        overrides: [
          [Global.node, tempGlobalLayer],
          [InstanceMap.node, Layer.succeed(InstanceMap.Service, map)],
        ],
      },
    )
    const url = "http://opencode.local/api/debug/location"
    const list = Effect.promise(async () => {
      const response = await handler(new Request(url))
      expect(response.status).toBe(200)
      return response.json()
    })
    expect(yield* list).toEqual([])
    const local = Location.Ref.make({ directory: AbsolutePath.make(path.resolve("debug-repo")) })
    const workspaceID = Workspace.ID.make("wrk_team:alpha%3A")
    const workspace = Location.Ref.make({ ...local, workspaceID })
    yield* map.contextEffect(local).pipe(Effect.scoped)
    yield* map.contextEffect(workspace).pipe(Effect.scoped)
    expect(yield* list).toEqual([local, workspace])

    const query = new URL(url)
    query.searchParams.set("location[directory]", workspace.directory)
    query.searchParams.set("location[workspace]", workspaceID)
    const workspaceEviction = yield* Effect.promise(() => handler(new Request(query, { method: "DELETE" })))
    expect(workspaceEviction.status).toBe(204)
    expect(yield* list).toEqual([local])

    const localEviction = yield* Effect.promise(() =>
      handler(
        new Request(url, {
          method: "DELETE",
          headers: { "x-opencode-directory": encodeURIComponent(local.directory.replaceAll("\\", "/")) },
        }),
      ),
    )
    expect(localEviction.status).toBe(204)
    expect(yield* list).toEqual([])
    expect((yield* Effect.promise(() => handler(new Request(query, { method: "DELETE" })))).status).toBe(204)
    expect(built).toEqual([local, workspace])
  }),
)
