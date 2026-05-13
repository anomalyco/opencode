import { expect } from "bun:test"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"

const DIGITALOCEAN = ProviderID.make("digitalocean")
const it = testEffect(Provider.defaultLayer)

const withEnv = <A, E, R>(values: Record<string, string>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]] as const))
      Object.assign(process.env, values)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )

const withAuth = <A, E, R>(metadata: Record<string, string> | undefined, effect: Effect.Effect<A, E, R>) =>
  withEnv(
    {
      OPENCODE_AUTH_CONTENT: JSON.stringify({
        digitalocean: {
          type: "api",
          key: "sk_do_test",
          ...(metadata ? { metadata } : {}),
        },
      }),
    },
    effect,
  )

it.instance(
  "digitalocean provider autoloads from DIGITALOCEAN_ACCESS_TOKEN",
  () =>
    withEnv(
      { DIGITALOCEAN_ACCESS_TOKEN: "test-token" },
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const providers = yield* provider.list()
        expect(providers[DIGITALOCEAN]).toBeDefined()
        expect(providers[DIGITALOCEAN].source).toBe("env")
        const baseModel = Object.values(providers[DIGITALOCEAN].models)[0]
        expect(baseModel.api.url).toBe("https://inference.do-ai.run/v1")
        expect(baseModel.api.npm).toBe("@ai-sdk/openai-compatible")
        const routerEntries = Object.keys(providers[DIGITALOCEAN].models).filter((id) => id.startsWith("router:"))
        expect(routerEntries.length).toBe(0)
      }),
    ),
  { config: {} },
)

it.instance(
  "digitalocean provider.models surfaces cached routers from auth metadata",
  () =>
    withAuth(
      {
        routers: JSON.stringify([
          { name: "my-router", uuid: "11f1499a-aaaa-bbbb-cccc-4e013e2ddde4" },
          { name: "other-router", uuid: "22f1499a-aaaa-bbbb-cccc-4e013e2ddde4" },
        ]),
        routers_fetched_at: String(Date.now()),
        oauth_access: "doo_v1_test",
        oauth_expires: String(Date.now() + 60 * 60 * 1000),
      },
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const providers = yield* provider.list()
        const models = providers[DIGITALOCEAN].models
        expect(models["router:my-router"]).toBeDefined()
        expect(models["router:my-router"].api.id).toBe("router:my-router")
        expect(models["router:my-router"].api.url).toBe("https://inference.do-ai.run/v1")
        expect(models["router:my-router"].api.npm).toBe("@ai-sdk/openai-compatible")
        expect(models["router:other-router"]).toBeDefined()
      }),
    ),
  { config: {} },
)

it.instance(
  "digitalocean provider.models skips refresh when oauth bearer is expired",
  () =>
    withAuth(
      {
        routers: JSON.stringify([{ name: "stale-router", uuid: "stale" }]),
        routers_fetched_at: "0",
        oauth_access: "doo_v1_expired",
        oauth_expires: "1",
      },
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const providers = yield* provider.list()
        const models = providers[DIGITALOCEAN].models
        expect(models["router:stale-router"]).toBeDefined()
      }),
    ),
  { config: {} },
)

it.instance(
  "digitalocean provider.models passes through base models when no auth metadata",
  () =>
    withEnv(
      { DIGITALOCEAN_ACCESS_TOKEN: "test-token" },
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const providers = yield* provider.list()
        const models = providers[DIGITALOCEAN].models
        expect(Object.keys(models).length).toBeGreaterThan(0)
        expect(Object.keys(models).filter((id) => id.startsWith("router:")).length).toBe(0)
      }),
    ),
  { config: {} },
)
