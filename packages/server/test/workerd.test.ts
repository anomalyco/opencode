import { expect } from "bun:test"
import { Effect } from "effect"
import { makeDurableObjectStorage } from "../../core/test/fixture/durable-object-storage"
import { it } from "../../core/test/lib/effect"
import { ServerWorkerd } from "../src/workerd"

// Covers the profile's replacement graph composing and the database booting
// through the injected Durable Object storage.
it.live("boots the workerd profile over durable object storage", () =>
  Effect.gen(function* () {
    const handler = yield* ServerWorkerd.create({
      storage: makeDurableObjectStorage(),
      password: "secret",
      app: { version: "workerd-test" },
      config: { content: "{}" },
    })

    const unauthorized = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/health")))
    expect(unauthorized.status).toBe(401)

    const health = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/health", {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        }),
      ),
    )
    expect(health.status).toBe(200)

    const body: unknown = yield* Effect.promise(() => health.json())
    expect(body).toMatchObject({ healthy: true, version: "workerd-test" })
  }).pipe(Effect.scoped),
)
