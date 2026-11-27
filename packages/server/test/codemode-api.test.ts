import { expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { CodeModeApi } from "@opencode/core/codemode/api"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live("sends Code Mode opencode:// requests to the server's own router with the server's credential", () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-codemode-api-")))
    const directory = path.join(root.path, "project")
    yield* Effect.promise(() => fs.mkdir(directory))
    const app = yield* Layer.build(
      createRoutes({
        app: { version: "test-version" },
        database: { path: ":memory:" },
        config: { project: false, directory: root.path },
        models: { fetch: false },
        fs: { filewatcher: false },
        password: "secret",
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(app, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(app))
    expect((yield* Effect.promise(() => handler(new Request("http://opencode.local/api/info")))).status).toBe(401)

    const created = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Basic ${btoa("opencode:secret")}` },
          // opencode:// asks as the opencode api command, so the session allows it without a prompt.
          body: JSON.stringify({
            location: { directory },
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
          }),
        }),
      ).then((response) => response.json()),
    )
    const parent = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(created).data
    const locations = Context.get(app, LocationServiceMap.Service)
    const result = yield* Effect.gen(function* () {
      const permission = yield* Permission.Service
      const api = Context.make(CodeModeApi.Service, Context.get(app, CodeModeApi.Service)).pipe(
        Context.add(Location.Service, yield* Location.Service),
      )
      return yield* CodeModeTool.create(
        { tools: new Map() },
        () => Effect.die("The program calls no tools."),
        permission,
        undefined,
        api,
      ).execute(
        {
          code: `const info = await (await fetch("opencode:///api/info")).json()
            const location = await (await fetch("opencode:///api/location")).json()
            const child = await (await fetch("opencode:///api/session", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title: "child", parentID: (await (await fetch("opencode:///api/session/current")).json()).data.id }),
            })).json()
            return [info.version, location.directory, child.data.title, child.data.parentID]`,
        },
        {
          sessionID: parent.id,
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.create(),
          id: Tool.CallID.make("call_opencode_api"),
          progress: () => Effect.void,
        },
      )
    }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))))

    expect(result.output.error, result.output.output).toBeUndefined()
    expect(JSON.parse(result.output.output)).toEqual(["test-version", directory, "child", parent.id])
  }),
)
