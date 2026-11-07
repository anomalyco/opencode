import { expect } from "bun:test"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { ModelsDev } from "@opencode/core/models-dev"
import { SessionExecution } from "@opencode/core/session/execution"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createEmbeddedRoutes } from "../src/routes"

it.live("rejects a session location that cannot be stored as an absolute path", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const replacements: LayerNode.Replacements = [
      Global.node.replace(tempGlobalLayer),
      Database.node.replace(Database.configured({ path: ":memory:" })),
      Bus.node.replace(Bus.node),
      App.node.replace(App.node),
      ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ]
    const context = yield* Layer.build(
      createEmbeddedRoutes({ config: { directory: dir.path, project: false, content: "{}" } }, replacements).pipe(
        Layer.provide(HttpServer.layerServices),
      ),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const create = (directory: string) =>
      Effect.promise(() =>
        handler(
          new Request("http://opencode.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ location: { directory } }),
          }),
        ),
      )

    // A relative, home-relative or empty directory used to die while writing the session row, which reached the
    // client as an empty 500 instead of a request error it can explain.
    for (const directory of ["", "relative/path", "~/code"]) {
      const response = yield* create(directory)
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        _tag: "InvalidRequestError",
        field: "location",
      })
    }

    const response = yield* create(dir.path)
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({ data: { location: { directory: dir.path } } })
  }),
)
