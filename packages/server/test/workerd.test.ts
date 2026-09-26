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
      models: { fetch: false },
    })

    const unauthorized = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/info")))
    expect(unauthorized.status).toBe(401)

    const status = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/info", {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        }),
      ),
    )
    expect(status.status).toBe(200)

    const body: unknown = yield* Effect.promise(() => status.json())
    expect(body).toMatchObject({ version: "workerd-test" })

    // The host does not have this project directory; Location boot must not probe its host filesystem.
    const directory = "/workerd-project-only"
    const location = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/location", {
          headers: {
            authorization: `Basic ${btoa("opencode:secret")}`,
            "x-opencode-directory": encodeURIComponent(directory),
          },
        }),
      ),
    )
    expect(location.status).toBe(200)
  }),
)
