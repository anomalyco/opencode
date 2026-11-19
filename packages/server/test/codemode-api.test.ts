import { expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

const options = {
  app: { version: "test-version" },
  database: { path: ":memory:" },
  config: { project: false },
  models: { fetch: false },
  fs: { filewatcher: false },
  password: "secret-password",
} as const

it.live("dispatches Code Mode opencode:// requests in-process without HTTP auth and with location default", () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-codemode-api-")))
    const directory = path.join(root.path, "project")
    yield* Effect.promise(() => fs.mkdir(directory))

    const appContext = yield* Layer.build(
      createRoutes({ ...options, config: { directory: root.path } }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const externalHandler = Context.get(appContext, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(appContext))

    // External requests without Basic auth must still be rejected.
    const unauthenticated = yield* Effect.promise(() => externalHandler(new Request("http://opencode.local/api/info")))
    expect(unauthenticated.status).toBe(401)

    const locations = Context.get(appContext, LocationServiceMap.Service)
    const locationLayer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))

    const output = yield* Effect.gen(function* () {
      const services = yield* CodeModeTool.services
      const permission = yield* Permission.Service
      const session = yield* Effect.promise(() =>
        externalHandler(
          new Request("http://opencode.local/api/session", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Basic ${Buffer.from("opencode:secret-password").toString("base64")}`,
            },
            body: JSON.stringify({ location: { directory } }),
          }),
        ).then((res) => res.json() as Promise<{ data: Session.Info }>),
      )

      const executeTool = CodeModeTool.create(
        { tools: new Map() },
        () => Effect.die("unused tool execution"),
        permission,
        services,
      )
      return yield* executeTool.execute(
        {
          code: `const info = await (await fetch("opencode:///api/info")).json()
            const loc = await (await fetch("opencode:///api/location")).json()
            const created = await (await fetch("opencode:///api/session", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title: "Child from codemode", parentID: ${JSON.stringify(session.data.id)} }),
            })).json()
            const fetched = await (await fetch("opencode:///api/session/" + created.data.id)).json()
            const blocked = await Promise.allSettled([
              fetch("opencode:///api/credential"),
              fetch("opencode:///api/session", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ permissions: [] }),
              }),
            ])
            return {
              version: info.version,
              locationDir: loc.directory,
              childTitle: fetched.data.title,
              childParentID: fetched.data.parentID,
              blockedStatuses: blocked.map((item) => item.status),
            }`,
        },
        {
          sessionID: session.data.id,
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.create(),
          id: Tool.CallID.make("call_codemode_api"),
          progress: () => Effect.void,
        },
      )
    }).pipe(Effect.provide(locationLayer))

    expect(output.output.error, output.output.output).toBeUndefined()
    const parsed = JSON.parse(output.output.output) as {
      version: string
      locationDir: string
      childTitle: string
      childParentID: string
      blockedStatuses: Array<string>
    }
    expect(parsed.version).toBe("test-version")
    expect(parsed.locationDir).toBe(directory)
    expect(parsed.childTitle).toBe("Child from codemode")
    expect(parsed.childParentID).toBeTruthy()
    expect(parsed.blockedStatuses).toEqual(["rejected", "rejected"])
  }),
)
