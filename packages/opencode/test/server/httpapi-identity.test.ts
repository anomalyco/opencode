import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Identity } from "../../src/identity"
import { Installation } from "../../src/installation"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { ServerAuth } from "../../src/server/auth"
import { IdentityAdminHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { identityHandlers } from "../../src/server/routes/instance/httpapi/handlers/identity"
import { adminHandlers } from "../../src/server/routes/instance/httpapi/handlers/admin"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { IdentityPaths } from "../../src/server/routes/instance/httpapi/groups/identity"
import { AdminPaths } from "../../src/server/routes/instance/httpapi/groups/admin"
import { testEffect } from "../lib/effect"

const mockUser = {
  id: "user-1",
  email: "alice@contoso.com",
  displayName: null,
  tenantId: null,
  createdAt: Date.now(),
  lastLoginAt: Date.now(),
  isAdmin: true,
}

// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
const identityAdminLayer = HttpApiBuilder.layer(IdentityAdminHttpApi).pipe(
  Layer.provide([identityHandlers, adminHandlers]),
  Layer.provide([authorizationLayer, schemaErrorLayer]),
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
) as unknown as Layer.Layer<never, never, never>

const apiLayer = HttpRouter.serve(
  identityAdminLayer,
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(
    Layer.mock(Installation.Service)({
      method: () => Effect.succeed("npm"),
      latest: () => Effect.succeed("9.9.9"),
      upgrade: () => Effect.void,
    }),
  ),
  // Provide a mock Identity that always returns the admin user.
  Layer.provide(Layer.mock(Identity.Service)({
    upsertFromAuth: () => Effect.void,
    getByID: (id: string) =>
      Effect.succeed(id === "user-1" ? { ...mockUser, id } : null),
    getCurrent: () => Effect.succeed(mockUser),
    requireAdmin: () => Effect.void,
    listUsersWithBalances: () =>
      Effect.succeed([
        {
          ...mockUser,
          balance: 100,
          lifetimeUsed: 50,
        },
      ]),
    credit: (input: { userId: string; amount: number; description: string }) =>
      Effect.succeed({
        newBalance: input.amount,
        transactionId: 1,
      }),
  })),
  Layer.provide(ServerAuth.Config.layer({ password: Option.none(), username: "opencode" })),
)
const it = testEffect(apiLayer)

describe("Identity & Admin HttpApi", () => {
  describe("GET /identity/me", () => {
    it.live("returns the current user identity with balance", () =>
      Effect.gen(function* () {
        const response = yield* HttpClient.get(IdentityPaths.me)

        expect(response.status).toBe(200)
        const body = (yield* response.json) as Record<string, unknown> | null
        expect(body).not.toBeNull()
        expect(body!).toMatchObject({
          id: "user-1",
          email: "alice@contoso.com",
          isAdmin: true,
          balance: 100,
        })
      }),
    )
  })

  describe("GET /admin/users", () => {
    it.live("returns list of users with balances", () =>
      Effect.gen(function* () {
        const response = yield* HttpClient.get(AdminPaths.users)

        expect(response.status).toBe(200)
        const body2 = (yield* response.json) as Record<string, unknown> | null
        expect(body2).not.toBeNull()
        const users = (body2!.users as Array<Record<string, unknown>> | undefined) ?? []
        expect(users).toHaveLength(1)
        expect(users[0]).toMatchObject({
          id: "user-1",
          email: "alice@contoso.com",
          balance: 100,
        })
      }),
    )
  })

  describe("POST /admin/users/:id/credit", () => {
    it.live("credits a user and returns new balance", () =>
      Effect.gen(function* () {
        const response = yield* HttpClientRequest.post(AdminPaths.credit.replace(":id", "user-1")).pipe(
          HttpClientRequest.setBody(HttpBody.jsonUnsafe({ amount: 500, description: "test credit" })),
          HttpClient.execute,
        )

        expect(response.status).toBe(200)
        const body1 = (yield* response.json) as Record<string, unknown> | null
        expect(body1).not.toBeNull()
        expect(body1!).toMatchObject({
          userId: "user-1",
          newBalance: 500,
          transactionId: 1,
        })
      }),
    )

    it.live("returns 404 for missing user", () =>
      Effect.gen(function* () {
        const response = yield* HttpClientRequest.post(AdminPaths.credit.replace(":id", "nonexistent")).pipe(
          HttpClientRequest.setBody(HttpBody.jsonUnsafe({ amount: 100, description: "nonexistent" })),
          HttpClient.execute,
        )

        expect(response.status).toBe(404)
      }),
    )

    it.live("returns 400 for negative amount", () =>
      Effect.gen(function* () {
        const response = yield* HttpClientRequest.post(AdminPaths.credit.replace(":id", "user-1")).pipe(
          HttpClientRequest.setBody(HttpBody.jsonUnsafe({ amount: -50, description: "negative" })),
          HttpClient.execute,
        )

        expect(response.status).toBe(400)
      }),
    )
  })
})
