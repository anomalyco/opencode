import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option, Ref } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import type { MarketplaceMutationResult } from "@opencode-ai/core/marketplace"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Service as MarketplaceService } from "../../src/marketplace/service"
import { Installation } from "../../src/installation"
import { InstanceStore } from "../../src/project/instance-store"
import { ServerAuth } from "../../src/server/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { MarketplacePaths } from "../../src/server/routes/instance/httpapi/groups/marketplace"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { marketplaceHandlers } from "../../src/server/routes/instance/httpapi/handlers/marketplace"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

const disposed = Ref.makeUnsafe(false)
const mutation: MarketplaceMutationResult = {
  ok: true,
  changed: true,
  view: {
    state: { revision: 1 },
    listings: [],
    errors: [],
    cache: { root: "/tmp", objects: 0, total_bytes: 0, fetch_entries: 0, materializations: 0 },
  },
  connect_mcp: [],
  preserved: [],
}

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers, marketplaceHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(
    Layer.mock(MarketplaceService)({
      icon: () => Effect.succeed({ data_url: "data:image/png;base64,aWNvbg==" }),
      install: () => Effect.succeed(mutation),
    }),
  ),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(Layer.mock(Installation.Service)({})),
  Layer.provide(
    Layer.mock(InstanceStore.Service)({
      disposeAll: () => Effect.sleep("100 millis").pipe(Effect.andThen(Ref.set(disposed, true))),
    }),
  ),
  Layer.provide(ServerAuth.Config.configLayer({ password: Option.none(), username: "opencode" })),
)
const it = testEffect(apiLayer)

describe("marketplace runtime activation", () => {
  it.live("serves marketplace icons through the authenticated API", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.get(
        MarketplacePaths.icon
          .replace(":key", encodeURIComponent("source:catalog:item"))
          .replace(":variant", "src-light"),
      ).pipe(HttpClient.execute)

      expect(response.status).toBe(200)
      expect((yield* response.json) as { data_url: string }).toEqual({
        data_url: "data:image/png;base64,aWNvbg==",
      })
    }),
  )

  it.live("waits for instance disposal before acknowledging a changed install", () =>
    Effect.gen(function* () {
      yield* Ref.set(disposed, false)
      const response = yield* HttpClientRequest.post(MarketplacePaths.install).pipe(
        HttpClientRequest.setBody(
          HttpBody.jsonUnsafe({ plan_id: "prepared-plan", expected_revision: 0, accept_untrusted: true }),
        ),
        HttpClient.execute,
      )

      expect(response.status).toBe(200)
      expect(yield* Ref.get(disposed)).toBe(true)
      expect((yield* response.json) as { ok: boolean }).toEqual(expect.objectContaining({ ok: true }))
    }),
  )
})
